// Repositório do outbox de billing (macrofrente 3A-2).
//
// Persistência da fila. Idempotência MULTI-PROCESSO por dois mecanismos:
//   - enfileirar: INSERT ... ON CONFLICT (dedupe_key) DO NOTHING → 1 linha por evento.
//   - reivindicar: UPDATE ... WHERE status IN (pending,failed) [AND id=$id] RETURNING
//     (compare-and-swap) → só 1 worker processa cada evento.
//
// Injeção de dependência: recebe supabase para testabilidade (fake em teste).
// NÃO contém regra de billing (isso é o worker/orquestrador).

const STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  PROCESSED: 'processed',
  FAILED: 'failed',
  DEAD: 'dead',
});

const PROCESSING_STALE_MS = 5 * 60 * 1000;

function sanitizarErro(msg) {
  if (!msg) return null;
  let s = String(msg);
  if (s.length > 500) s = s.slice(0, 497) + '...';
  s = s.replace(/\b[a-fA-F0-9]{20,}\b/g, '[token]');
  s = s.replace(/\bBearer\s+[^\s]+/gi, '[secret]');
  s = s.replace(/\b(?:pay|cus|sub|evt)_[A-Za-z0-9_-]+\b/g, '[asaas_id]');
  s = s.replace(/https?:\/\/[^\s]+/g, '[url]');
  return s;
}

// Enfileira um evento. Idempotente por dedupe_key: repetir não duplica.
// Devolve { enfileirado: bool, code }.
async function enfileirar(supabase, { empresaId, eventType, dedupeKey, payload = {} }) {
  const { data, error } = await supabase
    .from('billing_outbox')
    .insert({
      empresa_id: empresaId,
      event_type: eventType,
      dedupe_key: dedupeKey,
      status: STATUS.PENDING,
      attempts: 0,
      payload,
    })
    .select()
    .maybeSingle();

  if (!error) return { enfileirado: true, code: 'inserted', evento: data };
  // 23505 = unique_violation no dedupe_key → já enfileirado (idempotente).
  if (error.code === '23505') return { enfileirado: false, code: 'duplicate' };
  return { enfileirado: false, code: 'db_error', error };
}

// Reivindica UM evento para processar (claim CAS). Se `id` informado, tenta só
// aquele; senão pega o mais antigo elegível. Devolve { evento } | { evento:null }.
async function reivindicarProximo(supabase, { agora = new Date() } = {}) {
  // 1) Seleciona um candidato elegível (pending, ou failed com retry vencido, ou
  //    processing "stale").
  const nowIso = agora.toISOString();
  const staleLimite = new Date(agora.getTime() - PROCESSING_STALE_MS).toISOString();

  const { data: candidatos, error: selErr } = await supabase
    .from('billing_outbox')
    .select('id, status, attempts, processing_started_at')
    .or(`status.eq.${STATUS.PENDING},and(status.eq.${STATUS.FAILED},next_retry_at.lte.${nowIso}),and(status.eq.${STATUS.PROCESSING},processing_started_at.lte.${staleLimite})`)
    .order('created_at', { ascending: true })
    .limit(5);
  if (selErr) return { evento: null, code: 'db_error', error: selErr };
  if (!candidatos || candidatos.length === 0) return { evento: null, code: 'empty' };

  // 2) Tenta reivindicar por CAS (status + attempts inalterados desde a leitura).
  for (const cand of candidatos) {
    const { data: claimed, error: casErr } = await supabase
      .from('billing_outbox')
      .update({
        status: STATUS.PROCESSING,
        attempts: (cand.attempts || 0) + 1,
        processing_started_at: nowIso,
        updated_at: nowIso,
        last_error: null,
      })
      .eq('id', cand.id)
      .eq('status', cand.status)
      .eq('attempts', cand.attempts)
      .select()
      .maybeSingle();
    if (!casErr && claimed) return { evento: claimed, code: 'claimed' };
    // Perdeu a corrida para outro worker → tenta o próximo candidato.
  }
  return { evento: null, code: 'lost_all' };
}

async function marcarProcessado(supabase, id, { agora = new Date() } = {}) {
  const iso = agora.toISOString();
  const { data, error } = await supabase
    .from('billing_outbox')
    .update({ status: STATUS.PROCESSED, processed_at: iso, updated_at: iso, last_error: null })
    .eq('id', id)
    .eq('status', STATUS.PROCESSING)
    .select()
    .maybeSingle();
  if (error) return { code: 'db_error', error };
  return { code: 'processed', evento: data };
}

// Falha com backoff. Excedeu max_attempts → 'dead' (manual_attention).
async function marcarFalhou(supabase, evento, razao, { agora = new Date() } = {}) {
  const attempts = evento.attempts || 1;
  const maxAttempts = evento.max_attempts || 8;
  const excedeu = attempts >= maxAttempts;
  const backoffMs = Math.min(60 * 60 * 1000, Math.max(30 * 1000, attempts * 60 * 1000));
  const iso = agora.toISOString();
  const patch = {
    status: excedeu ? STATUS.DEAD : STATUS.FAILED,
    next_retry_at: excedeu ? null : new Date(agora.getTime() + backoffMs).toISOString(),
    processing_started_at: null,
    updated_at: iso,
    last_error: sanitizarErro(razao),
  };
  const { data, error } = await supabase
    .from('billing_outbox')
    .update(patch)
    .eq('id', evento.id)
    .eq('status', STATUS.PROCESSING)
    .select()
    .maybeSingle();
  if (error) return { code: 'db_error', error };
  return { code: excedeu ? 'dead' : 'failed', evento: data };
}

async function contarPorStatus(supabase, empresaId = null) {
  let q = supabase.from('billing_outbox').select('status');
  if (empresaId) q = q.eq('empresa_id', empresaId);
  const { data, error } = await q;
  if (error) return { code: 'db_error', error };
  const contagem = { pending: 0, processing: 0, processed: 0, failed: 0, dead: 0 };
  for (const r of data || []) if (contagem[r.status] != null) contagem[r.status] += 1;
  return { code: 'ok', contagem };
}

module.exports = {
  STATUS,
  PROCESSING_STALE_MS,
  sanitizarErro,
  enfileirar,
  reivindicarProximo,
  marcarProcessado,
  marcarFalhou,
  contarPorStatus,
};
