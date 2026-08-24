'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveNextAction, getCampaignOrchestration, createObjective } = require('../services/campaign/operationOrchestratorService');

// ============================================================================
// deriveNextAction — função pura, cobre os estados representativos do §78.
// Nenhum acesso a banco: exatamente os sinais já computados por
// campaignService/campaignProgressService, sem nenhuma regra nova.
// ============================================================================

const CAMPAIGN = { id: 'c1', status: 'PLANNING' };

test('next_action: campanha sem origem/destino/demanda -> COMPLETE_MISSING_OBJECTIVE', () => {
  const r = deriveNextAction({ campaign: CAMPAIGN, locations: [], demands: [] });
  assert.equal(r.next_action, 'COMPLETE_MISSING_OBJECTIVE');
});

test('next_action: objetivo completo, plano ainda não gerado -> GENERATE_PLAN', () => {
  const r = deriveNextAction({
    campaign: CAMPAIGN,
    locations: [{ kind: 'origin' }, { kind: 'destination' }],
    demands: [{ target_quantity: 10 }],
    latestPlan: null,
  });
  assert.equal(r.next_action, 'GENERATE_PLAN');
});

test('next_action: plano READY_FOR_REVIEW com gap de capacidade -> REVIEW_CAPACITY_GAP', () => {
  const r = deriveNextAction({
    campaign: CAMPAIGN,
    locations: [{ kind: 'origin' }, { kind: 'destination' }],
    demands: [{ target_quantity: 10 }],
    latestPlan: { status: 'READY_FOR_REVIEW' },
    planExceptions: [{ severity: 'HARD_CONSTRAINT', status: 'OPEN', exception_type: 'INSUFFICIENT_CAPACITY' }],
  });
  assert.equal(r.next_action, 'REVIEW_CAPACITY_GAP');
});

test('next_action: plano READY_FOR_REVIEW com outro bloqueio duro -> REVIEW_BLOCKING_EXCEPTION', () => {
  const r = deriveNextAction({
    campaign: CAMPAIGN,
    locations: [{ kind: 'origin' }, { kind: 'destination' }],
    demands: [{ target_quantity: 10 }],
    latestPlan: { status: 'READY_FOR_REVIEW' },
    planExceptions: [{ severity: 'HARD_CONSTRAINT', status: 'OPEN', exception_type: 'SOME_OTHER_BLOCK' }],
  });
  assert.equal(r.next_action, 'REVIEW_BLOCKING_EXCEPTION');
});

test('next_action: plano READY_FOR_REVIEW sem bloqueio aberto -> APPROVE_PLAN', () => {
  const r = deriveNextAction({
    campaign: CAMPAIGN,
    locations: [{ kind: 'origin' }, { kind: 'destination' }],
    demands: [{ target_quantity: 10 }],
    latestPlan: { status: 'READY_FOR_REVIEW' },
    planExceptions: [],
  });
  assert.equal(r.next_action, 'APPROVE_PLAN');
});

function approvedCampaign() {
  return { id: 'c1', status: 'APPROVED' };
}
function baseProgress(over = {}) {
  return {
    health: { state: 'ON_TRACK' },
    replan: { status: 'REPLAN_NOT_NEEDED' },
    readiness: { blocked: 0, ready_offer: 0, ready_direct: 0 },
    progress: { trips: { in_execution: 0 }, quantity: {} },
    ...over,
  };
}

test('next_action: aprovado + replan REQUIRED -> REPLAN_REQUIRED', () => {
  const r = deriveNextAction({
    campaign: approvedCampaign(),
    locations: [{ kind: 'origin' }, { kind: 'destination' }],
    demands: [{ target_quantity: 10 }],
    progress: baseProgress({ replan: { status: 'REPLAN_REQUIRED_BY_INVARIANT', reason_code: 'PLANNING_CAPACITY_GAP', suggested_next_step: 'x' } }),
  });
  assert.equal(r.next_action, 'REPLAN_REQUIRED');
});

test('next_action: aprovado + viagem bloqueada -> REVIEW_BLOCKING_EXCEPTION', () => {
  const r = deriveNextAction({
    campaign: approvedCampaign(),
    locations: [{ kind: 'origin' }, { kind: 'destination' }],
    demands: [{ target_quantity: 10 }],
    progress: baseProgress({ readiness: { blocked: 1, ready_offer: 0, ready_direct: 0 } }),
  });
  assert.equal(r.next_action, 'REVIEW_BLOCKING_EXCEPTION');
});

test('next_action: aprovado + viagem pronta para oferta -> READY_FOR_DISPATCH', () => {
  const r = deriveNextAction({
    campaign: approvedCampaign(),
    locations: [{ kind: 'origin' }, { kind: 'destination' }],
    demands: [{ target_quantity: 10 }],
    progress: baseProgress({ readiness: { blocked: 0, ready_offer: 1, ready_direct: 0 } }),
  });
  assert.equal(r.next_action, 'READY_FOR_DISPATCH');
});

test('next_action: aprovado + viagem pronta para materializar -> READY_FOR_MATERIALIZATION', () => {
  const r = deriveNextAction({
    campaign: approvedCampaign(),
    locations: [{ kind: 'origin' }, { kind: 'destination' }],
    demands: [{ target_quantity: 10 }],
    progress: baseProgress({ readiness: { blocked: 0, ready_offer: 0, ready_direct: 1 } }),
  });
  assert.equal(r.next_action, 'READY_FOR_MATERIALIZATION');
});

test('next_action: aprovado + replan RECOMMENDED (sem pendência de despacho) -> REPLAN_RECOMMENDED', () => {
  const r = deriveNextAction({
    campaign: approvedCampaign(),
    locations: [{ kind: 'origin' }, { kind: 'destination' }],
    demands: [{ target_quantity: 10 }],
    progress: baseProgress({ replan: { status: 'REPLAN_RECOMMENDED', reason_code: 'CANCELLED_FREIGHT_REMAINING_DEMAND', suggested_next_step: 'x' } }),
  });
  assert.equal(r.next_action, 'REPLAN_RECOMMENDED');
});

test('next_action: aprovado + rascunho de replan (READY_FOR_REVIEW) aguardando aprovação -> REPLAN_AWAITING_APPROVAL (tem prioridade sobre o progresso da versão antiga)', () => {
  const r = deriveNextAction({
    campaign: approvedCampaign(),
    locations: [{ kind: 'origin' }, { kind: 'destination' }],
    demands: [{ target_quantity: 10 }],
    latestPlan: { status: 'READY_FOR_REVIEW' },
    progress: baseProgress({ readiness: { blocked: 0, ready_offer: 5, ready_direct: 0 } }),
  });
  assert.equal(r.next_action, 'REPLAN_AWAITING_APPROVAL');
});

test('next_action: aprovado + em execução, sem pendências -> EXECUTION_IN_PROGRESS', () => {
  const r = deriveNextAction({
    campaign: approvedCampaign(),
    locations: [{ kind: 'origin' }, { kind: 'destination' }],
    demands: [{ target_quantity: 10 }],
    progress: baseProgress({ progress: { trips: { in_execution: 2 }, quantity: {} } }),
  });
  assert.equal(r.next_action, 'EXECUTION_IN_PROGRESS');
});

test('next_action: aprovado + tudo concluído -> CAMPAIGN_COMPLETE', () => {
  const r = deriveNextAction({
    campaign: approvedCampaign(),
    locations: [{ kind: 'origin' }, { kind: 'destination' }],
    demands: [{ target_quantity: 10 }],
    progress: baseProgress({ health: { state: 'COMPLETED' } }),
  });
  assert.equal(r.next_action, 'CAMPAIGN_COMPLETE');
});

test('next_action: campanha cancelada -> CAMPAIGN_CANCELLED (mesmo com dados incompletos)', () => {
  const r = deriveNextAction({ campaign: { id: 'c1', status: 'CANCELLED' }, locations: [], demands: [] });
  assert.equal(r.next_action, 'CAMPAIGN_CANCELLED');
});

// ============================================================================
// createObjective / getCampaignOrchestration — mock supabase in-memory com
// insert/select/update/delete reais (não apenas leitura), para exercitar o
// mesmo caminho de createCampaign->replaceLocations->replaceDemands->
// generatePlan que o manager percorreria manualmente em 4 chamadas.
// ============================================================================

function makeSupabase() {
  const tables = {
    operation_campaigns: [], campaign_operational_units: [], campaign_locations: [],
    campaign_demands: [], campaign_plan_versions: [], campaign_plan_scenarios: [],
    campaign_planned_trips: [], campaign_exceptions: [], campaign_approvals: [],
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
        const out = insertRows.length === 1 ? insertRows[0] : insertRows;
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
  return { from: (name) => builder(name), __tables: tables };
}

const SCOPE = { mode: 'LEGACY_COMPANY' };
const EMP = 'e1';
const USER = { uid: 'u1' };

test('createObjective: entrada mínima (nome, carga, quantidade, origem, destino) cria campanha+locais+demanda+plano em UMA chamada', async () => {
  const supabase = makeSupabase();
  const result = await createObjective(supabase, {
    empresaId: EMP,
    user: USER,
    operationalScope: SCOPE,
    body: {
      name: 'Safra Verão', cargo_name: 'Soja', target_quantity: 500, quantity_unit: 'ton',
      origin: 'Fazenda Alfa', destination: 'Porto de Santos',
      client_request_id: 'obj-1',
    },
  });
  assert.equal(result.campaign.name, 'Safra Verão');
  assert.equal(result.plan.plan.status, 'READY_FOR_REVIEW');
  assert.equal(supabase.__tables.campaign_locations.length, 2);
  assert.equal(supabase.__tables.campaign_demands.length, 1);
  assert.equal(supabase.__tables.campaign_demands[0].target_quantity, 500);
});

test('createObjective: multi-origem (§52-64) — N origens com quantidade própria criam N locais de origem + N demandas, 1 destino compartilhado', async () => {
  const supabase = makeSupabase();
  const result = await createObjective(supabase, {
    empresaId: EMP, user: USER, operationalScope: SCOPE,
    body: {
      name: 'Colheita Multi', cargo_name: 'Soja', destination: 'Porto',
      origins: [
        { name: 'Fazenda A', target_quantity: 300, quantity_unit: 'ton' },
        { name: 'Fazenda B', target_quantity: 200, quantity_unit: 'ton' },
      ],
      client_request_id: 'obj-multi',
    },
  });
  const origins = supabase.__tables.campaign_locations.filter((l) => l.kind === 'origin');
  const destinations = supabase.__tables.campaign_locations.filter((l) => l.kind === 'destination');
  assert.equal(origins.length, 2);
  assert.equal(destinations.length, 1); // 1 destino compartilhado (§55), nunca duplicado
  assert.equal(supabase.__tables.campaign_demands.length, 2);
  const total = supabase.__tables.campaign_demands.reduce((s, d) => s + Number(d.target_quantity), 0);
  assert.equal(total, 500); // total sempre derivado (soma), nunca redigitado (§61)
  assert.equal(result.campaign.name, 'Colheita Multi');
});

test('createObjective: origem duplicada é rejeitada com erro claro (§62)', async () => {
  const supabase = makeSupabase();
  await assert.rejects(
    createObjective(supabase, {
      empresaId: EMP, user: USER, operationalScope: SCOPE,
      body: {
        name: 'X', cargo_name: 'Soja', destination: 'Porto',
        origins: [{ name: 'Fazenda A', target_quantity: 100 }, { name: 'fazenda a', target_quantity: 50 }],
      },
    }),
    (err) => err.code === 'duplicate_origin',
  );
});

test('createObjective: NÃO exige distância, preço de diesel, IDs de motorista/veículo ou número de viagens (§73)', async () => {
  const supabase = makeSupabase();
  const body = {
    name: 'Colheita', cargo_name: 'Milho', target_quantity: 100, quantity_unit: 'ton',
    origin: 'Sítio', destination: 'Armazém', client_request_id: 'obj-2',
  };
  assert.ok(!('distance_km' in body));
  assert.ok(!('fuel_price_per_liter' in body));
  assert.ok(!('candidate_driver_id' in body));
  assert.ok(!('candidate_asset_id' in body));
  assert.ok(!('number_of_trips' in body));
  const result = await createObjective(supabase, { empresaId: EMP, user: USER, operationalScope: SCOPE, body });
  assert.equal(result.plan.plan.status, 'READY_FOR_REVIEW');
});

test('createObjective: replay do mesmo client_request_id é idempotente (mesma campanha, sem duplicar)', async () => {
  const supabase = makeSupabase();
  const body = {
    name: 'Safra', cargo_name: 'Soja', target_quantity: 200, quantity_unit: 'ton',
    origin: 'A', destination: 'B', client_request_id: 'obj-idem',
  };
  const first = await createObjective(supabase, { empresaId: EMP, user: USER, operationalScope: SCOPE, body });
  const second = await createObjective(supabase, { empresaId: EMP, user: USER, operationalScope: SCOPE, body });
  assert.equal(first.campaign.id, second.campaign.id);
  assert.equal(supabase.__tables.operation_campaigns.length, 1);
});

test('createObjective: campo obrigatório ausente (origem) falha com erro claro, não erro genérico', async () => {
  const supabase = makeSupabase();
  await assert.rejects(
    createObjective(supabase, {
      empresaId: EMP, user: USER, operationalScope: SCOPE,
      body: { name: 'X', cargo_name: 'Y', target_quantity: 1, quantity_unit: 'ton', destination: 'B' },
    }),
    (err) => err.code === 'missing_field' && err.details?.field === 'origins[0].name',
  );
});

test('getCampaignOrchestration: objetivo incompleto -> next_action COMPLETE_MISSING_OBJECTIVE', async () => {
  const supabase = makeSupabase();
  const created = await createObjective(supabase, {
    empresaId: EMP, user: USER, operationalScope: SCOPE,
    body: { name: 'X', cargo_name: 'Soja', target_quantity: 10, quantity_unit: 'ton', origin: 'A', destination: 'B', client_request_id: 'o1' },
  });
  // Remove a demanda para simular objetivo incompleto (cenário sintético).
  supabase.__tables.campaign_demands = [];
  const orch = await getCampaignOrchestration(supabase, { empresaId: EMP, campaignId: created.campaign.id, operationalScope: SCOPE });
  assert.equal(orch.next_action, 'COMPLETE_MISSING_OBJECTIVE');
  assert.deepEqual(orch.objective.origins, ['A']);
  assert.equal(orch.objective.destination, 'B');
});

test('getCampaignOrchestration: objetivo completo + plano gerado -> next_action APPROVE_PLAN', async () => {
  const supabase = makeSupabase();
  // Capacidade própria suficiente (10 ton = 10000kg) para o plano não gerar
  // gap de capacidade — sem isso REVIEW_CAPACITY_GAP seria o resultado correto.
  supabase.__tables.fleet_assets.push({ id: 'a1', empresa_id: EMP, status: 'active', unidade_operacional_id: null, useful_capacity_kg: 30000, metadata: {} });
  supabase.__tables.driver_vehicle_assignments.push({ empresa_id: EMP, driver_id: 'd1', asset_id: 'a1', composition_id: null, assignment_status: 'active', valid_until: null });
  const created = await createObjective(supabase, {
    empresaId: EMP, user: USER, operationalScope: SCOPE,
    body: { name: 'X', cargo_name: 'Soja', target_quantity: 10, quantity_unit: 'ton', origin: 'A', destination: 'B', client_request_id: 'o2' },
  });
  const orch = await getCampaignOrchestration(supabase, { empresaId: EMP, campaignId: created.campaign.id, operationalScope: SCOPE });
  assert.equal(orch.next_action, 'APPROVE_PLAN');
  assert.equal(orch.plan_summary.exceptions_open, 0);
});
