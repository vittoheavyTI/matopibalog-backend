// lancamentoWorkflow — orquestra as transições de estado audit-safe dos lançamentos
// (despesa/abastecimento/vale) e a publicação de eventos realtime (SSE).
//
// O backend é a autoridade: a transição atômica + auditoria acontece na RPC
// `lancamento_transicionar` (migration 070, SECURITY DEFINER, row lock + CAS). Aqui
// só orquestramos: chamamos a RPC (via service_role), mapeamos erros de domínio para
// HTTP pt-BR e PUBLICAMOS o evento mínimo no RealtimeBus. Nada de regra financeira aqui.

const supabaseSingleton = require('../config/supabase');
const bus = require('./realtimeBus');

const ENTITY_TYPES = ['despesa', 'abastecimento', 'vale'];
const NOVO_STATUS_VALIDO = ['aprovado', 'rejeitado', 'cancelado'];

// Mapa status→tipo de evento realtime (o app/web usam para decidir o refetch).
const EVENTO_POR_STATUS = {
  aprovado: 'launch.approved',
  rejeitado: 'launch.rejected',
  cancelado: 'launch.cancelled',
};

/**
 * Envelope MÍNIMO de evento (nunca o objeto financeiro inteiro). O cliente usa isto
 * só para saber "algo mudou nesta empresa/frete/entidade" e então refazer o fetch
 * canônico. PURO/testável.
 */
function construirEventoLancamento({ type, empresaId, entityType, entityId, freteId = null, version = null, occurredAt = null }) {
  return {
    event_id: `${entityType}:${entityId}:${version ?? ''}:${type}`,
    type,
    empresa_id: empresaId,
    entity_type: entityType,
    entity_id: entityId,
    freight_id: freteId,
    version: version ?? null,
    occurred_at: occurredAt || new Date().toISOString(),
  };
}

/**
 * Detecta a origem da requisição SEM confiar em texto livre do cliente:
 *   header X-Client-Platform (web|app) quando presente → senão heurística de auth
 *   (web usa cookie httpOnly; app usa Bearer). Fallback 'api'. PURO/testável.
 */
function detectarOrigem(req) {
  const hdr = (req && (req.get ? req.get('X-Client-Platform') : (req.headers || {})['x-client-platform'])) || '';
  const norm = String(hdr).toLowerCase().trim();
  if (norm === 'web' || norm === 'app' || norm === 'api' || norm === 'system') return norm;
  const temCookie = !!(req && req.cookies && req.cookies.token);
  if (temCookie) return 'web';
  const auth = req && req.headers && req.headers['authorization'];
  if (auth && String(auth).startsWith('Bearer ')) return 'app';
  return 'api';
}

/**
 * Mapeia o erro da RPC de transição para {http, code, message} em pt-BR. PURO/testável.
 * A RPC RAISE com tokens estáveis (LANCAMENTO_*) — casamos pela mensagem.
 */
function mapearErroTransicao(err) {
  const msg = String((err && (err.message || err.details || err)) || '');
  const tem = (t) => msg.includes(t);
  if (tem('LANCAMENTO_MOTIVO_OBRIGATORIO')) {
    return { http: 400, code: 'MOTIVO_OBRIGATORIO', message: 'Informe o motivo para concluir esta ação.' };
  }
  if (tem('LANCAMENTO_TRANSICAO_INVALIDA')) {
    return { http: 409, code: 'TRANSICAO_INVALIDA', message: 'Esta mudança de status não é permitida para o estado atual do lançamento.' };
  }
  if (tem('LANCAMENTO_CONFLITO_VERSAO') || tem('LANCAMENTO_CONFLITO_ESTADO')) {
    return { http: 409, code: 'CONFLITO', message: 'O lançamento foi alterado por outra pessoa. Atualize e tente novamente.' };
  }
  if (tem('LANCAMENTO_TENANT')) {
    return { http: 403, code: 'TENANT', message: 'Acesso negado a este lançamento.' };
  }
  if (tem('LANCAMENTO_NAO_ENCONTRADO')) {
    return { http: 404, code: 'NAO_ENCONTRADO', message: 'Lançamento não encontrado.' };
  }
  if (tem('LANCAMENTO_TIPO_INVALIDO') || tem('LANCAMENTO_DESTINO_INVALIDO') || tem('LANCAMENTO_PARAM_INVALIDO')) {
    return { http: 400, code: 'REQUISICAO_INVALIDA', message: 'Requisição inválida.' };
  }
  return { http: 500, code: 'ERRO', message: 'Não foi possível concluir a ação agora. Tente novamente.' };
}

/**
 * Executa a transição de estado (approve/reject/cancel) e publica o evento realtime.
 * Retorna {ok, http, data} em sucesso ou {ok:false, http, code, message} em erro.
 */
async function transicionar({
  entityType, entityId, empresaId, novoStatus, actorId, actorRole, source,
  motivo = null, expectedVersion = null, expectedStatus = null, supabase = supabaseSingleton, barramento = bus,
}) {
  if (!ENTITY_TYPES.includes(entityType)) {
    return { ok: false, http: 400, code: 'REQUISICAO_INVALIDA', message: 'Tipo de lançamento inválido.' };
  }
  if (!NOVO_STATUS_VALIDO.includes(novoStatus)) {
    return { ok: false, http: 400, code: 'REQUISICAO_INVALIDA', message: 'Destino de status inválido.' };
  }
  const { data, error } = await supabase.rpc('lancamento_transicionar', {
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_empresa_id: empresaId,
    p_new_status: novoStatus,
    p_actor_user_id: actorId,
    p_actor_role: actorRole,
    p_source: source,
    p_reason: motivo,
    p_expected_version: expectedVersion,
    p_expected_status: expectedStatus,
  });
  if (error) {
    return { ok: false, ...mapearErroTransicao(error) };
  }
  const row = data || {};
  try {
    barramento.publish(construirEventoLancamento({
      type: EVENTO_POR_STATUS[novoStatus],
      empresaId,
      entityType,
      entityId,
      freteId: row.frete_id ?? null,
      version: row.version ?? null,
      occurredAt: row.updated_at ?? null,
    }));
  } catch (_) { /* entrega best-effort: nunca afeta a mutation já persistida */ }
  return { ok: true, http: 200, data: row };
}

/**
 * Registra a CRIAÇÃO de um lançamento: insere o evento 'created' no ledger append-only
 * (best-effort — a criação já foi persistida pelo controller) e publica launch.created.
 */
async function registrarCriacao({ entityType, row, actorId, actorRole, source, supabase = supabaseSingleton, barramento = bus }) {
  if (!row || !row.id || !row.empresa_id) return;
  try {
    await supabase.from('lancamento_eventos').insert({
      empresa_id: row.empresa_id,
      entity_type: entityType,
      entity_id: row.id,
      frete_id: row.frete_id ?? null,
      action: 'created',
      from_status: null,
      to_status: row.status ?? null,
      actor_user_id: actorId ?? null,
      actor_role: actorRole ?? null,
      source: source ?? null,
      reason: null,
      metadata: {},
    });
  } catch (_) { /* auditoria de criação é best-effort; não falha a criação */ }
  try {
    barramento.publish(construirEventoLancamento({
      type: 'launch.created',
      empresaId: row.empresa_id,
      entityType,
      entityId: row.id,
      freteId: row.frete_id ?? null,
      version: row.version ?? 1,
      occurredAt: row.data ?? null,
    }));
  } catch (_) { /* best-effort */ }
}

module.exports = {
  ENTITY_TYPES,
  EVENTO_POR_STATUS,
  construirEventoLancamento,
  detectarOrigem,
  mapearErroTransicao,
  transicionar,
  registrarCriacao,
};
