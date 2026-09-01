'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyTrip, classifyAllTrips, computeResidualDemands, previewReplan, generateReplan,
} = require('../services/campaign/campaignReplanService');
const { createObjective } = require('../services/campaign/operationOrchestratorService');
const { approvePlan } = require('../services/campaign/campaignService');

// ============================================================================
// classifyTrip — cobre exatamente as categorias do §9-19: EXECUTED, COMMITTED
// (materializado em execução OU vencedor de Dispatch com materialização
// pendente), CANCELLED, UNCOMMITTED, UNKNOWN. Função pura, sem banco.
// ============================================================================

function trip(over = {}) {
  return { id: 't1', status: 'PLANNED', demand_id: 'd1', planned_quantity: 10, quantity_unit: 'ton', ...over };
}

test('classifyTrip: viagem bloqueada no plano -> UNCOMMITTED (nunca foi comprometida)', () => {
  const r = classifyTrip(trip({ status: 'BLOCKED' }), { linksByTrip: new Map(), fretesById: new Map(), roundsByTrip: new Map() });
  assert.equal(r.category, 'UNCOMMITTED');
});

test('classifyTrip: viagem cancelada no nivel do plano -> UNCOMMITTED', () => {
  const r = classifyTrip(trip({ status: 'CANCELLED' }), { linksByTrip: new Map(), fretesById: new Map(), roundsByTrip: new Map() });
  assert.equal(r.category, 'UNCOMMITTED');
});

test('classifyTrip: materializado com frete finalizado -> EXECUTED', () => {
  const linksByTrip = new Map([['t1', { planned_trip_id: 't1', frete_id: 'f1' }]]);
  const fretesById = new Map([['f1', { id: 'f1', status: 'finalizado' }]]);
  const r = classifyTrip(trip(), { linksByTrip, fretesById, roundsByTrip: new Map() });
  assert.equal(r.category, 'EXECUTED');
});

test('classifyTrip: materializado com frete em viagem -> COMMITTED (protegido)', () => {
  const linksByTrip = new Map([['t1', { planned_trip_id: 't1', frete_id: 'f1' }]]);
  const fretesById = new Map([['f1', { id: 'f1', status: 'em_viagem' }]]);
  const r = classifyTrip(trip(), { linksByTrip, fretesById, roundsByTrip: new Map() });
  assert.equal(r.category, 'COMMITTED');
  assert.equal(r.reason, 'FREIGHT_IN_EXECUTION');
});

test('classifyTrip: materializado com frete cancelado -> CANCELLED (quantidade volta ao residual)', () => {
  const linksByTrip = new Map([['t1', { planned_trip_id: 't1', frete_id: 'f1' }]]);
  const fretesById = new Map([['f1', { id: 'f1', status: 'cancelado' }]]);
  const r = classifyTrip(trip(), { linksByTrip, fretesById, roundsByTrip: new Map() });
  assert.equal(r.category, 'CANCELLED');
});

test('classifyTrip: link materializado sem frete correspondente -> UNKNOWN (nunca decide sozinho)', () => {
  const linksByTrip = new Map([['t1', { planned_trip_id: 't1', frete_id: 'f-inexistente' }]]);
  const r = classifyTrip(trip(), { linksByTrip, fretesById: new Map(), roundsByTrip: new Map() });
  assert.equal(r.category, 'UNKNOWN');
});

test('classifyTrip: frete com status fora do mapeamento conhecido -> UNKNOWN', () => {
  const linksByTrip = new Map([['t1', { planned_trip_id: 't1', frete_id: 'f1' }]]);
  const fretesById = new Map([['f1', { id: 'f1', status: 'status_desconhecido_xyz' }]]);
  const r = classifyTrip(trip(), { linksByTrip, fretesById, roundsByTrip: new Map() });
  assert.equal(r.category, 'UNKNOWN');
});

test('classifyTrip: nao materializado, rodada de Dispatch ASSIGNED -> COMMITTED (§12: vencedor decidido, fase 2 pendente)', () => {
  const roundsByTrip = new Map([['t1', [{ planned_trip_id: 't1', status: 'ASSIGNED' }]]]);
  const r = classifyTrip(trip(), { linksByTrip: new Map(), fretesById: new Map(), roundsByTrip });
  assert.equal(r.category, 'COMMITTED');
  assert.equal(r.reason, 'DISPATCH_WINNER_MATERIALIZATION_PENDING');
});

test('classifyTrip: nao materializado, rodada de Dispatch OPEN (motoristas ainda respondendo) -> UNKNOWN (bloqueia, humano decide)', () => {
  const roundsByTrip = new Map([['t1', [{ planned_trip_id: 't1', status: 'OPEN' }]]]);
  const r = classifyTrip(trip(), { linksByTrip: new Map(), fretesById: new Map(), roundsByTrip });
  assert.equal(r.category, 'UNKNOWN');
  assert.equal(r.reason, 'DISPATCH_ROUND_OPEN_AWAITING_RESOLUTION');
});

test('classifyTrip: nao materializado, so a sugestao default do planner (sem rodada nenhuma) -> UNCOMMITTED (livre para replan)', () => {
  const r = classifyTrip(trip({ candidate_driver_id: 'd1', candidate_asset_id: 'a1' }), {
    linksByTrip: new Map(), fretesById: new Map(), roundsByTrip: new Map(),
  });
  assert.equal(r.category, 'UNCOMMITTED');
  assert.equal(r.reason, 'NEVER_DISPATCHED_OR_MATERIALIZED');
});

test('classifyTrip: rodada CANCELLED/EXPIRED antiga (nenhuma ASSIGNED/OPEN ativa) -> UNCOMMITTED', () => {
  const roundsByTrip = new Map([['t1', [{ planned_trip_id: 't1', status: 'CANCELLED' }, { planned_trip_id: 't1', status: 'EXPIRED' }]]]);
  const r = classifyTrip(trip(), { linksByTrip: new Map(), fretesById: new Map(), roundsByTrip });
  assert.equal(r.category, 'UNCOMMITTED');
});

// ============================================================================
// computeResidualDemands — §17/§18: meta - executado - comprometido, nunca
// abaixo de zero, sem dupla contagem.
// ============================================================================

function demand(over = {}) {
  return { id: 'd1', origin_location_id: 'o1', destination_location_id: 'x1', target_quantity: 100, quantity_unit: 'ton', ...over };
}

test('computeResidualDemands: sem execução nem compromisso -> residual = meta inteira', () => {
  const classification = { detail: [] };
  const { effectiveDemands, breakdown } = computeResidualDemands([demand()], classification);
  assert.equal(breakdown[0].residual_ton, 100);
  assert.equal(effectiveDemands.length, 1);
  assert.equal(effectiveDemands[0].target_quantity, 100);
});

test('computeResidualDemands: 30 executado + 20 comprometido de meta 100 -> residual = 50 (sem dupla contagem)', () => {
  const classification = {
    detail: [
      { demand_id: 'd1', category: 'EXECUTED', planned_quantity: 30, quantity_unit: 'ton' },
      { demand_id: 'd1', category: 'COMMITTED', planned_quantity: 20, quantity_unit: 'ton' },
    ],
  };
  const { breakdown } = computeResidualDemands([demand()], classification);
  assert.equal(breakdown[0].executed_ton, 30);
  assert.equal(breakdown[0].committed_ton, 20);
  assert.equal(breakdown[0].residual_ton, 50);
});

test('computeResidualDemands: cancelado/nao-comprometido NAO reduz o residual (a quantidade "volta" por omissao)', () => {
  const classification = {
    detail: [
      { demand_id: 'd1', category: 'CANCELLED', planned_quantity: 40, quantity_unit: 'ton' },
      { demand_id: 'd1', category: 'UNCOMMITTED', planned_quantity: 60, quantity_unit: 'ton' },
    ],
  };
  const { breakdown } = computeResidualDemands([demand()], classification);
  assert.equal(breakdown[0].residual_ton, 100); // nada foi executado/comprometido de fato
});

test('computeResidualDemands: executado+comprometido excede a meta -> residual nunca fica negativo', () => {
  const classification = {
    detail: [
      { demand_id: 'd1', category: 'EXECUTED', planned_quantity: 70, quantity_unit: 'ton' },
      { demand_id: 'd1', category: 'COMMITTED', planned_quantity: 50, quantity_unit: 'ton' },
    ],
  };
  const { breakdown, effectiveDemands } = computeResidualDemands([demand()], classification);
  assert.equal(breakdown[0].residual_ton, 0);
  assert.equal(effectiveDemands.length, 0); // demanda totalmente satisfeita nao entra no planner de novo
});

test('computeResidualDemands: multiplas origens (multiplas demandas) calculam residual independente cada', () => {
  const demands = [demand({ id: 'd1', target_quantity: 100 }), demand({ id: 'd2', target_quantity: 50 })];
  const classification = { detail: [{ demand_id: 'd1', category: 'EXECUTED', planned_quantity: 100, quantity_unit: 'ton' }] };
  const { breakdown, effectiveDemands } = computeResidualDemands(demands, classification);
  assert.equal(breakdown.find((b) => b.demand_id === 'd1').residual_ton, 0);
  assert.equal(breakdown.find((b) => b.demand_id === 'd2').residual_ton, 50);
  assert.equal(effectiveDemands.length, 1);
  assert.equal(effectiveDemands[0].id, 'd2');
});

// ============================================================================
// classifyAllTrips — integra classify+agregação sobre uma lista de viagens.
// ============================================================================

test('classifyAllTrips: cada viagem cai em exatamente 1 categoria (sem dupla contagem, §18/§90)', () => {
  const context = {
    trips: [trip({ id: 't1', status: 'BLOCKED' }), trip({ id: 't2' }), trip({ id: 't3' })],
    links: [{ planned_trip_id: 't2', frete_id: 'f2', materialization_status: 'MATERIALIZED' }],
    rounds: [{ planned_trip_id: 't3', status: 'ASSIGNED' }],
    fretesById: new Map([['f2', { id: 'f2', status: 'finalizado' }]]),
  };
  const { byCategory, detail } = classifyAllTrips(context);
  assert.equal(detail.length, 3);
  assert.equal(byCategory.UNCOMMITTED.length, 1);
  assert.equal(byCategory.EXECUTED.length, 1);
  assert.equal(byCategory.COMMITTED.length, 1);
  const total = Object.values(byCategory).reduce((s, arr) => s + arr.length, 0);
  assert.equal(total, 3);
});

// ============================================================================
// generateReplan / approvePlan (supersede) — integração com mock supabase
// in-memory (insert/select/update/delete reais, não só leitura), provando o
// fluxo completo §20-25: gerar sobre o residual sem tocar a versao aprovada,
// aprovar supera a antiga ANTES de promover a nova (nunca 2 APPROVED juntas).
// ============================================================================

function makeSupabase() {
  const tables = {
    operation_campaigns: [], campaign_operational_units: [], campaign_locations: [],
    campaign_demands: [], campaign_plan_versions: [], campaign_plan_scenarios: [],
    campaign_planned_trips: [], campaign_exceptions: [], campaign_approvals: [],
    campaign_trip_freights: [], dispatch_rounds: [], fretes: [],
    fleet_assets: [], vehicle_compositions: [], driver_vehicle_assignments: [],
    maintenance_events: [], asset_documents: [],
  };
  let seq = 1;
  function genId() { return `id-${seq++}`; }
  const DEFAULTS = {
    operation_campaigns: { status: 'DRAFT', planning_status: 'DRAFT' },
    campaign_exceptions: { status: 'OPEN' },
  };
  function matches(row, filters) {
    return filters.every(([col, val, op]) => {
      if (op === 'in') return val.includes(row[col]);
      return row[col] === val;
    });
  }
  function builder(name) {
    if (!(name in tables)) tables[name] = [];
    let filters = [];
    let orderCol = null;
    let orderAsc = true;
    let limitN = null;
    let mode = 'select';
    let insertRows = null;
    let updatePayload = null;
    const b = {
      select() { return b; },
      eq(col, val) { filters.push([col, val]); return b; },
      in(col, vals) { filters.push([col, vals, 'in']); return b; },
      is() { return b; },
      order(col, { ascending = true } = {}) { orderCol = col; orderAsc = ascending; return b; },
      limit(n) { limitN = n; return b; },
      insert(rows) {
        mode = 'insert';
        const defaults = DEFAULTS[name] || {};
        insertRows = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ id: r.id || genId(), ...defaults, ...r }));
        return b;
      },
      update(payload) { mode = 'update'; updatePayload = payload; return b; },
      delete() { mode = 'delete'; return b; },
      maybeSingle() { return resolve(true); },
      single() { return resolve(true); },
      then(resolveFn, rejectFn) { resolve(false).then(resolveFn, rejectFn); },
      catch(fn) { return resolve(false).catch(fn); },
      async run() { return resolve(false); },
    };
    async function resolve(wantSingle) {
      if (mode === 'insert') {
        tables[name].push(...insertRows);
        return { data: wantSingle ? insertRows[0] : insertRows, error: null };
      }
      if (mode === 'delete') {
        tables[name] = tables[name].filter((row) => !matches(row, filters));
        return { data: null, error: null };
      }
      if (mode === 'update') {
        tables[name] = tables[name].map((row) => (matches(row, filters) ? { ...row, ...updatePayload } : row));
        const updated = tables[name].filter((row) => matches(row, filters));
        return { data: wantSingle ? (updated[0] || null) : updated, error: null };
      }
      let rows = tables[name].filter((row) => matches(row, filters));
      if (orderCol) rows = [...rows].sort((a, b2) => (orderAsc ? 1 : -1) * (a[orderCol] > b2[orderCol] ? 1 : a[orderCol] < b2[orderCol] ? -1 : 0));
      if (limitN) rows = rows.slice(0, limitN);
      return { data: wantSingle ? (rows[0] || null) : rows, error: null };
    }
    return b;
  }
  // E3.6A: `approvePlan` chama `partner_network_mark_source_stale` no replan.
  //
  // O dublê precisa oferecer `rpc` porque o serviço agora LÊ `{ error }` em vez
  // de confiar num `try/catch` — que nunca disparava, já que o client do Supabase
  // resolve a promessa com o erro dentro em vez de lançar. `__rpc` guarda as
  // chamadas para os testes olharem, e `__rpcError` deixa forçar a falha.
  const rpcCalls = [];
  const supa = {
    from: (name) => builder(name),
    __tables: tables,
    __rpc: rpcCalls,
    __rpcError: null,
    rpc: async (fn, args) => {
      rpcCalls.push({ fn, args });
      return supa.__rpcError
        ? { data: null, error: supa.__rpcError }
        : { data: 0, error: null };
    },
  };
  return supa;
}

const SCOPE = { mode: 'LEGACY_COMPANY' };
const EMP = 'e1';
const USER = { uid: 'u1' };

async function seedApprovedCampaignWithExecution(supabase) {
  // Capacidade suficiente para a meta original (100t = 100000kg) para a v1
  // gerar/aprovar sem gap de capacidade (approvePlan rejeita HARD_CONSTRAINT
  // aberto). O cenario de execução parcial é montado DEPOIS, sobrescrevendo
  // as viagens planejadas com um cenário controlado (t1/t2/t3).
  supabase.__tables.fleet_assets.push({ id: 'a0', empresa_id: EMP, status: 'active', unidade_operacional_id: null, useful_capacity_kg: 120000, metadata: {} });
  supabase.__tables.driver_vehicle_assignments.push({ empresa_id: EMP, driver_id: 'd0', asset_id: 'a0', composition_id: null, assignment_status: 'active', valid_until: null });

  const created = await createObjective(supabase, {
    empresaId: EMP, user: USER, operationalScope: SCOPE,
    body: { name: 'Safra', cargo_name: 'Soja', target_quantity: 100, quantity_unit: 'ton', origin: 'Fazenda', destination: 'Porto', client_request_id: 'obj-1' },
  });
  await approvePlan(supabase, { empresaId: EMP, user: USER, campaignId: created.campaign.id, planId: created.plan.plan.id, operationalScope: SCOPE });

  const demand = supabase.__tables.campaign_demands[0];
  // Substitui as viagens planejadas da v1 por um cenario controlado: t1
  // executado (30t), t2 comprometido via Dispatch (20t), t3 nunca tocado (50t).
  supabase.__tables.campaign_planned_trips = [
    { id: 't1', empresa_id: EMP, campaign_id: created.campaign.id, plan_version_id: created.plan.plan.id, demand_id: demand.id, planned_quantity: 30, quantity_unit: 'ton', status: 'PLANNED' },
    { id: 't2', empresa_id: EMP, campaign_id: created.campaign.id, plan_version_id: created.plan.plan.id, demand_id: demand.id, planned_quantity: 20, quantity_unit: 'ton', status: 'PLANNED' },
    { id: 't3', empresa_id: EMP, campaign_id: created.campaign.id, plan_version_id: created.plan.plan.id, demand_id: demand.id, planned_quantity: 50, quantity_unit: 'ton', status: 'PLANNED' },
  ];
  supabase.__tables.campaign_trip_freights = [
    { id: 'l1', empresa_id: EMP, planned_trip_id: 't1', plan_version_id: created.plan.plan.id, frete_id: 'f1', materialization_status: 'MATERIALIZED' },
    { id: 'l2', empresa_id: EMP, planned_trip_id: 't2', plan_version_id: created.plan.plan.id, frete_id: 'f2', materialization_status: 'MATERIALIZED' },
  ];
  supabase.__tables.fretes = [
    { id: 'f1', empresa_id: EMP, status: 'finalizado' },
    { id: 'f2', empresa_id: EMP, status: 'em_viagem' },
  ];
  // Recursos de frota suficientes para a demanda residual (50t = 50000kg).
  supabase.__tables.fleet_assets.push({ id: 'a1', empresa_id: EMP, status: 'active', unidade_operacional_id: null, useful_capacity_kg: 60000, metadata: {} });
  supabase.__tables.driver_vehicle_assignments.push({ empresa_id: EMP, driver_id: 'd1', asset_id: 'a1', composition_id: null, assignment_status: 'active', valid_until: null });
  return created;
}

test('generateReplan: planeja SÓ o residual (100 meta - 30 executado - 20 comprometido = 50), nunca duplica t1/t2', async () => {
  const supabase = makeSupabase();
  const created = await seedApprovedCampaignWithExecution(supabase);

  const preview = await previewReplan(supabase, { empresaId: EMP, campaignId: created.campaign.id, operationalScope: SCOPE });
  assert.equal(preview.blocked, false);
  assert.equal(preview.executed_trip_count, 1);
  assert.equal(preview.committed_trip_count, 1);
  assert.equal(preview.residual_total_ton, 50);

  const replanned = await generateReplan(supabase, {
    empresaId: EMP, user: USER, campaignId: created.campaign.id, operationalScope: SCOPE,
    body: { reason: 'teste de residual', client_request_id: 'replan-1' },
  });
  assert.equal(replanned.plan.status, 'READY_FOR_REVIEW');
  assert.equal(replanned.plan.version_number, 2);
  const totalPlanned = replanned.planned_trips.reduce((s, t) => s + Number(t.planned_quantity || 0), 0);
  assert.equal(totalPlanned, 50);
  // A campanha continua com a v1 como autoridade corrente (§24) -- rascunho
  // ainda não foi aprovado.
  const campaignRow = supabase.__tables.operation_campaigns.find((c) => c.id === created.campaign.id);
  assert.equal(campaignRow.status, 'APPROVED');
  assert.equal(campaignRow.approved_plan_version_id, created.plan.plan.id);
});

test('generateReplan: viagem com rodada de Dispatch OPEN bloqueia o replan inteiro (BLOCKING_REPLAN_EXCEPTION)', async () => {
  const supabase = makeSupabase();
  const created = await seedApprovedCampaignWithExecution(supabase);
  supabase.__tables.dispatch_rounds.push({ id: 'r1', empresa_id: EMP, planned_trip_id: 't3', plan_version_id: created.plan.plan.id, status: 'OPEN' });

  await assert.rejects(
    generateReplan(supabase, { empresaId: EMP, user: USER, campaignId: created.campaign.id, operationalScope: SCOPE, body: { reason: 'x' } }),
    (err) => err.code === 'blocking_replan_exception' && err.details.planned_trip_ids.includes('t3'),
  );
});

test('generateReplan: sem demanda residual (tudo executado/comprometido) -> replan_not_needed', async () => {
  const supabase = makeSupabase();
  const created = await seedApprovedCampaignWithExecution(supabase);
  // Reclassifica t3 como executado também -> 100% da meta satisfeita.
  supabase.__tables.campaign_trip_freights.push({ id: 'l3', empresa_id: EMP, planned_trip_id: 't3', plan_version_id: created.plan.plan.id, frete_id: 'f3', materialization_status: 'MATERIALIZED' });
  supabase.__tables.fretes.push({ id: 'f3', empresa_id: EMP, status: 'finalizado' });

  await assert.rejects(
    generateReplan(supabase, { empresaId: EMP, user: USER, campaignId: created.campaign.id, operationalScope: SCOPE, body: { reason: 'x' } }),
    (err) => err.code === 'replan_not_needed',
  );
});

test('generateReplan: exige reason (motivo obrigatorio, §33)', async () => {
  const supabase = makeSupabase();
  const created = await seedApprovedCampaignWithExecution(supabase);
  await assert.rejects(
    generateReplan(supabase, { empresaId: EMP, user: USER, campaignId: created.campaign.id, operationalScope: SCOPE, body: {} }),
    (err) => err.code === 'missing_field',
  );
});

test('approvePlan (replan): aprovar a v2 supera a v1 ANTES de promover — nunca 2 versões APPROVED juntas (§25/§32)', async () => {
  const supabase = makeSupabase();
  const created = await seedApprovedCampaignWithExecution(supabase);
  const replanned = await generateReplan(supabase, {
    empresaId: EMP, user: USER, campaignId: created.campaign.id, operationalScope: SCOPE, body: { reason: 'x' },
  });

  await approvePlan(supabase, { empresaId: EMP, user: USER, campaignId: created.campaign.id, planId: replanned.plan.id, operationalScope: SCOPE });

  const versions = supabase.__tables.campaign_plan_versions;
  const approvedVersions = versions.filter((v) => v.status === 'APPROVED');
  assert.equal(approvedVersions.length, 1); // nunca duas simultaneamente
  assert.equal(approvedVersions[0].id, replanned.plan.id);
  const oldVersion = versions.find((v) => v.id === created.plan.plan.id);
  assert.equal(oldVersion.status, 'SUPERSEDED');
  assert.equal(oldVersion.superseded_by, replanned.plan.id);
  const campaignRow = supabase.__tables.operation_campaigns.find((c) => c.id === created.campaign.id);
  assert.equal(campaignRow.approved_plan_version_id, replanned.plan.id);
  // Trabalho já comprometido na v1 (t1/t2/links/fretes) nunca é tocado (§23).
  assert.equal(supabase.__tables.campaign_trip_freights.length, 2);
  assert.ok(supabase.__tables.campaign_planned_trips.some((t) => t.id === 't1'));
  assert.ok(supabase.__tables.campaign_planned_trips.some((t) => t.id === 't2'));
});

// ── E3.6A / REPLAN_RPC_ERROR_HANDLING ─────────────────────────────────────────
//
// O caminho de replan avisa a rede de parceiros que as oportunidades já
// compartilhadas ficaram obsoletas. O que estes dois testes protegem não é a
// marcação em si — é a CAPACIDADE DE PERCEBER que ela falhou.

test('replan: a aprovação avisa a rede de parceiros pelo caminho canônico', async () => {
  const supabase = makeSupabase();
  const created = await seedApprovedCampaignWithExecution(supabase);
  const replanned = await generateReplan(supabase, {
    empresaId: EMP, user: USER, campaignId: created.campaign.id, operationalScope: SCOPE, body: { reason: 'x' },
  });
  await approvePlan(supabase, {
    empresaId: EMP, user: USER, campaignId: created.campaign.id, planId: replanned.plan.id, operationalScope: SCOPE,
  });

  const marcacoes = supabase.__rpc.filter((c) => c.fn === 'partner_network_mark_source_stale');
  assert.equal(marcacoes.length, 1, 'replan aprovado precisa marcar a fonte como obsoleta');
  assert.equal(marcacoes[0].args.p_campaign_id, created.campaign.id);
  assert.equal(marcacoes[0].args.p_motivo, 'replan_aprovado');
});

test('replan: falha da RPC volta em { error } — e PRECISA ser percebida, sem derrubar a aprovação', async () => {
  // O defeito que este teste trava: o código tinha `try { await supabase.rpc() }
  // catch { warn }`. O client do Supabase NÃO lança em erro de RPC — ele resolve
  // com `{ data, error }`. Função ausente (082 não aplicada), sem permissão ou
  // com exceção voltavam por `error`, o `await` seguia adiante e o `catch` nunca
  // era alcançado. O único aviso existente era inalcançável na prática.
  const supabase = makeSupabase();
  const created = await seedApprovedCampaignWithExecution(supabase);
  const replanned = await generateReplan(supabase, {
    empresaId: EMP, user: USER, campaignId: created.campaign.id, operationalScope: SCOPE, body: { reason: 'x' },
  });

  supabase.__rpcError = { message: 'function public.partner_network_mark_source_stale does not exist', code: '42883' };
  const avisos = [];
  const warnOriginal = console.warn;
  console.warn = (...args) => avisos.push(args.map(String).join(' '));
  try {
    await approvePlan(supabase, {
      empresaId: EMP, user: USER, campaignId: created.campaign.id, planId: replanned.plan.id, operationalScope: SCOPE,
    });
  } finally {
    console.warn = warnOriginal;
  }

  assert.equal(avisos.length, 1, 'a falha precisa ser percebida e registrada');
  assert.match(avisos[0], /rede de parceiros nao marcada como obsoleta/);
  assert.match(avisos[0], /does not exist/, 'o motivo real precisa chegar ao log, não um objeto opaco');

  // E a aprovação NÃO cai: a autoridade final é a revalidação da fonte dentro da
  // RPC de resposta, que roda na mesma transação da escrita.
  const aprovadas = supabase.__tables.campaign_plan_versions.filter((v) => v.status === 'APPROVED');
  assert.equal(aprovadas.length, 1);
  assert.equal(aprovadas[0].id, replanned.plan.id);
});
