'use strict';

// notificacaoService.js exige config/supabase (client real) no topo do módulo, que
// process.exit(1) sem SUPABASE_URL/SUPABASE_SERVICE_KEY no .env. dispatchService.js
// chama notificacaoService de forma best-effort (fire-and-forget, nunca rejeita — ver
// notificacaoService.criarNotificacao), mas ainda assim tentaria uma conexão de rede
// real e lenta nestes testes. Intercepta ANTES de carregar dispatchService, mesmo padrão
// já usado em authEmailConfirmacao.test.js/aiRealToolsAuthz.test.js.
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '../notificacaoService' || /[\\/]services[\\/]notificacaoService$/.test(request)) {
    return { criarParaUsuario: async () => null, criarNotificacao: async () => null, criarParaEmpresa: async () => [] };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  intersectRecipients,
  mapRpcError,
  directAssign,
  createOfferRound,
  acceptOffer,
  declineOffer,
  cancelRound,
} = require('../services/campaign/dispatchService');
const { CampaignError } = require('../services/campaign/campaignService');
const { PERMISSION_BY_KEY, TEMPLATE_BASELINE_ALLOW, TEMPLATE_KEYS } = require('../services/permissions/permissionRegistry');

Module._load = originalLoad; // restaura após carregar os módulos

// ---------------- intersectRecipients (puro, §12) ----------------

function elig(overrides = {}) {
  return {
    driver_id: 'd1', asset_id: 'a1', composition_id: null,
    eligibility: 'ELIGIBLE', reasons: [], warnings: [],
    ...overrides,
  };
}

test('intersectRecipients: sem seleção explícita usa TODOS os elegíveis/com aviso', () => {
  const eligibility = { candidates: [elig(), elig({ driver_id: 'd2', eligibility: 'ELIGIBLE_WITH_WARNINGS' }), elig({ driver_id: 'd3', eligibility: 'INELIGIBLE' })] };
  const { recipients, excluded } = intersectRecipients(null, eligibility);
  assert.equal(recipients.length, 2);
  assert.deepEqual(recipients.map((r) => r.driver_id).sort(), ['d1', 'd2']);
  assert.equal(excluded.length, 0);
});

test('intersectRecipients: seleção explícita intercepta com elegibilidade atual (nunca amplia)', () => {
  const eligibility = { candidates: [elig({ driver_id: 'd1' }), elig({ driver_id: 'd2', eligibility: 'INELIGIBLE' })] };
  const requested = [{ driver_id: 'd1', asset_id: 'a1' }, { driver_id: 'd2', asset_id: 'a1' }, { driver_id: 'd-estranho', asset_id: 'a9' }];
  const { recipients, excluded } = intersectRecipients(requested, eligibility);
  assert.equal(recipients.length, 1);
  assert.equal(recipients[0].driver_id, 'd1');
  assert.equal(excluded.length, 2);
  assert.ok(excluded.some((e) => e.driver_id === 'd2'));
  assert.ok(excluded.some((e) => e.driver_id === 'd-estranho'));
});

test('intersectRecipients: recurso diferente do candidato elegível não casa (chave inclui asset/composition)', () => {
  const eligibility = { candidates: [elig({ driver_id: 'd1', asset_id: 'a1' })] };
  const { recipients, excluded } = intersectRecipients([{ driver_id: 'd1', asset_id: 'a2' }], eligibility);
  assert.equal(recipients.length, 0);
  assert.equal(excluded.length, 1);
});

// ---------------- mapRpcError (puro) ----------------

test('mapRpcError: mapeia códigos conhecidos da RPC para status/code corretos', () => {
  const e1 = mapRpcError({ message: 'offer_not_owned_by_driver' });
  assert.ok(e1 instanceof CampaignError);
  assert.equal(e1.status, 403);
  assert.equal(e1.code, 'offer_not_owned_by_driver');

  const e2 = mapRpcError({ message: 'round_expired' });
  assert.equal(e2.status, 409);
  assert.equal(e2.code, 'round_expired');

  const e3 = mapRpcError({ message: 'planned_trip_not_dispatchable: PLANNED' }); // formato "code: detalhe"
  assert.equal(e3.code, 'planned_trip_not_dispatchable');
  assert.equal(e3.status, 409);
});

test('mapRpcError: código desconhecido cai em erro genérico 500, nunca inventa status', () => {
  const e = mapRpcError({ message: 'algo_totalmente_novo_nao_mapeado' });
  assert.equal(e.status, 500);
  assert.equal(e.code, 'dispatch_database_error');
});

test('mapRpcError: schema ausente (42P01) mapeia para 503 dispatch_schema_missing', () => {
  const e = mapRpcError({ code: '42P01', message: 'relation does not exist' });
  assert.equal(e.status, 503);
  assert.equal(e.code, 'dispatch_schema_missing');
});

// ---------------- permissionRegistry (S43/S44) ----------------

test('permissionRegistry: campaign.dispatch e campaign.dispatch_respond existem com entitlement operation_campaign', () => {
  assert.ok(PERMISSION_BY_KEY['campaign.dispatch']);
  assert.equal(PERMISSION_BY_KEY['campaign.dispatch'].entitlementCodigo, 'operation_campaign');
  assert.ok(PERMISSION_BY_KEY['campaign.dispatch_respond']);
  assert.equal(PERMISSION_BY_KEY['campaign.dispatch_respond'].entitlementCodigo, 'operation_campaign');
});

test('permissionRegistry: campaign.dispatch segue a mesma distribuição de campaign.manage (administrador/gerente_frota)', () => {
  for (const key of [TEMPLATE_KEYS.ADMINISTRADOR, TEMPLATE_KEYS.GERENTE_FROTA]) {
    assert.ok(TEMPLATE_BASELINE_ALLOW[key].includes('campaign.dispatch'), `${key} deveria ter campaign.dispatch`);
  }
  for (const key of [TEMPLATE_KEYS.GERENTE_FILIAL, TEMPLATE_KEYS.GERENTE_REGIONAL, TEMPLATE_KEYS.GERENTE_NACIONAL, TEMPLATE_KEYS.OPERADOR, TEMPLATE_KEYS.FINANCEIRO]) {
    assert.ok(!TEMPLATE_BASELINE_ALLOW[key].includes('campaign.dispatch'), `${key} NAO deveria ter campaign.dispatch`);
  }
});

test('permissionRegistry: motorista recebe campaign.dispatch_respond por padrão (sem legado equivalente)', () => {
  assert.ok(TEMPLATE_BASELINE_ALLOW[TEMPLATE_KEYS.MOTORISTA].includes('campaign.dispatch_respond'));
});

// ---------------- forma dos parâmetros passados às RPCs (spy) ----------------
// Não reproduz a atomicidade (já provada contra Postgres real nas pgtests) — só garante
// que o service chama a RPC certa com os nomes de parâmetro certos, e nunca propaga uma
// falha de materialização (fase 2, best-effort) como falha da decisão do vencedor (fase 1).

function makeSupabase({ rpcImpl, tableData = {} } = {}) {
  function builder(tabela) {
    const rows = () => (tableData[tabela] || []);
    const b = {
      select() { return b; }, eq() { return b; }, in() { return b; }, is() { return b; },
      order() { return b; }, limit() { return b; },
      maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
      single() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
      then(resolve) { resolve({ data: rows(), error: null }); },
    };
    return b;
  }
  const calls = [];
  return {
    _calls: calls,
    from: (t) => builder(t),
    rpc: (name, params) => {
      calls.push({ name, params });
      return Promise.resolve(rpcImpl ? rpcImpl(name, params) : { data: null, error: null });
    },
  };
}

const LEGACY = { mode: 'LEGACY_COMPANY' };
const EMP = 'e1';

function eligibilityFixture() {
  return {
    operation_campaigns: [{ id: 'c1', empresa_id: EMP }],
    campaign_operational_units: [],
    campaign_planned_trips: [{ id: 't1', empresa_id: EMP, campaign_id: 'c1', plan_version_id: 'p1', status: 'PLANNED', required_capacity_kg: 10000, planned_quantity: 10, quantity_unit: 'ton', candidate_driver_id: null, candidate_asset_id: null, candidate_composition_id: null }],
    driver_vehicle_assignments: [{ empresa_id: EMP, driver_id: 'd1', asset_id: 'a1', composition_id: null, assignment_status: 'active', valid_until: null }],
    usuarios: [{ id: 'd1', empresa_id: EMP, status: 'ativo' }],
    fleet_assets: [{ id: 'a1', empresa_id: EMP, status: 'active', unidade_operacional_id: null, plate: 'ABC1D23', useful_capacity_kg: 30000, metadata: {} }],
    vehicle_compositions: [],
    asset_documents: [],
    maintenance_events: [],
  };
}

test('directAssign: chama dispatch_round_create com mode=DIRECT e exatamente 1 destinatário', async () => {
  const round = { id: 'r1', empresa_id: EMP, planned_trip_id: 't1', campaign_id: 'c1', status: 'ASSIGNED', mode: 'DIRECT', winner_offer_id: 'o1' };
  const supabase = makeSupabase({
    tableData: { ...eligibilityFixture(), dispatch_offers: [{ id: 'o1', empresa_id: EMP, round_id: 'r1', driver_id: 'd1', asset_id: 'a1', status: 'ACCEPTED' }] },
    rpcImpl: (name) => (name === 'dispatch_round_create' ? { data: round, error: null } : { data: null, error: { message: 'nao_deveria_chamar_outra_rpc' } }),
  });

  const result = await directAssign(supabase, {
    empresaId: EMP, campaignId: 'c1', planId: 'p1', tripId: 't1',
    driverId: 'd1', assetId: 'a1', compositionId: null,
    materializationOptions: { modalidade_calculo: 'valor_fixo', valor_frete: 500 },
    user: { uid: 'admin1' }, operationalScope: LEGACY, correlation: { request_id: 'req-1', correlation_id: 'corr-1' },
  });

  assert.equal(supabase._calls.length, 1);
  assert.equal(supabase._calls[0].name, 'dispatch_round_create');
  const p = supabase._calls[0].params;
  assert.equal(p.p_mode, 'DIRECT');
  assert.equal(p.p_recipients.length, 1);
  assert.equal(p.p_recipients[0].driver_id, 'd1');
  assert.equal(p.p_planned_trip_id, 't1');
  assert.equal(p.p_request_id, 'req-1');
  assert.equal(result.round.id, 'r1');
  // Materializacao falha aqui de proposito (loadApprovedContext acha um plano nao aprovado
  // no fixture) — o importante e que a falha vira materialization_error, nunca um throw.
  assert.ok(result.materialization_error || result.materialization);
});

test('directAssign: candidato pedido não elegível → rejeita ANTES de chamar a RPC', async () => {
  const supabase = makeSupabase({ tableData: eligibilityFixture() });
  await assert.rejects(
    () => directAssign(supabase, {
      empresaId: EMP, campaignId: 'c1', planId: 'p1', tripId: 't1',
      driverId: 'driver-nao-vinculado', assetId: 'a1', compositionId: null,
      materializationOptions: {}, user: { uid: 'admin1' }, operationalScope: LEGACY, correlation: {},
    }),
    (err) => err instanceof CampaignError && err.code === 'candidate_no_longer_eligible',
  );
  assert.equal(supabase._calls.length, 0, 'nao deve chamar RPC nenhuma se o candidato nao passou na revalidacao');
});

test('createOfferRound: sem destinatarios elegiveis apos intersecao -> rejeita antes da RPC', async () => {
  const supabase = makeSupabase({ tableData: eligibilityFixture() });
  await assert.rejects(
    () => createOfferRound(supabase, {
      empresaId: EMP, campaignId: 'c1', planId: 'p1', tripId: 't1',
      requestedRecipients: [{ driver_id: 'ninguem', asset_id: 'x' }],
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      materializationOptions: {}, user: { uid: 'admin1' }, operationalScope: LEGACY, correlation: {},
    }),
    (err) => err instanceof CampaignError && err.code === 'no_eligible_recipients',
  );
  assert.equal(supabase._calls.length, 0);
});

test('createOfferRound: sem seleção explícita oferta a TODOS os elegíveis e chama mode=OFFER', async () => {
  const round = { id: 'r2', empresa_id: EMP, planned_trip_id: 't1', campaign_id: 'c1', status: 'OPEN', mode: 'OFFER' };
  const supabase = makeSupabase({
    tableData: { ...eligibilityFixture(), dispatch_offers: [{ id: 'o1', empresa_id: EMP, round_id: 'r2', driver_id: 'd1', status: 'PENDING' }] },
    rpcImpl: () => ({ data: round, error: null }),
  });
  const result = await createOfferRound(supabase, {
    empresaId: EMP, campaignId: 'c1', planId: 'p1', tripId: 't1',
    requestedRecipients: null,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    materializationOptions: {}, user: { uid: 'admin1' }, operationalScope: LEGACY, correlation: {},
  });
  assert.equal(supabase._calls[0].params.p_mode, 'OFFER');
  assert.equal(supabase._calls[0].params.p_recipients.length, 1);
  assert.equal(result.round.id, 'r2');
  assert.equal(result.excluded_requested_recipients.length, 0);
});

test('acceptOffer: propaga o offer_id/driver_id certos para dispatch_offer_accept', async () => {
  const offer = { id: 'o1', empresa_id: EMP, round_id: 'r1', driver_id: 'd1', asset_id: 'a1', status: 'ACCEPTED' };
  const round = { id: 'r1', empresa_id: EMP, planned_trip_id: 't1', campaign_id: 'c1', plan_version_id: 'p1', status: 'ASSIGNED', materialization_options: {} };
  const supabase = makeSupabase({
    tableData: { ...eligibilityFixture(), dispatch_rounds: [round], dispatch_offers: [offer] },
    rpcImpl: (name) => (name === 'dispatch_offer_accept' ? { data: offer, error: null } : { data: null, error: { message: 'unexpected_rpc' } }),
  });
  const result = await acceptOffer(supabase, {
    empresaId: EMP, campaignId: 'c1', planId: 'p1', offerId: 'o1', driverId: 'd1',
    user: { uid: 'd1' }, operationalScope: LEGACY, correlation: { request_id: 'req-2' },
  });
  assert.equal(supabase._calls[0].name, 'dispatch_offer_accept');
  assert.equal(supabase._calls[0].params.p_offer_id, 'o1');
  assert.equal(supabase._calls[0].params.p_driver_id, 'd1');
  assert.equal(result.offer.id, 'o1');
});

test('acceptOffer: erro da RPC (ex.: oferta de outro motorista) propaga como CampaignError 403, nao mascarado', async () => {
  const supabase = makeSupabase({
    rpcImpl: () => ({ data: null, error: { message: 'offer_not_owned_by_driver' } }),
  });
  await assert.rejects(
    () => acceptOffer(supabase, {
      empresaId: EMP, campaignId: 'c1', planId: 'p1', offerId: 'o1', driverId: 'd2',
      user: { uid: 'd2' }, operationalScope: LEGACY, correlation: {},
    }),
    (err) => err instanceof CampaignError && err.status === 403 && err.code === 'offer_not_owned_by_driver',
  );
});

test('declineOffer / cancelRound: repassam os parametros esperados para a RPC correta', async () => {
  const supabase1 = makeSupabase({ rpcImpl: (name, p) => ({ data: { id: p.p_offer_id, status: 'DECLINED' }, error: null }) });
  const d = await declineOffer(supabase1, { empresaId: EMP, offerId: 'o9', driverId: 'd1', reason: 'sem tempo', correlation: {} });
  assert.equal(supabase1._calls[0].name, 'dispatch_offer_decline');
  assert.equal(supabase1._calls[0].params.p_reason, 'sem tempo');
  assert.equal(d.offer.status, 'DECLINED');

  const supabase2 = makeSupabase({
    tableData: { dispatch_offers: [] },
    rpcImpl: (name, p) => ({ data: { id: p.p_round_id, empresa_id: EMP, status: 'CANCELLED' }, error: null }),
  });
  const c = await cancelRound(supabase2, { empresaId: EMP, roundId: 'r9', actorId: 'admin1', reason: 'plano mudou' });
  assert.equal(supabase2._calls[0].name, 'dispatch_round_cancel');
  assert.equal(supabase2._calls[0].params.p_reason, 'plano mudou');
  assert.equal(c.round.status, 'CANCELLED');
});
