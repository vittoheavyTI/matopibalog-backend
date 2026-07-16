// Frente #8-C (Billing v2 / Macrofrente 1) — PR 3, Commit 2.
// Integração no webhook: quando a fatura de upgrade é PAGA, aplica o plano.
// Prova: fatura comum não muda plano; fatura de upgrade muda empresas.plano_id
// e marca solicitação paga; idempotência; inconsistência de negócio não quebra
// o webhook; erro técnico gera retry (500); evento não-pago não aplica.

const test = require('node:test');
const assert = require('node:assert/strict');

const { processarWebhook } = require('../services/asaasWebhookService');

const PLANO_ID = '11111111-1111-1111-1111-111111111111';

function body(over = {}) {
  return {
    id: over.id || 'evt_1',
    event: over.event || 'PAYMENT_CONFIRMED',
    payment: {
      id: 'pay_1',
      status: 'CONFIRMED',
      confirmedDate: '2026-07-16',
      ...over.payment,
    },
  };
}
function fatura(over = {}) {
  return { id: 'fat_1', empresa_id: 'empresa_local', asaas_id: 'pay_1', status: 'pendente', pago_em: null, due_date: '2000-01-01', invoice_url: 'https://sandbox.asaas.com/i/pay_1', bank_slip_url: null, ...over };
}
function empresa(over = {}) {
  return { id: 'empresa_local', status: 'trial', suspension_reason: null, suspension_source: null, trial_ends_at: '2000-01-01T00:00:00.000Z', ...over };
}
function solic(over = {}) {
  return { id: 'sol_1', status: 'pendente', empresa_id: 'empresa_local', plano_novo_id: PLANO_ID, fatura_id: 'fat_1', asaas_payment_id: 'pay_1', ...over };
}
const PLANO_OK = { id: PLANO_ID, ativo: true, arquivado_em: null };

function criarSupabaseMock(cenario = {}) {
  const eventos = new Map();
  const rec = { inserts: [], updates: [] };
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

  function builder(tabela) {
    const ctx = { tabela, op: 'select', payload: null, filtros: {} };
    const api = {
      select() { return api; },
      insert(p) { ctx.op = 'insert'; ctx.payload = p; rec.inserts.push({ tabela, payload: clone(p) }); return api; },
      update(p) { ctx.op = 'update'; ctx.payload = p; rec.updates.push({ tabela, payload: clone(p), filtros: { ...ctx.filtros } }); return api; },
      eq(c, v) { ctx.filtros[c] = v; return api; },
      single() { return resolver(false); },
      maybeSingle() { return resolver(true); },
      then(resolve) { resolver().then(resolve); },
    };

    async function resolver(maybe = false) {
      // asaas_webhook_events (idempotência)
      if (tabela === 'asaas_webhook_events') {
        if (ctx.op === 'insert') {
          if (eventos.has(ctx.payload.event_id)) return { data: null, error: { code: '23505', message: 'dup' } };
          const ev = { id: `wh_${eventos.size + 1}`, received_at: new Date().toISOString(), ...clone(ctx.payload) };
          eventos.set(ev.event_id, ev);
          return { data: clone(ev), error: null };
        }
        if (ctx.op === 'update') {
          const ev = ctx.filtros.event_id ? eventos.get(ctx.filtros.event_id) : Array.from(eventos.values()).find((e) => e.id === ctx.filtros.id);
          if (!ev) return { data: null, error: { code: 'PGRST116' } };
          for (const [c, v] of Object.entries(ctx.filtros)) { if (ev[c] !== v) return { data: null, error: { code: 'PGRST116' } }; }
          Object.assign(ev, clone(ctx.payload));
          return { data: clone(ev), error: null };
        }
        const ev = ctx.filtros.event_id ? eventos.get(ctx.filtros.event_id) : null;
        return { data: ev ? clone(ev) : null, error: ev ? null : (maybe ? null : { code: 'PGRST116' }) };
      }

      // faturas
      if (tabela === 'faturas') {
        if (ctx.op === 'update') {
          if (ctx.filtros.status && (cenario.fatura?.status) !== ctx.filtros.status) return { data: null, error: null };
          return { data: { ...clone(cenario.fatura), ...clone(ctx.payload) }, error: null };
        }
        const f = cenario.fatura || null;
        if (f && (!ctx.filtros.asaas_id || f.asaas_id === ctx.filtros.asaas_id)) return { data: clone(f), error: null };
        return { data: null, error: maybe ? null : { code: 'PGRST116' } };
      }

      // empresas
      if (tabela === 'empresas') {
        if (ctx.op === 'update') {
          const mexePlano = Object.prototype.hasOwnProperty.call(ctx.payload, 'plano_id');
          if (mexePlano && cenario.empresaPlanoUpdateError) return { data: null, error: cenario.empresaPlanoUpdateError };
          if (!mexePlano && cenario.empresaStatusUpdateError) return { data: null, error: cenario.empresaStatusUpdateError };
          return { data: { ...clone(cenario.empresa), ...clone(ctx.payload) }, error: null };
        }
        const e = cenario.empresa || null;
        if (e && (!ctx.filtros.id || e.id === ctx.filtros.id)) return { data: clone(e), error: null };
        return { data: null, error: { code: 'PGRST116' } };
      }

      // solicitacoes_upgrade_plano
      if (tabela === 'solicitacoes_upgrade_plano') {
        if (ctx.op === 'update') return { data: null, error: cenario.solicUpdateError ?? null };
        if (cenario.solicSelectError) return { data: null, error: cenario.solicSelectError };
        if (ctx.filtros.fatura_id) return { data: cenario.solicByFatura ? clone(cenario.solicByFatura) : null, error: null };
        if (ctx.filtros.asaas_payment_id) return { data: cenario.solicByPayment ? clone(cenario.solicByPayment) : null, error: null };
        return { data: null, error: null };
      }

      // planos
      if (tabela === 'planos') {
        return { data: cenario.planoNovo ? clone(cenario.planoNovo) : null, error: cenario.planoSelectError ?? null };
      }

      return { data: null, error: null };
    }

    return api;
  }

  return { from: builder, __rec: rec, __eventos: eventos };
}

function updatesDe(rec, tabela) { return rec.updates.filter((u) => u.tabela === tabela); }
function updateComPlanoId(rec) { return updatesDe(rec, 'empresas').find((u) => Object.prototype.hasOwnProperty.call(u.payload, 'plano_id')); }

// ── Testes ────────────────────────────────────────────────────────────────────

test('fatura de upgrade paga → aplica plano_id e marca solicitação paga', async () => {
  const supabase = criarSupabaseMock({ fatura: fatura(), empresa: empresa(), solicByFatura: solic(), planoNovo: PLANO_OK });
  const r = await processarWebhook({ supabase, body: body() });
  assert.equal(r.httpStatus, 200);
  assert.equal(r.resultado.processed, true);
  const upPlano = updateComPlanoId(supabase.__rec);
  assert.ok(upPlano, 'empresas.plano_id deve ser aplicado');
  assert.equal(upPlano.payload.plano_id, PLANO_ID);
  const upSolic = updatesDe(supabase.__rec, 'solicitacoes_upgrade_plano');
  assert.equal(upSolic.length, 1);
  assert.equal(upSolic[0].payload.status, 'pago');
  assert.ok(upSolic[0].payload.pago_em);
});

test('fatura comum paga (sem solicitação) → NÃO muda plano, mas ativa empresa', async () => {
  const supabase = criarSupabaseMock({ fatura: fatura(), empresa: empresa(), solicByFatura: null, solicByPayment: null });
  const r = await processarWebhook({ supabase, body: body() });
  assert.equal(r.httpStatus, 200);
  assert.equal(updateComPlanoId(supabase.__rec), undefined, 'não pode escrever plano_id');
  // Regra atual preservada: trial pagou → empresa vira ativo (update de status).
  const upStatus = updatesDe(supabase.__rec, 'empresas').find((u) => u.payload.status === 'ativo');
  assert.ok(upStatus, 'empresa trial deve ser ativada como antes');
});

test('webhook duplicado → idempotente (aplica plano só uma vez)', async () => {
  const supabase = criarSupabaseMock({ fatura: fatura(), empresa: empresa(), solicByFatura: solic(), planoNovo: PLANO_OK });
  const r1 = await processarWebhook({ supabase, body: body() });
  const r2 = await processarWebhook({ supabase, body: body() });
  assert.equal(r1.resultado.processed, true);
  assert.equal(r2.resultado.idempotente, true); // 2ª entrega barrada na persistência
  assert.equal(updatesDe(supabase.__rec, 'empresas').filter((u) => Object.prototype.hasOwnProperty.call(u.payload, 'plano_id')).length, 1);
});

test('solicitação já paga → não reaplica plano', async () => {
  const supabase = criarSupabaseMock({ fatura: fatura(), empresa: empresa(), solicByFatura: solic({ status: 'pago' }), planoNovo: PLANO_OK });
  const r = await processarWebhook({ supabase, body: body() });
  assert.equal(r.httpStatus, 200);
  assert.equal(updateComPlanoId(supabase.__rec), undefined);
});

test('plano arquivado no pagamento → marca falhou, NÃO aplica, webhook não quebra', async () => {
  const supabase = criarSupabaseMock({ fatura: fatura(), empresa: empresa(), solicByFatura: solic(), planoNovo: { id: PLANO_ID, ativo: true, arquivado_em: '2026-07-01' } });
  const r = await processarWebhook({ supabase, body: body() });
  assert.equal(r.httpStatus, 200);
  assert.equal(r.resultado.processed, true);
  assert.equal(updateComPlanoId(supabase.__rec), undefined);
  const upSolic = updatesDe(supabase.__rec, 'solicitacoes_upgrade_plano');
  assert.equal(upSolic[0].payload.status, 'falhou');
});

test('empresa_id divergente entre fatura e solicitação → falhou, sem aplicar', async () => {
  const supabase = criarSupabaseMock({ fatura: fatura(), empresa: empresa(), solicByFatura: solic({ empresa_id: 'outra' }), planoNovo: PLANO_OK });
  const r = await processarWebhook({ supabase, body: body() });
  assert.equal(r.httpStatus, 200);
  assert.equal(updateComPlanoId(supabase.__rec), undefined);
  assert.equal(updatesDe(supabase.__rec, 'solicitacoes_upgrade_plano')[0].payload.status, 'falhou');
});

test('fallback por asaas_payment_id (solicitação sem fatura_id vinculado)', async () => {
  const supabase = criarSupabaseMock({ fatura: fatura(), empresa: empresa(), solicByFatura: null, solicByPayment: solic({ fatura_id: null }), planoNovo: PLANO_OK });
  const r = await processarWebhook({ supabase, body: body() });
  assert.equal(r.httpStatus, 200);
  const upPlano = updateComPlanoId(supabase.__rec);
  assert.ok(upPlano);
  assert.equal(upPlano.payload.plano_id, PLANO_ID);
});

test('evento não-pago (OVERDUE) → não aplica plano', async () => {
  const supabase = criarSupabaseMock({ fatura: fatura(), empresa: empresa(), solicByFatura: solic(), planoNovo: PLANO_OK });
  const r = await processarWebhook({ supabase, body: body({ id: 'evt_ov', event: 'PAYMENT_OVERDUE', payment: { id: 'pay_1', status: 'OVERDUE' } }) });
  assert.equal(r.httpStatus, 200);
  assert.equal(updateComPlanoId(supabase.__rec), undefined);
});

test('erro técnico ao aplicar plano → 500 para retry (status da empresa já ok)', async () => {
  const supabase = criarSupabaseMock({ fatura: fatura(), empresa: empresa(), solicByFatura: solic(), planoNovo: PLANO_OK, empresaPlanoUpdateError: { message: 'db down' } });
  const r = await processarWebhook({ supabase, body: body() });
  assert.equal(r.httpStatus, 500);
});
