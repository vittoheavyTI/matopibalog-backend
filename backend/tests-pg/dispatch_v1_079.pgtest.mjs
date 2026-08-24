// Nunca roda contra producao: exige DATABASE_URL do Postgres efemero da CI.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CONN = process.env.DATABASE_URL;

if (!CONN) {
  if (process.env.CI) {
    test('dispatch v1 079 PG exige DATABASE_URL na CI', () => {
      assert.fail('DATABASE_URL ausente em CI; teste 079 nao pode ser pulado');
    });
  } else {
    test('dispatch v1 079 PG (pulado: sem DATABASE_URL local)', { skip: true }, () => {});
  }
} else {
  const pg = await import('pg');
  registrar(pg.default ?? pg);
}

function registrar(pg) {
  const { Pool } = pg;
  const here = dirname(fileURLToPath(import.meta.url));
  const migration = (name) => readFileSync(join(here, '..', 'migrations', name), 'utf8');
  const pgHarness = (name) => readFileSync(join(here, name), 'utf8');
  const pool = new Pool({ connectionString: CONN });

  const bootstrapSql = [
    pgHarness('00_bootstrap_pre.sql'),
    migration('060_catalogo_funcionalidades.sql'),
    migration('061_matriz_publicacao_transacional.sql'),
    pgHarness('99_grants_service_role_test.sql'),
    migration('058_fluxo_comercial_v2.sql'),
    migration('062_auth_sessions_revogaveis.sql'),
    migration('064_frete_tracking_credenciais.sql'),
    migration('065_fretes_financeiro_auditoria.sql'),
    migration('066_billing_outbox.sql'),
    migration('067_grupos_filiais_escopos_operacionais.sql'),
  ];

  const dispatchChainSql = [
    migration('068_aquisicao_comercial_v2_rpc.sql'),
    migration('069_portal_cliente_governanca_entitlements.sql'),
    migration('070_lancamentos_audit_safe_realtime.sql'),
    migration('071_lancamento_status_cancelado_check.sql'),
    migration('072_permissions_templates_overrides.sql'),
    migration('026_create_frete_documentos.sql'),
    migration('048_create_frete_epod.sql'),
    migration('049_create_frete_ocorrencias.sql'),
    migration('050_epod_evidencia_status.sql'),
    migration('073_documents_foundation_security_web.sql'),
    migration('074_fleet_foundation.sql'),
    migration('075_fleet_operational_closure.sql'),
    migration('076_operation_campaign_foundation.sql'),
    migration('077_operation_campaign_076_payload_reconciliation.sql'),
    migration('078_operation_campaign_materialization.sql'),
    migration('079_dispatch_v1_atomic_offers.sql'),
  ];

  const EMP_A = '07900000-0000-4000-a000-000000000001';
  const EMP_B = '07900000-0000-4000-a000-000000000002';
  const PLAN_A = '07900000-0000-4000-a000-0000000000a1';
  const ADM_A = '07900000-0000-4000-a000-000000000101';
  const ADM_B = '07900000-0000-4000-a000-000000000102';
  const DRIVER_A = '07900000-0000-4000-a000-000000000201';
  const DRIVER_B = '07900000-0000-4000-a000-000000000202';
  const DRIVER_C = '07900000-0000-4000-a000-000000000203';
  const DRIVER_INACTIVE = '07900000-0000-4000-a000-000000000204';
  const DRIVER_OTHER_EMP = '07900000-0000-4000-a000-000000000205';
  const UNIT_A = '07900000-0000-4000-a000-000000000301';
  const CAMP_A = '07900000-0000-4000-a000-000000000401';
  const PLAN_VER_A = '07900000-0000-4000-a000-000000000501';
  const SCEN_A = '07900000-0000-4000-a000-000000000601';
  const ORIGIN_A = '07900000-0000-4000-a000-000000000701';
  const DEST_A = '07900000-0000-4000-a000-000000000702';
  const DEMAND_A = '07900000-0000-4000-a000-000000000801';
  const ASSET_A = '07900000-0000-4000-a000-000000000b01';
  const ASSET_B = '07900000-0000-4000-a000-000000000b02';
  const ASSET_C = '07900000-0000-4000-a000-000000000b03';

  async function applySql(sqls) {
    for (const sql of sqls) await pool.query(sql);
  }

  async function resetPublicSchema() {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await pool.query('GRANT ALL ON SCHEMA public TO postgres');
    await pool.query('GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role').catch(() => {});
  }

  async function installAuthHelpers() {
    await pool.query('CREATE SCHEMA IF NOT EXISTS auth');
    await pool.query(`
      CREATE OR REPLACE FUNCTION auth.uid()
      RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    `);
    await pool.query(`
      CREATE OR REPLACE FUNCTION public.rls_is_super_admin()
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $$ SELECT COALESCE((SELECT is_super_admin FROM usuarios WHERE id = auth.uid()), false) $$;
    `);
    await pool.query(`
      CREATE OR REPLACE FUNCTION public.rls_is_company_admin()
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $$ SELECT COALESCE((SELECT tipo = 'admin' FROM usuarios WHERE id = auth.uid()), false) $$;
    `);
    await pool.query(`
      CREATE OR REPLACE FUNCTION public.rls_empresa_id()
      RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $$ SELECT empresa_id FROM usuarios WHERE id = auth.uid() $$;
    `);
  }

  async function withRole(role, fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${role}`);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // Cria uma nova viagem planejada PLANTED (sem candidato), pronta para dispatch.
  async function seedTrip(tripId) {
    await pool.query(
      `INSERT INTO public.campaign_planned_trips
         (id, empresa_id, campaign_id, plan_version_id, scenario_id, origin_location_id, destination_location_id,
          demand_id, planned_quantity, quantity_unit, required_capacity_kg)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,10,'ton',10000)
       ON CONFLICT (id) DO NOTHING`,
      [tripId, EMP_A, CAMP_A, PLAN_VER_A, SCEN_A, ORIGIN_A, DEST_A, DEMAND_A],
    );
  }

  async function callRoundCreate(client, { tripId, mode, recipients, expiresAt, createdBy, requestId }) {
    const { rows } = await client.query(
      `SELECT * FROM public.dispatch_round_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        EMP_A, CAMP_A, PLAN_VER_A, tripId, mode,
        JSON.stringify(recipients), expiresAt || null, JSON.stringify({ modalidade_calculo: 'valor_fixo', valor_frete: 500 }),
        createdBy, requestId || null, 'corr-079',
      ],
    );
    return rows[0];
  }

  async function seedFixtures() {
    await pool.query(
      `INSERT INTO public.planos (id, nome, categoria, capacidade_inclusa, limite_motoristas, requer_negociacao)
       VALUES ($1,'Plano A','empresa',20,20,false)
       ON CONFLICT (id) DO NOTHING`,
      [PLAN_A],
    );
    await pool.query(
      `INSERT INTO public.empresas (id, nome, status, plano_id, operational_scope_mode)
       VALUES ($1,'Empresa A','ativo',$2,'enforced'),($3,'Empresa B','ativo',$2,'enforced')
       ON CONFLICT (id) DO NOTHING`,
      [EMP_A, PLAN_A, EMP_B],
    );
    await pool.query(
      `INSERT INTO public.usuarios (id, empresa_id, tipo, status, is_super_admin, nome)
       VALUES
         ($1,$2,'admin','ativo',false,'Admin A'),
         ($9,$3,'admin','ativo',false,'Admin B'),
         ($4,$2,'motorista','ativo',false,'Driver A'),
         ($5,$2,'motorista','ativo',false,'Driver B'),
         ($6,$2,'motorista','ativo',false,'Driver C'),
         ($7,$2,'motorista','bloqueado',false,'Driver Inactive'),
         ($8,$3,'motorista','ativo',false,'Driver Other Empresa')
       ON CONFLICT (id) DO NOTHING`,
      [ADM_A, EMP_A, EMP_B, DRIVER_A, DRIVER_B, DRIVER_C, DRIVER_INACTIVE, DRIVER_OTHER_EMP, ADM_B],
    );
    await pool.query(
      `INSERT INTO public.motoristas (id, empresa_id)
       VALUES ($1,$2),($3,$2),($4,$2),($5,$2),($6,$7)
       ON CONFLICT (id) DO NOTHING`,
      [DRIVER_A, EMP_A, DRIVER_B, DRIVER_C, DRIVER_INACTIVE, DRIVER_OTHER_EMP, EMP_B],
    );
    await pool.query(
      `INSERT INTO public.unidades_operacionais (id, empresa_id, nome, status, is_default)
       VALUES ($1,$2,'Unidade A','ativo',true)
       ON CONFLICT (id) DO NOTHING`,
      [UNIT_A, EMP_A],
    );
    await pool.query(
      `INSERT INTO public.fleet_assets (id, empresa_id, unidade_operacional_id, asset_type, internal_identifier, plate)
       VALUES ($1,$2,$3,'truck','079-A-TRUCK','PGA0A79'),
              ($4,$2,$3,'truck','079-B-TRUCK','PGB0A79'),
              ($5,$2,$3,'truck','079-C-TRUCK','PGC0A79')
       ON CONFLICT (id) DO NOTHING`,
      [ASSET_A, EMP_A, UNIT_A, ASSET_B, ASSET_C],
    );
    await pool.query(
      `INSERT INTO public.driver_vehicle_assignments (empresa_id, driver_id, asset_id)
       VALUES ($1,$2,$3),($1,$4,$5),($1,$6,$7)
       ON CONFLICT DO NOTHING`,
      [EMP_A, DRIVER_A, ASSET_A, DRIVER_B, ASSET_B, DRIVER_C, ASSET_C],
    );
    await pool.query(
      `INSERT INTO public.operation_campaigns (id, empresa_id, reference_code, name, cargo_name, status, planning_status, created_by)
       VALUES ($1,$2,'CAMP-079','Campanha 079','Soja','READY_FOR_REVIEW','READY_FOR_REVIEW',$3)
       ON CONFLICT (id) DO NOTHING`,
      [CAMP_A, EMP_A, ADM_A],
    );
    await pool.query(
      `INSERT INTO public.campaign_operational_units (empresa_id, campaign_id, unidade_operacional_id, created_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (campaign_id, unidade_operacional_id) DO NOTHING`,
      [EMP_A, CAMP_A, UNIT_A, ADM_A],
    );
    await pool.query(
      `INSERT INTO public.campaign_locations (id, empresa_id, campaign_id, kind, name, unidade_operacional_id, created_by)
       VALUES ($1,$2,$3,'origin','Origem',$4,$5),($6,$2,$3,'destination','Destino',$4,$5)
       ON CONFLICT (id) DO NOTHING`,
      [ORIGIN_A, EMP_A, CAMP_A, UNIT_A, ADM_A, DEST_A],
    );
    await pool.query(
      `INSERT INTO public.campaign_demands
         (id, empresa_id, campaign_id, origin_location_id, destination_location_id, cargo_name, target_quantity, quantity_unit, created_by)
       VALUES ($1,$2,$3,$4,$5,'Soja',20,'ton',$6)
       ON CONFLICT (id) DO NOTHING`,
      [DEMAND_A, EMP_A, CAMP_A, ORIGIN_A, DEST_A, ADM_A],
    );
    await pool.query(
      `INSERT INTO public.campaign_plan_versions
         (id, empresa_id, campaign_id, version_number, status, rules_version, generated_by, approved_by, approved_at)
       VALUES ($1,$2,$3,1,'APPROVED','dispatch-v1.test',$4,$4,now())
       ON CONFLICT (id) DO NOTHING`,
      [PLAN_VER_A, EMP_A, CAMP_A, ADM_A],
    );
    await pool.query(
      `UPDATE public.operation_campaigns
          SET status='APPROVED', planning_status='APPROVED', approved_plan_version_id=$1
        WHERE id=$2 AND empresa_id=$3`,
      [PLAN_VER_A, CAMP_A, EMP_A],
    );
    await pool.query(
      `INSERT INTO public.campaign_plan_scenarios (id, empresa_id, campaign_id, plan_version_id, scenario_key, label)
       VALUES ($1,$2,$3,$4,'base','Base')
       ON CONFLICT (id) DO NOTHING`,
      [SCEN_A, EMP_A, CAMP_A, PLAN_VER_A],
    );
  }

  test('079 cria dispatch_rounds/dispatch_offers com RLS e grants minimos (SELECT-only para authenticated)', async () => {
    await resetPublicSchema();
    await applySql(bootstrapSql);
    await installAuthHelpers();
    await applySql(dispatchChainSql);
    await seedFixtures();

    for (const table of ['dispatch_rounds', 'dispatch_offers']) {
      const { rows: tableRows } = await pool.query(
        `SELECT relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=$1`,
        [table],
      );
      assert.equal(tableRows.length, 1, `${table} deve existir`);
      assert.equal(tableRows[0].relrowsecurity, true, `${table} deve ter RLS habilitado`);

      const { rows: grants } = await pool.query(
        `SELECT privilege_type FROM information_schema.role_table_grants
         WHERE table_schema='public' AND table_name=$1 AND grantee='authenticated'`,
        [table],
      );
      assert.deepEqual(new Set(grants.map((r) => r.privilege_type)), new Set(['SELECT']),
        `${table}: authenticated so pode ter SELECT (escrita so via RPC)`);
    }
  });

  test('079 designacao direta: reivindica a viagem e fecha o round atomicamente', async () => {
    const TRIP = '07900000-0000-4000-a000-000000001001';
    await seedTrip(TRIP);

    const round = await callRoundCreate(pool, {
      tripId: TRIP, mode: 'DIRECT',
      recipients: [{ driver_id: DRIVER_A, asset_id: ASSET_A }],
      createdBy: ADM_A, requestId: 'req-direct-1',
    });
    assert.equal(round.mode, 'DIRECT');
    assert.equal(round.status, 'ASSIGNED');
    assert.ok(round.winner_offer_id);

    const { rows: offers } = await pool.query('SELECT * FROM public.dispatch_offers WHERE round_id=$1', [round.id]);
    assert.equal(offers.length, 1);
    assert.equal(offers[0].status, 'ACCEPTED');
    assert.equal(offers[0].driver_id, DRIVER_A);

    const { rows: trips } = await pool.query('SELECT candidate_driver_id, candidate_asset_id FROM public.campaign_planned_trips WHERE id=$1', [TRIP]);
    assert.equal(trips[0].candidate_driver_id, DRIVER_A);
    assert.equal(trips[0].candidate_asset_id, ASSET_A);
  });

  test('079 designacao direta e idempotente por request_id (replay nao duplica)', async () => {
    const TRIP = '07900000-0000-4000-a000-000000001002';
    await seedTrip(TRIP);
    const r1 = await callRoundCreate(pool, {
      tripId: TRIP, mode: 'DIRECT', recipients: [{ driver_id: DRIVER_A, asset_id: ASSET_A }],
      createdBy: ADM_A, requestId: 'req-direct-idem',
    });
    const r2 = await callRoundCreate(pool, {
      tripId: TRIP, mode: 'DIRECT', recipients: [{ driver_id: DRIVER_A, asset_id: ASSET_A }],
      createdBy: ADM_A, requestId: 'req-direct-idem',
    });
    assert.equal(r1.id, r2.id);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM public.dispatch_rounds WHERE planned_trip_id=$1', [TRIP]);
    assert.equal(rows[0].n, 1);
  });

  test('079 oferta: cria N pendentes; um aceite fecha o round e perde os demais', async () => {
    const TRIP = '07900000-0000-4000-a000-000000001003';
    await seedTrip(TRIP);
    const round = await callRoundCreate(pool, {
      tripId: TRIP, mode: 'OFFER',
      recipients: [{ driver_id: DRIVER_A, asset_id: ASSET_A }, { driver_id: DRIVER_B, asset_id: ASSET_B }],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdBy: ADM_A, requestId: 'req-offer-1',
    });
    assert.equal(round.status, 'OPEN');

    const { rows: pending } = await pool.query('SELECT * FROM public.dispatch_offers WHERE round_id=$1 ORDER BY driver_id', [round.id]);
    assert.equal(pending.length, 2);
    assert.ok(pending.every((o) => o.status === 'PENDING'));

    const winnerOffer = pending.find((o) => o.driver_id === DRIVER_A);
    const { rows: accepted } = await pool.query(
      'SELECT * FROM public.dispatch_offer_accept($1,$2,$3,$4,$5)',
      [EMP_A, winnerOffer.id, DRIVER_A, 'req-accept-1', 'corr-1'],
    );
    assert.equal(accepted[0].status, 'ACCEPTED');

    const { rows: after } = await pool.query('SELECT status FROM public.dispatch_offers WHERE round_id=$1 ORDER BY driver_id', [round.id]);
    const byDriver = Object.fromEntries((await pool.query('SELECT driver_id, status FROM public.dispatch_offers WHERE round_id=$1', [round.id])).rows.map((r) => [r.driver_id, r.status]));
    assert.equal(byDriver[DRIVER_A], 'ACCEPTED');
    assert.equal(byDriver[DRIVER_B], 'LOST');

    const { rows: roundAfter } = await pool.query('SELECT status, winner_offer_id FROM public.dispatch_rounds WHERE id=$1', [round.id]);
    assert.equal(roundAfter[0].status, 'ASSIGNED');
    assert.equal(roundAfter[0].winner_offer_id, winnerOffer.id);
  });

  test('079 CONCORRENCIA: dois motoristas aceitam a mesma rodada simultaneamente -> exatamente um vencedor', async () => {
    const TRIP = '07900000-0000-4000-a000-000000001004';
    await seedTrip(TRIP);
    const round = await callRoundCreate(pool, {
      tripId: TRIP, mode: 'OFFER',
      recipients: [{ driver_id: DRIVER_A, asset_id: ASSET_A }, { driver_id: DRIVER_B, asset_id: ASSET_B }],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdBy: ADM_A, requestId: 'req-offer-conc-1',
    });
    const { rows: offers } = await pool.query('SELECT id, driver_id FROM public.dispatch_offers WHERE round_id=$1', [round.id]);
    const offerA = offers.find((o) => o.driver_id === DRIVER_A);
    const offerB = offers.find((o) => o.driver_id === DRIVER_B);

    const c1 = await pool.connect();
    const c2 = await pool.connect();
    let results;
    try {
      results = await Promise.allSettled([
        c1.query('SELECT * FROM public.dispatch_offer_accept($1,$2,$3,$4,$5)', [EMP_A, offerA.id, DRIVER_A, 'req-conc-a', 'corr-conc']),
        c2.query('SELECT * FROM public.dispatch_offer_accept($1,$2,$3,$4,$5)', [EMP_A, offerB.id, DRIVER_B, 'req-conc-b', 'corr-conc']),
      ]);
    } finally {
      c1.release();
      c2.release();
    }

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 1, 'exatamente um accept deve ter sucesso');
    assert.equal(rejected.length, 1, 'exatamente um accept deve falhar deterministicamente');
    assert.match(String(rejected[0].reason?.message || ''), /offer_no_longer_available|planned_trip_not_dispatchable/);

    const { rows: acceptedOffers } = await pool.query(
      `SELECT count(*)::int AS n FROM public.dispatch_offers WHERE round_id=$1 AND status='ACCEPTED'`, [round.id],
    );
    assert.equal(acceptedOffers[0].n, 1, 'no maximo 1 offer ACCEPTED no round (invariante S13/S23)');

    const { rows: assignedRounds } = await pool.query(
      `SELECT count(*)::int AS n FROM public.dispatch_rounds WHERE planned_trip_id=$1 AND status='ASSIGNED'`, [TRIP],
    );
    assert.equal(assignedRounds[0].n, 1, 'no maximo 1 round ASSIGNED para a viagem (S20)');

    const { rows: trips } = await pool.query('SELECT candidate_driver_id FROM public.campaign_planned_trips WHERE id=$1', [TRIP]);
    assert.ok([DRIVER_A, DRIVER_B].includes(trips[0].candidate_driver_id), 'candidate_driver_id deve ser exatamente um dos dois');
  });

  test('079 CONCORRENCIA: cancelar o round enquanto um motorista aceita -> exatamente um desfecho valido, sem split-brain', async () => {
    const TRIP = '07900000-0000-4000-a000-000000001005';
    await seedTrip(TRIP);
    const round = await callRoundCreate(pool, {
      tripId: TRIP, mode: 'OFFER',
      recipients: [{ driver_id: DRIVER_A, asset_id: ASSET_A }],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdBy: ADM_A, requestId: 'req-offer-cancelrace',
    });
    const { rows: offers } = await pool.query('SELECT id FROM public.dispatch_offers WHERE round_id=$1', [round.id]);
    const offerId = offers[0].id;

    const c1 = await pool.connect();
    const c2 = await pool.connect();
    let results;
    try {
      results = await Promise.allSettled([
        c1.query('SELECT * FROM public.dispatch_offer_accept($1,$2,$3,$4,$5)', [EMP_A, offerId, DRIVER_A, 'req-race-accept', 'corr-race']),
        c2.query('SELECT * FROM public.dispatch_round_cancel($1,$2,$3,$4)', [EMP_A, round.id, ADM_A, 'race_cancel']),
      ]);
    } finally {
      c1.release();
      c2.release();
    }

    const { rows: roundFinal } = await pool.query('SELECT status FROM public.dispatch_rounds WHERE id=$1', [round.id]);
    const { rows: offerFinal } = await pool.query('SELECT status FROM public.dispatch_offers WHERE id=$1', [offerId]);

    // Desfechos validos: (a) accept venceu -> round ASSIGNED + offer ACCEPTED, cancel falhou;
    // (b) cancel venceu -> round CANCELLED + offer CANCELLED, accept falhou. NUNCA os dois ao
    // mesmo tempo (round ASSIGNED com offer CANCELLED, ou round CANCELLED com offer ACCEPTED).
    if (roundFinal[0].status === 'ASSIGNED') {
      assert.equal(offerFinal[0].status, 'ACCEPTED');
    } else if (roundFinal[0].status === 'CANCELLED') {
      assert.equal(offerFinal[0].status, 'CANCELLED');
    } else {
      assert.fail(`estado final inesperado do round: ${roundFinal[0].status}`);
    }
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'exatamente uma das duas operacoes deve ter sucesso final consistente');
  });

  test('079 CONCORRENCIA: designacao direta concorrente com aceite de oferta na mesma viagem -> no maximo uma designacao', async () => {
    const TRIP = '07900000-0000-4000-a000-000000001006';
    await seedTrip(TRIP);
    const round = await callRoundCreate(pool, {
      tripId: TRIP, mode: 'OFFER',
      recipients: [{ driver_id: DRIVER_A, asset_id: ASSET_A }],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdBy: ADM_A, requestId: 'req-offer-directrace',
    });
    const { rows: offers } = await pool.query('SELECT id FROM public.dispatch_offers WHERE round_id=$1', [round.id]);
    const offerId = offers[0].id;

    const c1 = await pool.connect();
    const c2 = await pool.connect();
    let results;
    try {
      results = await Promise.allSettled([
        c1.query('SELECT * FROM public.dispatch_offer_accept($1,$2,$3,$4,$5)', [EMP_A, offerId, DRIVER_A, 'req-dr-accept', 'corr-dr']),
        // Tenta um direct-assign PARA OUTRO motorista na MESMA viagem enquanto o accept roda.
        callRoundCreate(c2, {
          tripId: TRIP, mode: 'DIRECT', recipients: [{ driver_id: DRIVER_C, asset_id: ASSET_C }],
          createdBy: ADM_A, requestId: 'req-dr-direct',
        }).then((row) => ({ rows: [row] })),
      ]);
    } finally {
      c1.release();
      c2.release();
    }

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    assert.ok(fulfilled.length >= 1, 'pelo menos uma operacao deve ter sucesso (a outra falha deterministicamente)');

    const { rows: assignedRounds } = await pool.query(
      `SELECT count(*)::int AS n FROM public.dispatch_rounds WHERE planned_trip_id=$1 AND status='ASSIGNED'`, [TRIP],
    );
    assert.equal(assignedRounds[0].n, 1, 'no maximo 1 round ASSIGNED para a viagem mesmo com direct-assign concorrente (S36)');

    const { rows: trips } = await pool.query('SELECT candidate_driver_id FROM public.campaign_planned_trips WHERE id=$1', [TRIP]);
    assert.ok([DRIVER_A, DRIVER_C].includes(trips[0].candidate_driver_id));
  });

  test('079 recusa: motorista recusa oferta pendente (idempotente)', async () => {
    const TRIP = '07900000-0000-4000-a000-000000001007';
    await seedTrip(TRIP);
    const round = await callRoundCreate(pool, {
      tripId: TRIP, mode: 'OFFER',
      recipients: [{ driver_id: DRIVER_A, asset_id: ASSET_A }],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdBy: ADM_A, requestId: 'req-decline-1',
    });
    const { rows: offers } = await pool.query('SELECT id FROM public.dispatch_offers WHERE round_id=$1', [round.id]);
    const offerId = offers[0].id;

    const { rows: r1 } = await pool.query('SELECT * FROM public.dispatch_offer_decline($1,$2,$3,$4,$5)', [EMP_A, offerId, DRIVER_A, 'sem agenda', null]);
    assert.equal(r1[0].status, 'DECLINED');
    const { rows: r2 } = await pool.query('SELECT * FROM public.dispatch_offer_decline($1,$2,$3,$4,$5)', [EMP_A, offerId, DRIVER_A, 'sem agenda', null]);
    assert.equal(r2[0].status, 'DECLINED');
  });

  test('079 cancelamento: manager cancela round OPEN; ofertas pendentes viram CANCELLED (idempotente)', async () => {
    const TRIP = '07900000-0000-4000-a000-000000001008';
    await seedTrip(TRIP);
    const round = await callRoundCreate(pool, {
      tripId: TRIP, mode: 'OFFER',
      recipients: [{ driver_id: DRIVER_A, asset_id: ASSET_A }, { driver_id: DRIVER_B, asset_id: ASSET_B }],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdBy: ADM_A, requestId: 'req-cancel-1',
    });
    const { rows: r1 } = await pool.query('SELECT * FROM public.dispatch_round_cancel($1,$2,$3,$4)', [EMP_A, round.id, ADM_A, 'plano mudou']);
    assert.equal(r1[0].status, 'CANCELLED');
    const { rows: offers } = await pool.query('SELECT status FROM public.dispatch_offers WHERE round_id=$1', [round.id]);
    assert.ok(offers.every((o) => o.status === 'CANCELLED'));
    const { rows: r2 } = await pool.query('SELECT * FROM public.dispatch_round_cancel($1,$2,$3,$4)', [EMP_A, round.id, ADM_A, 'plano mudou']);
    assert.equal(r2[0].status, 'CANCELLED');
  });

  test('079 expiracao: aceite apos expires_at falha deterministicamente e expira o round', async () => {
    const TRIP = '07900000-0000-4000-a000-000000001009';
    await seedTrip(TRIP);
    const round = await callRoundCreate(pool, {
      tripId: TRIP, mode: 'OFFER',
      recipients: [{ driver_id: DRIVER_A, asset_id: ASSET_A }],
      expiresAt: new Date(Date.now() - 1000).toISOString(), // ja vencido
      createdBy: ADM_A, requestId: 'req-expired-1',
    });
    const { rows: offers } = await pool.query('SELECT id FROM public.dispatch_offers WHERE round_id=$1', [round.id]);
    await assert.rejects(
      () => pool.query('SELECT * FROM public.dispatch_offer_accept($1,$2,$3,$4,$5)', [EMP_A, offers[0].id, DRIVER_A, 'req-expired-accept', null]),
      /round_expired/,
    );
    // O accept falhou (nao materializou nada) -- a persistencia de EXPIRED e lazy
    // (self-heal em dispatch_round_create, S25), entao o status na linha permanece o
    // que estava antes; o que importa e que NENHUM offer virou ACCEPTED.
    const { rows: offerAfter } = await pool.query('SELECT status FROM public.dispatch_offers WHERE id=$1', [offers[0].id]);
    assert.equal(offerAfter[0].status, 'PENDING');
    const { rows: tripAfter } = await pool.query('SELECT candidate_driver_id FROM public.campaign_planned_trips WHERE id=$1', [TRIP]);
    assert.equal(tripAfter[0].candidate_driver_id, null);
  });

  test('079 self-heal: round expirado nao bloqueia a criacao de um novo round para a mesma viagem', async () => {
    const TRIP = '07900000-0000-4000-a000-000000001010';
    await seedTrip(TRIP);
    await callRoundCreate(pool, {
      tripId: TRIP, mode: 'OFFER', recipients: [{ driver_id: DRIVER_A, asset_id: ASSET_A }],
      expiresAt: new Date(Date.now() - 1000).toISOString(), createdBy: ADM_A, requestId: 'req-selfheal-old',
    });
    const round2 = await callRoundCreate(pool, {
      tripId: TRIP, mode: 'DIRECT', recipients: [{ driver_id: DRIVER_B, asset_id: ASSET_B }],
      createdBy: ADM_A, requestId: 'req-selfheal-new',
    });
    assert.equal(round2.status, 'ASSIGNED');
    const { rows: openRounds } = await pool.query(
      `SELECT count(*)::int AS n FROM public.dispatch_rounds WHERE planned_trip_id=$1 AND status='OPEN'`, [TRIP],
    );
    assert.equal(openRounds[0].n, 0);
  });

  test('079 seguranca: motorista nao pode aceitar/recusar oferta de outro motorista', async () => {
    const TRIP = '07900000-0000-4000-a000-000000001011';
    await seedTrip(TRIP);
    const round = await callRoundCreate(pool, {
      tripId: TRIP, mode: 'OFFER', recipients: [{ driver_id: DRIVER_A, asset_id: ASSET_A }],
      expiresAt: new Date(Date.now() + 60_000).toISOString(), createdBy: ADM_A, requestId: 'req-sec-owner',
    });
    const { rows: offers } = await pool.query('SELECT id FROM public.dispatch_offers WHERE round_id=$1', [round.id]);
    await assert.rejects(
      () => pool.query('SELECT * FROM public.dispatch_offer_accept($1,$2,$3,$4,$5)', [EMP_A, offers[0].id, DRIVER_B, 'req-sec-x', null]),
      /offer_not_owned_by_driver/,
    );
    await assert.rejects(
      () => pool.query('SELECT * FROM public.dispatch_offer_decline($1,$2,$3,$4,$5)', [EMP_A, offers[0].id, DRIVER_B, 'motivo', null]),
      /offer_not_owned_by_driver/,
    );
  });

  test('079 seguranca: nao materializa a viagem se o motorista estiver inativo (revalidacao no accept)', async () => {
    const TRIP = '07900000-0000-4000-a000-000000001012';
    await seedTrip(TRIP);
    await pool.query(
      `INSERT INTO public.driver_vehicle_assignments (empresa_id, driver_id, asset_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [EMP_A, DRIVER_INACTIVE, ASSET_A],
    );
    await assert.rejects(
      () => callRoundCreate(pool, {
        tripId: TRIP, mode: 'DIRECT', recipients: [{ driver_id: DRIVER_INACTIVE, asset_id: ASSET_A }],
        createdBy: ADM_A, requestId: 'req-sec-inactive',
      }),
      /driver_not_eligible/,
    );
  });

  test('079 seguranca: designacao direta rejeita motorista sem vinculo temporal ativo com o recurso pedido', async () => {
    const TRIP = '07900000-0000-4000-a000-000000001013';
    await seedTrip(TRIP);
    // DRIVER_A esta vinculado a ASSET_A (fixture), nao a ASSET_B.
    await assert.rejects(
      () => callRoundCreate(pool, {
        tripId: TRIP, mode: 'DIRECT', recipients: [{ driver_id: DRIVER_A, asset_id: ASSET_B }],
        createdBy: ADM_A, requestId: 'req-sec-stale',
      }),
      /stale_driver_resource_assignment/,
    );
  });

  test('079 tenant: nao aceita oferta/empresa de outro tenant', async () => {
    const TRIP = '07900000-0000-4000-a000-000000001014';
    await seedTrip(TRIP);
    const round = await callRoundCreate(pool, {
      tripId: TRIP, mode: 'OFFER', recipients: [{ driver_id: DRIVER_A, asset_id: ASSET_A }],
      expiresAt: new Date(Date.now() + 60_000).toISOString(), createdBy: ADM_A, requestId: 'req-tenant-1',
    });
    const { rows: offers } = await pool.query('SELECT id FROM public.dispatch_offers WHERE round_id=$1', [round.id]);
    await assert.rejects(
      () => pool.query('SELECT * FROM public.dispatch_offer_accept($1,$2,$3,$4,$5)', [EMP_B, offers[0].id, DRIVER_A, 'req-tenant-x', null]),
      /offer_not_found/,
    );
  });

  test('079 invariante: nao permite segunda rodada para viagem ja reivindicada antes da materializacao (S20 + gap fechado)', async () => {
    const TRIP = '07900000-0000-4000-a000-000000001015';
    await seedTrip(TRIP);
    const round = await callRoundCreate(pool, {
      tripId: TRIP, mode: 'DIRECT', recipients: [{ driver_id: DRIVER_A, asset_id: ASSET_A }],
      createdBy: ADM_A, requestId: 'req-gap-1',
    });
    assert.equal(round.status, 'ASSIGNED'); // reivindicada, mas ainda SEM campaign_trip_freights (fase 2 e app-level)
    await assert.rejects(
      () => callRoundCreate(pool, {
        tripId: TRIP, mode: 'DIRECT', recipients: [{ driver_id: DRIVER_B, asset_id: ASSET_B }],
        createdBy: ADM_A, requestId: 'req-gap-2',
      }),
      /planned_trip_not_dispatchable/,
    );
  });

  after(async () => {
    await pool.end();
  });
}
