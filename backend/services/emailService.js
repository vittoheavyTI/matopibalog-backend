// backend/services/emailService.js
// Pacote 3 — Adapter de e-mail (Resend), FAIL-CLOSED e DESLIGADO por padrão.
//
// Decisão de produto: neste pacote NÃO se envia e-mail real a cliente. Este módulo
// deixa o canal PRONTO tecnicamente para ligar depois (com autorização explícita),
// mas só dispara quando DUAS travas estiverem satisfeitas ao mesmo tempo:
//   1. EMAIL_ENVIO_HABILITADO === 'true'   (opt-in explícito por ambiente);
//   2. RESEND_API_KEY presente             (credencial configurada).
// Sem as duas, retorna { enviado:false, motivo } SEM tocar a rede. Nunca lança —
// é best-effort, igual ao pushService. Não expõe a API key em log.
//
// Uso futuro (quando liberado): wire no domínio/job de inadimplência como canal
// adicional (as notificações internas seguem sendo a fonte da verdade).

// As duas travas: opt-in por env + credencial. Fail-closed.
function habilitado(env = process.env) {
  const optIn = env && env.EMAIL_ENVIO_HABILITADO === 'true';
  const apiKey = env && env.RESEND_API_KEY;
  return Boolean(optIn && apiKey && String(apiKey).trim());
}

/**
 * Envia um e-mail transacional via Resend — SOMENTE se habilitado() (opt-in +
 * credencial). Best-effort: nunca lança; devolve um resumo simples.
 *
 * @param {object} msg  { para, assunto, html?, texto?, de? }
 * @param {object} [deps] { http?, env? } — injeção para teste (nunca toca rede real).
 * @returns {Promise<{ enviado: boolean, motivo?: string, id?: string|null }>}
 */
async function enviarEmail({ para, assunto, html = null, texto = null, de = null } = {}, { http = null, env = process.env } = {}) {
  if (!para || !assunto || (!html && !texto)) {
    return { enviado: false, motivo: 'payload_invalido' };
  }
  // Trava 1: opt-in explícito. Fora isso, NUNCA envia (nem constrói cliente HTTP).
  if (!env || env.EMAIL_ENVIO_HABILITADO !== 'true') {
    return { enviado: false, motivo: 'desabilitado' };
  }
  // Trava 2: credencial presente.
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey || !String(apiKey).trim()) {
    return { enviado: false, motivo: 'sem_api_key' };
  }
  const remetente = de || env.EMAIL_REMETENTE || null;
  if (!remetente) {
    return { enviado: false, motivo: 'sem_remetente' };
  }

  try {
    // require tardio do axios: sem custo/dependência quando o canal está desligado.
    const client = http || require('axios');
    const resposta = await client.post(
      'https://api.resend.com/emails',
      {
        from: remetente,
        to: para,
        subject: assunto,
        ...(html ? { html } : {}),
        ...(texto ? { text: texto } : {}),
      },
      {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 10000,
      },
    );
    return { enviado: true, id: (resposta && resposta.data && resposta.data.id) || null };
  } catch (error) {
    // Não vazar a credencial — só a mensagem do erro.
    return { enviado: false, motivo: 'erro_envio', detalhe: (error && error.message) || String(error) };
  }
}

module.exports = {
  enviarEmail,
  habilitado,
};
