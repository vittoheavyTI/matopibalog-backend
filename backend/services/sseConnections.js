// sseConnections — controle de conexões SSE de longa duração (E1.6A).
//
// O SSE NÃO passa pelo rate limiter HTTP (mataria a conexão longa). Esta é a proteção
// própria: limita conexões simultâneas POR USUÁRIO e POR EMPRESA, evitando que um
// cliente abra streams ilimitados (DoS/leak). Contadores em memória (single-instance —
// ver RBV9-INV-107). Observável sem PII (só números).

const MAX_POR_USUARIO = Number(process.env.SSE_MAX_PER_USER) || 5;
const MAX_POR_EMPRESA = Number(process.env.SSE_MAX_PER_EMPRESA) || 80;

const porUsuario = new Map(); // userId -> count
const porEmpresa = new Map(); // empresaId -> count

/**
 * Tenta registrar uma nova conexão. Retorna {ok:true} ou {ok:false, reason}. Só
 * incrementa quando ok (nunca deixa contador inflado por rejeição).
 */
function tryAcquire(userId, empresaId) {
  const u = porUsuario.get(userId) || 0;
  const e = porEmpresa.get(empresaId) || 0;
  if (u >= MAX_POR_USUARIO) return { ok: false, reason: 'user_limit' };
  if (e >= MAX_POR_EMPRESA) return { ok: false, reason: 'empresa_limit' };
  porUsuario.set(userId, u + 1);
  porEmpresa.set(empresaId, e + 1);
  return { ok: true };
}

/** Libera uma conexão (no disconnect). Idempotente-safe: nunca vai abaixo de zero. */
function release(userId, empresaId) {
  const u = (porUsuario.get(userId) || 0) - 1;
  if (u <= 0) porUsuario.delete(userId); else porUsuario.set(userId, u);
  const e = (porEmpresa.get(empresaId) || 0) - 1;
  if (e <= 0) porEmpresa.delete(empresaId); else porEmpresa.set(empresaId, e);
}

/** Métricas sem PII (só cardinalidades e total). */
function stats() {
  let total = 0;
  for (const n of porUsuario.values()) total += n;
  return {
    conexoes_ativas: total,
    usuarios_conectados: porUsuario.size,
    empresas_conectadas: porEmpresa.size,
    max_por_usuario: MAX_POR_USUARIO,
    max_por_empresa: MAX_POR_EMPRESA,
  };
}

// Apenas para testes: zera o estado entre casos.
function _reset() { porUsuario.clear(); porEmpresa.clear(); }

module.exports = { tryAcquire, release, stats, MAX_POR_USUARIO, MAX_POR_EMPRESA, _reset };
