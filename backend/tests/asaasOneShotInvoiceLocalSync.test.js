const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  sincronizarFaturaLocal,
  clientRequestId,
  parseArgs,
} = require('../services/billing/asaasOneShotInvoiceLocalSync');

const EMP = 'bc54e9a6-b54b-4ed2-9b7a-3833edebded6';
const CHG = 'pay_moeewnn1bslsyg9c';
const OUTRA = '22222222-2222-4222-8222-222222222222';
const REF = 'matopiba:billing:v1:charge:implantation:' + EMP;

function env(over = {}) { return { ASAAS_API_KEY: 'aact_dummy', BILLING_PRODUCTION_ALLOWLIST: EMP, ...over }; }
function empresa(over = {}) { return { id: EMP, nome: 'Empresa Foxtrot Teste', asaas_customer_id: null, ...over }; }
function chargeOk(over = {}) {
  return { id: CHG, status: 'PENDING', value: 5, billingType: 'PIX', externalReference: REF, dueDate: '2026-08-21', invoiceUrl: 'https://www.asaas.com/i/abc', bankSlipUrl: null, customer: 'cus_000194574257', paymentDate: null, ...over };
}
function mkDeps({ emp = empresa(), charge = chargeOk(), fatura = null, secret = true } = {}) {
  const calls = { upsert: 0, customer: 0, chargeGet: 0 };
  const logs = [];
  const deps = {
    agora: new Date('2026-08-18T12:00:00Z'),
    log: (o) => logs.push(o),
    carregarEmpresa: async () => emp,
    buscarChargeAsaas: async () => { calls.chargeGet += 1; return secret ? { secret_present: true, charge } : { secret_present: false, charge: null }; },
    buscarFaturaPorAsaasId: async () => fatura,
    upsertFaturaLocal: async ({ plano }) => { calls.upsert += 1; return { id: 'fat_new', will_insert: plano.will_insert }; },
    atualizarCustomerLocal: async () => { calls.customer += 1; },
  };
  return { deps, calls, logs };
}
const DRY = [`--empresa-id=${EMP}`, `--charge-id=${CHG}`, '--expected-value-centavos=500', '--expected-status=PENDING'];
const EXEC = [...DRY, '--execute-local-sync', '--confirm-local-invoice-upsert', '--sync-customer-local'];

// ---------- dry-run ----------

test('dry-run: só GET no Asaas, ZERO escrita, plano de insert', async () => {
  const { deps, calls } = mkDeps();
  const r = await sincronizarFaturaLocal({ argv: DRY, env: env(), deps });
  assert.equal(r.modo, 'dry-run');
  assert.equal(r.read_only, true);
  assert.equal(r.writes_planned.asaas, 0);
  assert.equal(r.local_invoice.will_insert, true);
  assert.equal(r.local_invoice.status, 'pendente');
  assert.equal(calls.upsert, 0);
  assert.equal(calls.customer, 0);
});

test('dry-run: fatura existente → plano de update (não insert)', async () => {
  const { deps } = mkDeps({ fatura: { id: 'fat_1', status: 'pendente' } });
  const r = await sincronizarFaturaLocal({ argv: DRY, env: env(), deps });
  assert.equal(r.local_invoice.found, true);
  assert.equal(r.local_invoice.will_update, true);
  assert.equal(r.local_invoice.will_insert, false);
});

test('dry-run: status PENDING → pendente', async () => {
  const { deps } = mkDeps();
  const r = await sincronizarFaturaLocal({ argv: DRY, env: env(), deps });
  assert.equal(r.local_invoice.status, 'pendente');
});

test('dry-run: status RECEIVED → pago', async () => {
  const { deps } = mkDeps({ charge: chargeOk({ status: 'RECEIVED', paymentDate: '2026-08-19' }) });
  const r = await sincronizarFaturaLocal({ argv: DRY, env: env(), deps });
  assert.equal(r.local_invoice.status, 'pago');
});

test('dry-run: customer local null → plano de update p/ cus_000194574257', async () => {
  const { deps } = mkDeps();
  const r = await sincronizarFaturaLocal({ argv: [...DRY, '--sync-customer-local'], env: env(), deps });
  assert.equal(r.local_customer.current, null);
  assert.equal(r.local_customer.planned, 'cus_000194574257');
  assert.equal(r.local_customer.will_update, true);
});

test('sem ASAAS_API_KEY → NEEDS_OWNER_RAILWAY_RUN, sem escrita', async () => {
  const { deps, calls } = mkDeps();
  const e = env(); delete e.ASAAS_API_KEY;
  const r = await sincronizarFaturaLocal({ argv: DRY, env: e, deps });
  assert.equal(r.result, 'NEEDS_OWNER_RAILWAY_RUN');
  assert.equal(calls.upsert, 0);
});

test('client_request_id determinístico', () => {
  assert.equal(clientRequestId(CHG), 'matopiba:local-sync:one-shot:pay_moeewnn1bslsyg9c');
});

// ---------- execute-local-sync (flags) ----------

test('execute sem --execute-local-sync → dry-run (não escreve)', async () => {
  const { deps, calls } = mkDeps();
  const r = await sincronizarFaturaLocal({ argv: [...DRY, '--confirm-local-invoice-upsert'], env: env(), deps });
  assert.equal(r.modo, 'dry-run');
  assert.equal(calls.upsert, 0);
});

test('execute sem --confirm-local-invoice-upsert → dry-run (não escreve)', async () => {
  const { deps, calls } = mkDeps();
  const r = await sincronizarFaturaLocal({ argv: [...DRY, '--execute-local-sync'], env: env(), deps });
  assert.equal(r.modo, 'dry-run');
  assert.equal(calls.upsert, 0);
});

test('execute com as 2 flags + estado ok → insere 1 fatura + atualiza customer', async () => {
  const { deps, calls } = mkDeps();
  const r = await sincronizarFaturaLocal({ argv: EXEC, env: env(), deps });
  assert.equal(r.modo, 'execute-local-sync');
  assert.equal(r.ok, true);
  assert.equal(r.acao, 'inserted');
  assert.equal(calls.upsert, 1);
  assert.equal(calls.customer, 1);
});

test('execute: fatura existente → update, não insert (idempotente)', async () => {
  const { deps, calls } = mkDeps({ fatura: { id: 'fat_1', status: 'pendente' } });
  const r = await sincronizarFaturaLocal({ argv: EXEC, env: env(), deps });
  assert.equal(r.acao, 'updated');
  assert.equal(calls.upsert, 1);
});

// ---------- fail-closed ----------

test('allowlist != 1 → aborta no execute', async () => {
  const { deps, calls } = mkDeps();
  await assert.rejects(
    () => sincronizarFaturaLocal({ argv: EXEC, env: env({ BILLING_PRODUCTION_ALLOWLIST: `${EMP},${OUTRA}` }), deps }),
    (e) => e.code === 'LOCAL_SYNC_ABORTADO' && e.motivos.includes('allowlist_nao_unica'),
  );
  assert.equal(calls.upsert, 0);
});

test('empresa fora da allowlist → aborta', async () => {
  const { deps } = mkDeps();
  await assert.rejects(
    () => sincronizarFaturaLocal({ argv: EXEC, env: env({ BILLING_PRODUCTION_ALLOWLIST: OUTRA }), deps }),
    (e) => e.code === 'LOCAL_SYNC_ABORTADO',
  );
});

test('charge não encontrada → aborta no execute', async () => {
  const { deps } = mkDeps({ charge: null });
  await assert.rejects(
    () => sincronizarFaturaLocal({ argv: EXEC, env: env(), deps }),
    (e) => e.code === 'LOCAL_SYNC_ABORTADO' && e.motivos.includes('charge_asaas_nao_encontrada'),
  );
});

test('charge_id divergente → aborta', async () => {
  const { deps } = mkDeps({ charge: chargeOk({ id: 'pay_outro' }) });
  await assert.rejects(
    () => sincronizarFaturaLocal({ argv: EXEC, env: env(), deps }),
    (e) => e.code === 'LOCAL_SYNC_ABORTADO' && e.motivos.includes('charge_id_divergente'),
  );
});

test('externalReference divergente → aborta', async () => {
  const { deps } = mkDeps({ charge: chargeOk({ externalReference: 'ref_errada' }) });
  await assert.rejects(
    () => sincronizarFaturaLocal({ argv: EXEC, env: env(), deps }),
    (e) => e.code === 'LOCAL_SYNC_ABORTADO' && e.motivos.includes('external_reference_divergente'),
  );
});

test('valor divergente → aborta', async () => {
  const { deps } = mkDeps({ charge: chargeOk({ value: 1 }) });
  await assert.rejects(
    () => sincronizarFaturaLocal({ argv: EXEC, env: env(), deps }),
    (e) => e.code === 'LOCAL_SYNC_ABORTADO' && e.motivos.includes('valor_divergente'),
  );
});

test('billingType != PIX → aborta', async () => {
  const { deps } = mkDeps({ charge: chargeOk({ billingType: 'BOLETO' }) });
  await assert.rejects(
    () => sincronizarFaturaLocal({ argv: EXEC, env: env(), deps }),
    (e) => e.code === 'LOCAL_SYNC_ABORTADO' && e.motivos.includes('billing_type_divergente'),
  );
});

test('customer local diferente → aborta sem override', async () => {
  const { deps, calls } = mkDeps({ emp: empresa({ asaas_customer_id: 'cus_diferente' }) });
  await assert.rejects(
    () => sincronizarFaturaLocal({ argv: EXEC, env: env(), deps }),
    (e) => e.code === 'LOCAL_SYNC_ABORTADO' && e.message.includes('customer_local_diferente'),
  );
  assert.equal(calls.upsert, 0);
});

test('nunca marca pago se Asaas ainda é PENDING', async () => {
  const { deps } = mkDeps();
  const r = await sincronizarFaturaLocal({ argv: EXEC, env: env(), deps });
  assert.equal(r.local_invoice.status, 'pendente');
});

test('logs não expõem ASAAS_API_KEY', async () => {
  const { deps, logs } = mkDeps();
  await sincronizarFaturaLocal({ argv: DRY, env: env(), deps });
  assert.equal(JSON.stringify(logs).includes('aact_dummy'), false);
});

test('parseArgs: dry-run default (sem flags de execução)', () => {
  const a = parseArgs(DRY);
  assert.equal(a.executeLocalSync, false);
  assert.equal(a.confirmLocalInvoiceUpsert, false);
  assert.equal(a.expectedValueCentavos, 500);
});
