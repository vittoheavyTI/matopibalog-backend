// backend/services/inadimplenciaNotificacaoDomainService.js
// Pacote 3 — Notificações proativas de inadimplência. REGRAS PURAS (sem I/O), no
// mesmo estilo testável de paymentDomainService/empresaArquivamentoService. As
// rotas/jobs orquestram; aqui só se decide QUEM está num passo da escada e QUAL a
// copy.
//
// ESCADA (relativa ao vencimento da fatura vencida mais antiga; carência da config,
// default D+3, reaproveitando lerDiasCarenciaSuspensao):
//   * D+0  = venceu hoje;
//   * D+1  = 1 dia em atraso;
//   * D+2  = 2 dias em atraso;
//   * passo 'suspensao' = dia da suspensão (dias_vencido === carência; com o
//     default 3 isso é exatamente o D+3). Lembretes (D+0/D+1/D+2) só disparam
//     ENQUANTO dias_vencido < carência — assim a escada respeita carências menores
//     e nunca promete um "D+3" que não vai acontecer.
//
// SEGURANÇA/COERÊNCIA com o cron de suspensão (radiant-warmth), que NÃO é tocado:
//   * mesma elegibilidade de fundo (status trial-vencido/ativo, fatura
//     pendente/vencida, extensão manual, caminho de regularização);
//   * conta 'suspenso' NÃO recebe escada (já está no fim do fluxo);
//   * sem caminho de regularização (sem invoice_url e sem bank_slip_url) → não
//     notifica: não há CTA acionável e evitaríamos ruído.
// Idempotência mora no banco (índice único parcial ux_notificacoes_dedupe_key via
// dedupe_key); aqui só montamos a chave determinística por (passo, fatura).

const { DIAS_CARENCIA_PADRAO } = require('./paymentDomainService');

// 'YYYY-MM-DD' (UTC) a partir de Date/string, ou null. Espelha o dataISO do
// paymentDomainService (mantido local para não acoplar exports).
function dataISO(data) {
  if (!data) return null;
  if (data instanceof Date && !Number.isNaN(data.getTime())) return data.toISOString().slice(0, 10);
  if (typeof data === 'string' && /^\d{4}-\d{2}-\d{2}/.test(data)) return data.slice(0, 10);
  const parsed = new Date(data);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

// Diferença em dias inteiros (UTC) entre duas datas: ate - de. null se inválido.
function diffDiasISO(de, ate) {
  const a = dataISO(de);
  const b = dataISO(ate);
  if (!a || !b) return null;
  const ta = new Date(a + 'T00:00:00Z').getTime();
  const tb = new Date(b + 'T00:00:00Z').getTime();
  return Math.round((tb - ta) / 86400000);
}

// Dias de atraso que geram LEMBRETE (antes da suspensão). O passo de suspensão é
// dinâmico (=== carência) e tratado à parte.
const DIAS_LEMBRETE = [0, 1, 2];

/**
 * Decide se uma empresa está num passo da escada de inadimplência HOJE.
 * PURO: não lê banco, não envia nada. Retorna a decisão e o passo.
 *
 * @returns {{ deveNotificar: boolean, passo: string|null, diasVencido: number|null, razao: string }}
 *   passo ∈ { 'd0', 'd1', 'd2', 'suspensao' } quando deveNotificar=true.
 */
function avaliarEscadaInadimplencia({
  empresa,
  fatura,
  hoje = new Date(),
  erroConsulta = null,
  diasCarencia = DIAS_CARENCIA_PADRAO,
} = {}) {
  if (erroConsulta) return semNotificar('fail_safe_erro_consulta');
  if (!empresa || !empresa.id) return semNotificar('empresa_ausente');

  // Já suspensa: fim do fluxo, sem escada (idempotente com o cron de suspensão).
  if (empresa.status === 'suspenso') return semNotificar('ja_suspensa');
  if (!['trial', 'ativo'].includes(empresa.status)) {
    return semNotificar(`conta_${empresa.status}_fora_escada`);
  }

  const hojeStr = dataISO(hoje);

  // Trial ainda vigente: nada a cobrar ainda.
  if (empresa.status === 'trial') {
    const trialFim = dataISO(empresa.trial_ends_at);
    if (!trialFim || trialFim >= hojeStr) return semNotificar('trial_ativa');
  }

  if (!fatura) return semNotificar('sem_fatura');
  if (fatura.empresa_id && fatura.empresa_id !== empresa.id) return semNotificar('fatura_outro_tenant');
  if (!['pendente', 'vencido'].includes(fatura.status)) return semNotificar('status_fatura_nao_elegivel');

  const due = dataISO(fatura.due_date);
  if (!due) return semNotificar('vencimento_ausente');

  // Extensão manual concedida pelo super-admin: preserva o acesso, sem cobrança.
  const prazo = dataISO(empresa.suspensao_prazo_ate);
  if (prazo && prazo >= hojeStr) return semNotificar('prazo_estendido');

  // Sem caminho de regularização: nenhum CTA acionável → não notifica.
  if (!fatura.invoice_url && !fatura.bank_slip_url) return semNotificar('sem_caminho_regularizacao');

  const diasVencido = diffDiasISO(due, hojeStr);
  if (diasVencido == null) return semNotificar('vencimento_ausente');
  if (diasVencido < 0) return { deveNotificar: false, passo: null, diasVencido, razao: 'ainda_nao_venceu' };

  // Passo de suspensão (dia da carência). Lembretes só antes disso.
  if (diasVencido === diasCarencia) {
    return { deveNotificar: true, passo: 'suspensao', diasVencido, razao: 'escada' };
  }
  if (DIAS_LEMBRETE.includes(diasVencido) && diasVencido < diasCarencia) {
    return { deveNotificar: true, passo: `d${diasVencido}`, diasVencido, razao: 'escada' };
  }

  return { deveNotificar: false, passo: null, diasVencido, razao: 'fora_da_escada' };
}

function semNotificar(razao) {
  return { deveNotificar: false, passo: null, diasVencido: null, razao };
}

// Copy por passo — destinada aos ADMINS da empresa (decisão de produto: quem
// resolve o financeiro). Cita a fatura vencida e o caminho de regularização
// (PIX/boleto/suporte), sem prometer nada falso. `diasVencido` só entra na
// pluralização dos lembretes.
function copyDoPasso(passo, diasVencido) {
  if (passo === 'd0') {
    return {
      titulo: 'Fatura vencida',
      mensagem: 'A fatura da sua assinatura venceu hoje. Regularize agora via PIX ou boleto para manter o acesso da equipe.',
    };
  }
  if (passo === 'suspensao') {
    return {
      titulo: 'Acesso suspenso por falta de pagamento',
      mensagem: 'O acesso foi suspenso porque a fatura da assinatura segue em aberto. Pague via PIX ou boleto para reativar automaticamente. Precisa de ajuda? Fale com o suporte.',
    };
  }
  // Lembretes D+1/D+2 (em atraso, antes da suspensão).
  const n = Number(diasVencido);
  const dia = n === 1 ? '1 dia' : `${n} dias`;
  const fecho = n >= 2
    ? 'Regularize hoje via PIX ou boleto — o acesso será suspenso em breve por falta de pagamento.'
    : 'Regularize via PIX ou boleto para evitar a suspensão do acesso.';
  return {
    titulo: 'Fatura em atraso',
    mensagem: `A fatura da sua assinatura está em atraso há ${dia}. ${fecho}`,
  };
}

/**
 * Monta o payload de notificação interna (consumido por notificacaoService.
 * criarParaEmpresa). PURO. dedupe_key determinística por (passo, fatura) garante
 * no máximo um disparo por passo por fatura (idempotência via índice único).
 */
function montarNotificacao({ empresa, fatura, passo, diasVencido }) {
  const { titulo, mensagem } = copyDoPasso(passo, diasVencido);
  return {
    tipo: 'inadimplencia',
    titulo,
    mensagem,
    entidade_tipo: 'fatura',
    entidade_id: fatura.id,
    dedupe_key: `inadimplencia:${passo}:${fatura.id}`,
    metadata: {
      passo,
      dias_vencido: diasVencido,
      fatura_id: fatura.id,
      due_date: dataISO(fatura.due_date),
      invoice_url: fatura.invoice_url || null,
      bank_slip_url: fatura.bank_slip_url || null,
      empresa_id: empresa.id,
    },
  };
}

module.exports = {
  avaliarEscadaInadimplencia,
  montarNotificacao,
  copyDoPasso,
  dataISO,
  diffDiasISO,
  DIAS_LEMBRETE,
};
