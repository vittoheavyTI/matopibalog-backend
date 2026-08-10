// backend/services/auth/trackingCredentialDomain.js — decisões PURAS da credencial de
// rastreamento (SEC-1 / Opção C). Sem Express, sem Supabase, sem relógio implícito.
//
// Concentra a lógica de "esta credencial pode enviar telemetria AGORA?" de forma
// determinística e testável. O serviço (I/O) carrega as linhas do banco e delega aqui.
//
// PRINCÍPIO SEC-1 (§5): a expiração NATURAL do access/idle/absolute da sessão de UI
// NÃO interrompe o rastreamento — por isso NÃO olhamos idle/absolute da sessão aqui.
// Só a REVOGAÇÃO EXPLÍCITA (logout/admin) importa: sessao.revoked_at.

const STATUS_MOTORISTA_ATIVO = new Set(['ativo']);

/** Expiração absoluta = agora + ttl. `agoraMs` epoch; `ttlSeconds` inteiro. Retorna ISO. */
function calcularExpiracao(agoraMs, ttlSeconds) {
  return new Date(agoraMs + ttlSeconds * 1000).toISOString();
}

function msDe(x) {
  const t = new Date(x).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Avalia se a credencial pode operar. Entradas:
 *   credencial: { motorista_id, empresa_id, expires_at, revoked_at } (ou null)
 *   usuario:    { id, status, empresa_id } (ou null)  — motorista ATUAL do banco
 *   sessao:     { revoked_at } (ou null)  — sessão SEC-1 emissora, se houver
 *   agoraMs:    epoch atual (injetável — determinístico em teste)
 * Retorna { ok:true, identidade } ou { ok:false, code } onde `code` é um erro tipado.
 */
function avaliarCredencial({ credencial, usuario, sessao, agoraMs }) {
  if (!credencial) return { ok: false, code: 'credential_invalid' };
  if (credencial.revoked_at) return { ok: false, code: 'credential_revoked' };

  const exp = msDe(credencial.expires_at);
  if (exp === null || exp <= agoraMs) return { ok: false, code: 'credential_expired' };

  // Revogação EXPLÍCITA da sessão emissora (logout/admin) invalida o tracking.
  // Expiração natural (idle/absolute) da sessão NÃO é checada aqui — de propósito.
  if (sessao && sessao.revoked_at) return { ok: false, code: 'credential_revoked' };

  if (!usuario) return { ok: false, code: 'driver_blocked' };
  if (!STATUS_MOTORISTA_ATIVO.has(String(usuario.status || '').toLowerCase())) {
    return { ok: false, code: 'driver_blocked' };
  }
  // Tenant/vínculo: o motorista tem de continuar na MESMA empresa da credencial e ser
  // o MESMO usuário. Mudança de empresa / troca de id → fora do escopo.
  if (String(usuario.empresa_id) !== String(credencial.empresa_id)) {
    return { ok: false, code: 'tracking_scope_forbidden' };
  }
  if (String(usuario.id) !== String(credencial.motorista_id)) {
    return { ok: false, code: 'tracking_scope_forbidden' };
  }

  return {
    ok: true,
    identidade: {
      uid: credencial.motorista_id,
      empresa_id: credencial.empresa_id,
      role: 'motorista',
      is_super_admin: false,
    },
  };
}

module.exports = { calcularExpiracao, avaliarCredencial, STATUS_MOTORISTA_ATIVO };
