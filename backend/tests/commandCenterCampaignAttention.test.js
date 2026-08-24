'use strict';

// Stub de config/supabase antes de carregar o serviço (evita createClient real).
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (/[\\/]config[\\/]supabase$/.test(request)) return { from: () => { throw new Error('stub'); } };
  return originalLoad.call(this, request, parent, isMain);
};
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarCampaignAttention } = require('../services/commandCenterService');
Module._load = originalLoad;

function makeSupabase(dataPorTabela) {
  function builder(tabela) {
    const rows = () => (dataPorTabela[tabela] || []);
    const b = {
      select() { return b; }, eq() { return b; }, in() { return b; }, is() { return b; },
      gte() { return b; }, lte() { return b; }, order() { return b; }, limit() { return b; },
      maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
      single() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
      then(resolve) { resolve({ data: rows(), error: null }); },
    };
    return b;
  }
  return { from: (t) => builder(t) };
}

const EMP = 'e1';
const SCOPE = { mode: 'LEGACY_COMPANY' };

// Campanha aprovada com um frete cancelado ⇒ saúde ATTENTION + replan recomendado.
function dataAttention() {
  return {
    operation_campaigns: [{ id: 'c1', empresa_id: EMP, reference_code: 'CMP-1', name: 'Safra', cargo_name: 'Soja', status: 'APPROVED', planning_status: 'APPROVED', approved_plan_version_id: 'p1' }],
    campaign_operational_units: [],
    campaign_plan_versions: [{ id: 'p1', version_number: 1, status: 'APPROVED' }],
    campaign_planned_trips: [{ id: 't1', empresa_id: EMP, campaign_id: 'c1', plan_version_id: 'p1', status: 'PLANNED', planned_quantity: 10, quantity_unit: 'ton', required_capacity_kg: 10000, origin_location_id: 'o', destination_location_id: 'd', candidate_driver_id: 'd1', candidate_asset_id: 'a1' }],
    campaign_trip_freights: [{ id: 'l1', empresa_id: EMP, campaign_id: 'c1', plan_version_id: 'p1', planned_trip_id: 't1', frete_id: 'f1', materialization_status: 'MATERIALIZED' }],
    campaign_demands: [{ target_quantity: 10, quantity_unit: 'ton' }],
    campaign_locations: [{ id: 'o', name: 'Fazenda' }, { id: 'd', name: 'Porto' }],
    fretes: [{ id: 'f1', status: 'cancelado' }],
    usuarios: [{ id: 'd1', empresa_id: EMP, status: 'ativo' }],
    fleet_assets: [{ id: 'a1', empresa_id: EMP, status: 'active', unidade_operacional_id: null, useful_capacity_kg: 30000, metadata: {} }],
    vehicle_compositions: [],
    driver_vehicle_assignments: [{ empresa_id: EMP, driver_id: 'd1', asset_id: 'a1', assignment_status: 'active', valid_until: null }],
    asset_documents: [],
    maintenance_events: [],
  };
}

test('campanha em atenção aparece no campaign_attention da Torre (saúde canônica)', async () => {
  const r = await carregarCampaignAttention(makeSupabase(dataAttention()), { empresaId: EMP, operationalScope: SCOPE });
  assert.equal(r.total_campaigns, 1);
  assert.equal(r.attention.length, 1);
  assert.equal(r.attention[0].health_state, 'ATTENTION');
  assert.equal(r.attention[0].cancelled, 1);
  assert.equal(r.summary_by_state.ATTENTION, 1);
});

test('campanha saudável (concluída) NÃO polui a lista de atenção', async () => {
  const d = dataAttention();
  d.fretes = [{ id: 'f1', status: 'finalizado' }];
  const r = await carregarCampaignAttention(makeSupabase(d), { empresaId: EMP, operationalScope: SCOPE });
  assert.equal(r.attention.length, 0);
  assert.equal(r.summary_by_state.COMPLETED, 1);
});

test('sem campanhas aprovadas → vazio', async () => {
  const d = dataAttention();
  d.operation_campaigns = [{ ...d.operation_campaigns[0], status: 'DRAFT', approved_plan_version_id: null }];
  const r = await carregarCampaignAttention(makeSupabase(d), { empresaId: EMP, operationalScope: SCOPE });
  assert.equal(r.total_campaigns, 0);
  assert.equal(r.attention.length, 0);
});
