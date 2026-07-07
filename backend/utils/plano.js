// Helpers puros de plano (sem I/O). Testáveis com node --test.

// UUID canônico (8-4-4-4-12, hex). Aceita qualquer versão/variante para não
// rejeitar UUIDs legítimos legados — o objetivo é apenas barrar texto que NÃO é
// UUID antes de chegar ao Postgres (evita o erro 22P02 / 500 numa coluna uuid).
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Retorna true se `v` for um UUID no formato canônico.
 * Vazio, null, undefined ou tipo não-string → false.
 * @param {*} v
 * @returns {boolean}
 */
function plano_idValido(v) {
  if (typeof v !== 'string') return false;
  return UUID_RE.test(v.trim());
}

/**
 * Normaliza o valor de plano_id recebido do cliente para gravação.
 * '' / null / undefined / só espaços → null (conta sem plano).
 * Caso contrário devolve a string aparada (sem validar formato — use
 * plano_idValido para isso).
 * @param {*} v
 * @returns {string|null}
 */
function normalizarPlanoId(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

module.exports = { plano_idValido, normalizarPlanoId };
