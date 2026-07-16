// Frente #8-C (Billing v2 / Macrofrente 1) — PR 3, Commit 1.
// Cobre a decisão PURA (decidirAplicacaoUpgrade) e o serviço de I/O
// (aplicarUpgradePago) com supabase mockado. Prova: aplica plano só no caso
// válido, ordem plano→solicitação, marca 'falhou' em inconsistência terminal,
// idempotência (não reprocessa solicitação não-pendente), fallback por
// asaas_payment_id, e que erro técnico (DB) é lançado para retry do webhook.

const test = require('node:test');
const assert = require('node:assert/strict');

const { decidirAplicacaoUpgrade } = require('../services/upgradeDomainService');
const { aplicarUpgradePago } = require('../services/upgradeApplyService');

const PLANO_ID = '11111111-1111-1111-1111-111111111111';

function solic(over = {}) {
  return { id: 'sol-1', status: 'pendente', empresa_id: 'e1', plano_novo_id: PLANO_ID, fatura_id: 'fat-1', ...over };
}
const PLANO_OK = { id: PLANO_ID, ativo: true, arquivado_em: null };

// ── Decisão pura ──────────────────────────────────────────────────────────────

test('decisão: sem solicitação → ignorar', () => {
  assert.deepEqual(
    decidirAplicacaoUpgrade({ solicitacao: null, fatura: { empresa_id: 'e1', status: 'pago' }, planoNovo: PLANO_OK }),
    { acao: 'ignorar', motivo: 'sem_solicitacao' }
  );
});

test('decisão: solicitação já paga → ignorar (idempotente)', () => {
  const r = decidirAplicacaoUpgrade({ solicitacao: solic({ status: 'pago' }), fatura: { empresa_id: 'e1', status: 'pago' }, planoNovo: PLANO_OK });
  assert.equal(r.acao, 'ignorar');
  assert.equal(r.motivo, 'solicitacao_pago');
});

test('decisão: solicitação cancelada → ignorar', () => {
  const r = decidirAplicacaoUpgrade({ solicitacao: solic({ status: 'cancelado' }), fatura: { empresa_id: 'e1', status: 'pago' }, planoNovo: PLANO_OK });
  assert.equal(r.acao, 'ignorar');
});

test('decisão: fatura não paga → ignorar', () => {
  const r = decidirAplicacaoUpgrade({ solicitacao: solic(), fatura: { empresa_id: 'e1', status: 'pendente' }, planoNovo: PLANO_OK });
  assert.equal(r.acao, 'ignorar');
  assert.equal(r.motivo, 'fatura_nao_paga');
});

test('decisão: empresa_id divergente → falhar', () => {
  const r = decidirAplicacaoUpgrade({ solicitacao: solic({ empresa_id: 'e2' }), fatura: { empresa_id: 'e1', status: 'pago' }, planoNovo: PLANO_OK });
  assert.equal(r.acao, 'falhar');
  assert.equal(r.motivo, 'empresa_divergente');
});

test('decisão: plano inexistente → falhar', () => {
  const r = decidirAplicacaoUpgrade({ solicitacao: solic(), fatura: { empresa_id: 'e1', status: 'pago' }, planoNovo: null });
  assert.equal(r.acao, 'falhar');
  assert.equal(r.motivo, 'plano_inexistente');
});

test('decisão: plano inativo → falhar', () => {
  const r = decidirAplicacaoUpgrade({ solicitacao: solic(), fatura: { empresa_id: 'e1', status: 'pago' }, planoNovo: { id: PLANO_ID, ativo: false, arquivado_em: null } });
  assert.equal(r.acao, 'falhar');
  assert.equal(r.motivo, 'plano_inativo');
});

test('decisão: plano arquivado → falhar', () => {
  const r = decidirAplicacaoUpgrade({ solicitacao: solic(), fatura: { empresa_id: 'e1', status: 'pago' }, planoNovo: { id: PLANO_ID, ativo: true, arquivado_em: '2026-07-01' } });
  assert.equal(r.acao, 'falhar');
  assert.equal(r.motivo, 'plano_arquivado');
});

test('decisão: plano divergente (id ≠ solicitação) → falhar', () => {
  const r = decidirAplicacaoUpgrade({ solicitacao: solic(), fatura: { empresa_id: 'e1', status: 'pago' }, planoNovo: { id: 'outro', ativo: true, arquivado_em: null } });
  assert.equal(r.acao, 'falhar');
  assert.equal(r.motivo, 'plano_divergente');
});

test('decisão: tudo válido → aplicar com planoNovoId', () => {
  const r = decidirAplicacaoUpgrade({ solicitacao: solic(), fatura: { empresa_id: 'e1', status: 'pago' }, planoNovo: PLANO_OK });
  assert.equal(r.acao, 'aplicar');
  assert.equal(r.planoNovoId, PLANO_ID);
});

// ── Serviço de I/O ────────────────────────────────────────────────────────────

function makeSupabase(scenario = {}) {
  const rec = { updates: [] };
  function builder(tabela) {
    const ctx = { tabela, op: 'select', filtros: {}, payload: null, maybe: false };
    const b = {
      select() { return b; },
      update(p) { ctx.op = 'update'; ctx.payload = p; rec.updates.push({ tabela, payload: p, filtros: ctx.filtros }); return b; },
      eq(c, v) { ctx.filtros[c] = v; return b; },
      maybeSingle() { ctx.maybe = true; return resolve(ctx); },
      then(onF, onR) { return resolve(ctx).then(onF, onR); },
    };
    return b;
  }
  async function resolve(ctx) {
    const { tabela, op, filtros } = ctx;
    if (op === 'update') {
      if (tabela === 'empresas') return { error: scenario.empresaUpdateError ?? null };
      if (tabela === 'solicitacoes_upgrade_plano') return { error: scenario.solicUpdateError ?? null };
      return { error: null };
    }
    if (tabela === 'solicitacoes_upgrade_plano') {
      if (scenario.solicSelectError) return { data: null, error: scenario.solicSelectError };
      if (filtros.fatura_id) return { data: scenario.solicByFatura ?? null, error: null };
      if (filtros.asaas_payment_id) return { data: scenario.solicByPayment ?? null, error: null };
      return { data: null, error: null };
    }
    if (tabela === 'planos') {
      return { data: scenario.planoNovo ?? null, error: scenario.planoSelectError ?? null };
    }
    return { data: null, error: null };
  }
  return { from: (t) => builder(t), __rec: rec };
}

const ARGS = { faturaId: 'fat-1', empresaId: 'e1', asaasPaymentId: 'pay_1' };
async function capturar(p) { try { await p; return null; } catch (e) { return e; } }

test('IO: fatura comum (sem solicitação) → sem_solicitacao, nenhuma escrita', async () => {
  const supabase = makeSupabase({ solicByFatura: null, solicByPayment: null });
  const r = await aplicarUpgradePago({ supabase, ...ARGS });
  assert.equal(r.resultado, 'sem_solicitacao');
  assert.equal(supabase.__rec.updates.length, 0);
});

test('IO: upgrade pago válido → aplicado; ordem empresas(plano_id) → solicitação(pago)', async () => {
  const supabase = makeSupabase({ solicByFatura: solic(), planoNovo: PLANO_OK });
  const r = await aplicarUpgradePago({ supabase, ...ARGS });
  assert.equal(r.resultado, 'aplicado');
  assert.equal(r.planoNovoId, PLANO_ID);
  const ups = supabase.__rec.updates;
  assert.equal(ups.length, 2);
  assert.equal(ups[0].tabela, 'empresas');
  assert.equal(ups[0].payload.plano_id, PLANO_ID);
  assert.equal(ups[1].tabela, 'solicitacoes_upgrade_plano');
  assert.equal(ups[1].payload.status, 'pago');
  assert.ok(ups[1].payload.pago_em);
  assert.equal(ups[1].filtros.status, 'pendente'); // CAS idempotente
});

test('IO: fallback por asaas_payment_id (sem fatura_id vinculado)', async () => {
  const supabase = makeSupabase({ solicByFatura: null, solicByPayment: solic(), planoNovo: PLANO_OK });
  const r = await aplicarUpgradePago({ supabase, ...ARGS });
  assert.equal(r.resultado, 'aplicado');
});

test('IO: solicitação já paga → ignorado, nenhuma escrita', async () => {
  const supabase = makeSupabase({ solicByFatura: solic({ status: 'pago' }), planoNovo: PLANO_OK });
  const r = await aplicarUpgradePago({ supabase, ...ARGS });
  assert.equal(r.resultado, 'ignorado');
  assert.equal(supabase.__rec.updates.length, 0);
});

test('IO: plano arquivado → falhou; marca falhou; NÃO escreve plano_id', async () => {
  const supabase = makeSupabase({ solicByFatura: solic(), planoNovo: { id: PLANO_ID, ativo: true, arquivado_em: '2026-07-01' } });
  const r = await aplicarUpgradePago({ supabase, ...ARGS });
  assert.equal(r.resultado, 'falhou');
  assert.equal(r.motivo, 'plano_arquivado');
  const ups = supabase.__rec.updates;
  assert.equal(ups.length, 1);
  assert.equal(ups[0].tabela, 'solicitacoes_upgrade_plano');
  assert.equal(ups[0].payload.status, 'falhou');
  assert.ok(!supabase.__rec.updates.some((u) => u.tabela === 'empresas'));
});

test('IO: empresa_id divergente → falhou, sem aplicar plano', async () => {
  const supabase = makeSupabase({ solicByFatura: solic({ empresa_id: 'e2' }), planoNovo: PLANO_OK });
  const r = await aplicarUpgradePago({ supabase, ...ARGS });
  assert.equal(r.resultado, 'falhou');
  assert.equal(r.motivo, 'empresa_divergente');
  assert.ok(!supabase.__rec.updates.some((u) => u.tabela === 'empresas'));
});

test('IO: erro de DB ao aplicar plano → lança (retry do webhook)', async () => {
  const supabase = makeSupabase({ solicByFatura: solic(), planoNovo: PLANO_OK, empresaUpdateError: { message: 'db down' } });
  const err = await capturar(aplicarUpgradePago({ supabase, ...ARGS }));
  assert.ok(err);
  assert.equal(err.dbError, true);
});

test('IO: erro de DB na consulta da solicitação → lança', async () => {
  const supabase = makeSupabase({ solicSelectError: { message: 'db down' } });
  const err = await capturar(aplicarUpgradePago({ supabase, ...ARGS }));
  assert.ok(err);
  assert.equal(err.dbError, true);
});
