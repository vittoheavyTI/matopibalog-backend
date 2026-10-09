// Testes reais das migrations 085 e 086:
// 1. Staged rollout: Fase A (085 foundation backward-compatible) + Fase B (086 formal enforcement)
// 2. Paridade estrita de schema com producao para todas as 14 fontes ativas de auditoria unificada.

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const CONN = process.env.DATABASE_URL;
const ENABLED = process.env.E38_ENVELOPE_085_PG === '1';

if (!CONN || !ENABLED) {
  const motivo = !CONN ? 'DATABASE_URL ausente' : 'E38_ENVELOPE_085_PG diferente de 1';
  test(`PG E3.8 digital envelope (pulado: ${motivo})`, { skip: true }, () => {});
} else {
  registrar();
}

function registrar() {
  const here = dirname(fileURLToPath(import.meta.url));
  const migration085Path = join(here, '..', 'migrations', '085_unified_audit_digital_envelope.sql');
  const migration086Path = join(here, '..', 'migrations', '086_e38_formal_envelope_enforcement.sql');
  const fixturePath = join(here, 'e38_production_shape_fixture.sql');
  const pool = new Pool({ connectionString: CONN, max: 8 });

  const E1 = randomUUID();
  const E2 = randomUUID();
  const A1 = randomUUID();
  const F1 = randomUUID();
  const F2 = randomUUID();
  const F_LEGACY = randomUUID();
  const F_CANCELLED = randomUUID();

  before(async () => {
    // Aplica a migration 085 (Foundation) e fixtures dedicadas de producao
    const sql085 = readFileSync(migration085Path, 'utf8');
    await pool.query(sql085);
    const sqlFixture = readFileSync(fixturePath, 'utf8');
    await pool.query(sqlFixture);

    await pool.query(`INSERT INTO public.empresas (id, nome, status) VALUES ($1,'Empresa E38','ativo'),($2,'Empresa Outra','ativo') ON CONFLICT DO NOTHING`, [E1, E2]);
    await pool.query(`INSERT INTO public.usuarios (id, empresa_id, status) VALUES ($1,$2,'ativo') ON CONFLICT DO NOTHING`, [A1, E1]);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE public.frete_envelopes_digitais, public.lancamento_eventos CASCADE');
    await pool.query('DELETE FROM public.fretes WHERE id = ANY($1::uuid[])', [[F1, F2, F_LEGACY, F_CANCELLED]]);

    // Drop trigger se ja tiver sido instalado por teste anterior para permitir reset limpo
    await pool.query('DROP TRIGGER IF EXISTS trg_e38_check_frete_finalizado_envelope ON public.fretes');
    await pool.query('DROP TRIGGER IF EXISTS trg_e38_guard_frete_finalizado_envelope ON public.fretes');

    await pool.query(
      `INSERT INTO public.fretes
       (id, empresa_id, motorista_id, status, data, modalidade_calculo, toneladas, valor_tonelada_km, valor_frete, km_inicial, km_final)
       VALUES
       ($1,$2,$3,'ativo',now(),'valor_fixo',NULL,NULL,1200,100,200),
       ($4,$2,$3,'ativo',now(),'tonelada_km',5,0.25,0,10,NULL),
       ($5,$2,$3,'finalizado',now(),'valor_fixo',NULL,NULL,700,1,2),
       ($6,$2,$3,'cancelado',now(),'valor_fixo',NULL,NULL,700,1,2)`,
      [F1, E1, A1, F2, F_LEGACY, F_CANCELLED],
    );
  });

  after(async () => { await pool.end(); });

  async function rpc({ frete = F1, empresa = E1, requestId = `req-${randomUUID()}`, patch = {} } = {}) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE service_role');
      const { rows } = await c.query(
        `SELECT public.e38_finalize_frete_with_envelope($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) AS result`,
        [
          frete,
          empresa,
          A1,
          A1,
          'admin',
          'fechamento formal e38',
          'backend_finalization',
          requestId,
          requestId,
          JSON.stringify(patch),
        ],
      );
      await c.query('COMMIT');
      return rows[0].result;
    } catch (error) {
      await c.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      c.release();
    }
  }

  async function apply086Enforcement() {
    const sql = readFileSync(migration086Path, 'utf8');
    await pool.query(sql);
  }

  test('schema 085: envelope e service_role sao append-only/fail-closed', async () => {
    const { rows: rls } = await pool.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.frete_envelopes_digitais'::regclass`);
    assert.equal(rls[0].relrowsecurity, true);
    assert.equal(rls[0].relforcerowsecurity, true);

    for (const role of ['anon', 'authenticated']) {
      const { rows } = await pool.query(`SELECT has_table_privilege($1, 'public.frete_envelopes_digitais', 'SELECT') AS ok`, [role]);
      assert.equal(rows[0].ok, false, `${role} sem SELECT direto`);
      const { rows: exec } = await pool.query(
        `SELECT has_function_privilege($1, 'public.e38_finalize_frete_with_envelope(uuid,uuid,uuid,text,text,text,text,text,text,jsonb)', 'EXECUTE') AS ok`,
        [role],
      );
      assert.equal(exec[0].ok, false, `${role} sem EXECUTE`);
    }

    for (const priv of ['SELECT', 'INSERT']) {
      const { rows } = await pool.query(`SELECT has_table_privilege('service_role', 'public.frete_envelopes_digitais', $1) AS ok`, [priv]);
      assert.equal(rows[0].ok, true, `service_role ${priv}`);
    }
    for (const priv of ['UPDATE', 'DELETE', 'TRUNCATE']) {
      const { rows } = await pool.query(`SELECT has_table_privilege('service_role', 'public.frete_envelopes_digitais', $1) AS ok`, [priv]);
      assert.equal(rows[0].ok, false, `service_role sem ${priv}`);
    }
  });

  test('PHASE A (085 ONLY): direct UPDATE to finalizado succeeds without envelope (backward compatibility)', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE service_role');
      await c.query(`UPDATE public.fretes SET status='finalizado' WHERE id=$1`, [F1]);
      await c.query('COMMIT');
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      c.release();
    }

    const { rows } = await pool.query(`SELECT status FROM public.fretes WHERE id=$1`, [F1]);
    assert.equal(rows[0].status, 'finalizado', '085 isolada permite finalizacao legada sem quebra de producao');
  });

  test('PHASE A (085 ONLY): canonical RPC finalize also succeeds alongside legacy', async () => {
    const result = await rpc({ patch: { km_final: 300 } });
    assert.equal(result.idempotent, false);
    assert.equal(result.frete.status, 'finalizado');
    assert.equal(Number(result.frete.km_final), 300);
    assert.equal(result.envelope.frete_id, F1);
    assert.equal(result.envelope.envelope_hash.length, 64);
  });

  test('PHASE B (086 ENFORCEMENT): direct UPDATE to finalizado without envelope is DENIED at COMMIT', async () => {
    await apply086Enforcement();

    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE service_role');
      await c.query(`UPDATE public.fretes SET status='finalizado' WHERE id=$1`, [F1]);
      await assert.rejects(
        () => c.query('COMMIT'),
        /E38_FINALIZED_WITHOUT_FORMAL_ENVELOPE/,
      );
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }

    const { rows } = await pool.query(`SELECT status FROM public.fretes WHERE id=$1`, [F1]);
    assert.equal(rows[0].status, 'ativo');
  });

  test('PHASE B (086 ENFORCEMENT): direct INSERT with status=finalizado is DENIED at COMMIT', async () => {
    await apply086Enforcement();

    const newFreteId = randomUUID();
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE service_role');
      await c.query(
        `INSERT INTO public.fretes (id, empresa_id, motorista_id, status, data, valor_frete) VALUES ($1, $2, $3, 'finalizado', now(), 1000)`,
        [newFreteId, E1, A1],
      );
      await assert.rejects(
        () => c.query('COMMIT'),
        /E38_FINALIZED_WITHOUT_FORMAL_ENVELOPE/,
      );
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }

    const { rows } = await pool.query(`SELECT id FROM public.fretes WHERE id=$1`, [newFreteId]);
    assert.equal(rows.length, 0);
  });

  test('PHASE B (086 ENFORCEMENT): session GUC does NOT bypass the deferrable constraint trigger', async () => {
    await apply086Enforcement();

    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE service_role');
      await c.query(`SELECT set_config('app.e38_formal_envelope_authorized', 'true', true)`);
      await c.query(`UPDATE public.fretes SET status='finalizado' WHERE id=$1`, [F1]);
      await assert.rejects(
        () => c.query('COMMIT'),
        /E38_FINALIZED_WITHOUT_FORMAL_ENVELOPE/,
      );
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  test('PHASE B (086 ENFORCEMENT): canonical RPC satisfies the constraint trigger seamlessly', async () => {
    await apply086Enforcement();

    const result = await rpc({ patch: { km_final: 300 } });
    assert.equal(result.idempotent, false);
    assert.equal(result.frete.status, 'finalizado');
    assert.equal(Number(result.frete.km_final), 300);
    assert.equal(result.envelope.frete_id, F1);

    const { rows } = await pool.query(`SELECT status FROM public.fretes WHERE id=$1`, [F1]);
    assert.equal(rows[0].status, 'finalizado');
  });

  test('concorrencia: duas finalizacoes concorrentes resultam em exatamente 1 envelope formal', async () => {
    await apply086Enforcement();

    const requestId1 = `req-conc-1-${randomUUID()}`;
    const requestId2 = `req-conc-2-${randomUUID()}`;

    const [res1, res2] = await Promise.allSettled([
      rpc({ frete: F2, requestId: requestId1, patch: { km_final: 200 } }),
      rpc({ frete: F2, requestId: requestId2, patch: { km_final: 200 } }),
    ]);

    const successes = [res1, res2].filter((r) => r.status === 'fulfilled');
    assert.ok(successes.length >= 1, 'pelo menos 1 finalizacao concluida com sucesso');

    const { rows: envelopes } = await pool.query(
      `SELECT count(*)::int AS n, array_agg(id::text) AS ids FROM public.frete_envelopes_digitais WHERE frete_id=$1`,
      [F2],
    );
    assert.equal(envelopes[0].n, 1, 'exatamente 1 formal envelope criado');

    const { rows: fretes } = await pool.query(`SELECT status, km_final FROM public.fretes WHERE id=$1`, [F2]);
    assert.equal(fretes[0].status, 'finalizado');
    assert.equal(Number(fretes[0].km_final), 200);
  });

  test('failure atomicity: erro no patch nao finaliza frete e nao cria envelope', async () => {
    await assert.rejects(
      () => rpc({ patch: { campo_invalido: 'hacker' } }),
      /e38_frete_envelope_patch_field_not_allowed/,
    );

    const { rows: fretes } = await pool.query(`SELECT status FROM public.fretes WHERE id=$1`, [F1]);
    assert.equal(fretes[0].status, 'ativo');

    const { rows: envelopes } = await pool.query(`SELECT count(*)::int AS n FROM public.frete_envelopes_digitais WHERE frete_id=$1`, [F1]);
    assert.equal(envelopes[0].n, 0);
  });

  test('request_id repetido retorna replay idempotente e nao cria segundo envelope', async () => {
    const requestId = `req-${randomUUID()}`;
    const first = await rpc({ requestId, patch: { km_final: 300 } });
    const again = await rpc({ requestId, patch: { km_final: 400 } });
    assert.equal(first.idempotent, false);
    assert.equal(again.idempotent, true);
    assert.equal(first.envelope.id, again.envelope.id);

    const { rows: frete } = await pool.query(`SELECT km_final FROM public.fretes WHERE id=$1`, [F1]);
    assert.equal(Number(frete[0].km_final), 300);
  });

  test('frete legado ja finalizado sem envelope e classificado sem backfill', async () => {
    await assert.rejects(
      () => rpc({ frete: F_LEGACY }),
      /E38_LEGACY_FINALIZED_WITHOUT_FORMAL_ENVELOPE/,
    );
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM public.frete_envelopes_digitais WHERE frete_id=$1`, [F_LEGACY]);
    assert.equal(rows[0].n, 0);
  });

  test('append-only bloqueia mutacao do envelope depois de selado', async () => {
    const result = await rpc({ patch: { km_final: 300 } });
    await assert.rejects(
      () => pool.query(`UPDATE public.frete_envelopes_digitais SET reason='tamper' WHERE id=$1`, [result.envelope.id]),
      /FRETE_ENVELOPE_DIGITAL_IMUTAVEL/,
    );
    await assert.rejects(
      () => pool.query(`DELETE FROM public.frete_envelopes_digitais WHERE id=$1`, [result.envelope.id]),
      /FRETE_ENVELOPE_DIGITAL_IMUTAVEL/,
    );
  });

  test('read model unificado: fail-closed quando empresa_id e nulo', async () => {
    await assert.rejects(
      () => pool.query(`SELECT * FROM public.listar_auditoria_unificada(NULL, 50, NULL, NULL)`),
      /e38_auditoria_unificada_empresa_id_required/,
    );
  });

  test('read model unificado: exercita e valida todas as 14 fontes ativas sem column mismatch', async () => {
    // Sela 1 envelope formal (Fonte 1)
    await rpc({ patch: { km_final: 300 } });

    // Fonte 2: lancamento_eventos
    const leId = randomUUID();
    await pool.query(
      `INSERT INTO public.lancamento_eventos
       (empresa_id, entity_type, entity_id, frete_id, action, actor_user_id, actor_role, source, reason, metadata, occurred_at)
       VALUES ($1,'despesa',$2,$3,'approved',$4,'admin','web','aprovacao despesa','{}'::jsonb, now())`,
      [E1, leId, F1, A1],
    );

    // Fonte 3: fretes_financeiro_auditoria
    await pool.query(
      `INSERT INTO public.fretes_financeiro_auditoria
       (frete_id, empresa_id, actor_user_id, reason, source, request_id, correction_type, before_snapshot, after_snapshot, created_at)
       VALUES ($1,$2,$3,'ajuste financeiro','painel_admin',$4,'manual_legacy_financial_correction','{}'::jsonb,'{}'::jsonb,now())`,
      [F1, E1, A1, `req-fin-${randomUUID()}`],
    );

    // Fonte 4: frete_documento_eventos
    const docId = randomUUID();
    await pool.query(
      `INSERT INTO public.frete_documentos (id, frete_id, empresa_id, tipo, status) VALUES ($1,$2,$3,'canhoto','pendente')`,
      [docId, F1, E1],
    );
    await pool.query(
      `INSERT INTO public.frete_documento_eventos
       (documento_id, frete_id, empresa_id, evento, actor_id, actor_role, source, reason, metadata, created_at)
       VALUES ($1,$2,$3,'uploaded',$4,'admin','api','upload doc','{}'::jsonb,now())`,
      [docId, F1, E1, A1],
    );

    // Fonte 5: erp_outbox
    await pool.query(
      `INSERT INTO public.erp_outbox
       (empresa_id, provider, event_id, event_type, dedupe_key, intent_fingerprint, canonical_envelope, status, created_at)
       VALUES ($1,'senior',$2,'freight_closed',$3,$4,$5::jsonb,'pending',now())`,
      [
        E1,
        `ev-${randomUUID()}`,
        `dedupe-${randomUUID()}`,
        '0'.repeat(64),
        JSON.stringify({ entity_type: 'frete', entity_id: F1, event_type: 'freight_closed' }),
      ],
    );

    // Fonte 6: permission_change_events
    await pool.query(
      `INSERT INTO public.permission_change_events
       (empresa_id, action, actor_user_id, target_type, target_id, permission_key, before_value, after_value, metadata, occurred_at)
       VALUES ($1,'user.override_set',$2,'user',$3,'freight.finish','deny','allow','{}'::jsonb,now())`,
      [E1, A1, A1],
    );

    // Fonte 7: operational_scope_auditoria
    await pool.query(
      `INSERT INTO public.operational_scope_auditoria
       (empresa_id, actor_user_id, action, reason, request_id, created_at)
       VALUES ($1,$2,'operational_scope_configured','configuracao escopo',$3,now())`,
      [E1, A1, `req-scope-${randomUUID()}`],
    );

    // Fonte 8: auth_event_audit
    await pool.query(
      `INSERT INTO public.auth_event_audit
       (event, usuario_id, empresa_id, resultado, motivo, ip_hash, user_agent, created_at)
       VALUES ('login_success',$1,$2,'ok','login efetuado',$3,'TestRunner',now())`,
      [A1, E1, 'ip_hash_abc'],
    );

    // Fonte 9: billing_outbox
    await pool.query(
      `INSERT INTO public.billing_outbox
       (empresa_id, event_type, dedupe_key, status, attempts, payload, created_at)
       VALUES ($1,'contratacao_apta',$2,'pending',0,'{}'::jsonb,now())`,
      [E1, `dedupe-bill-${randomUUID()}`],
    );

    // Fonte 10: contrato_eventos
    const propId = randomUUID();
    const contId = randomUUID();
    await pool.query(
      `INSERT INTO public.propostas_comerciais (id, empresa_id, status) VALUES ($1,$2,'aceita') ON CONFLICT DO NOTHING`,
      [propId, E1],
    );
    await pool.query(
      `INSERT INTO public.contratos_comerciais (id, proposta_id, empresa_id, status) VALUES ($1,$2,$3,'assinado') ON CONFLICT DO NOTHING`,
      [contId, propId, E1],
    );
    await pool.query(
      `INSERT INTO public.contrato_eventos (contrato_id, empresa_id, tipo, criado_por, criado_em) VALUES ($1,$2,'assinado',$3,now())`,
      [contId, E1, A1],
    );

    // Fonte 11: partner_network_events
    await pool.query(
      `INSERT INTO public.partner_network_events
       (empresa_id, entity_type, entity_id, action, actor_user_id, source, reason, metadata, occurred_at)
       VALUES ($1,'opportunity',$2,'opportunity_shared',$3,'web','compartilhamento','{}'::jsonb,now())`,
      [E1, randomUUID(), A1],
    );

    // Fonte 12: campaign_exceptions
    const campId = randomUUID();
    await pool.query(
      `INSERT INTO public.campaign_exceptions
       (empresa_id, campaign_id, exception_type, severity, status, resolution_reason, created_at)
       VALUES ($1,$2,'MAINTENANCE_CONFLICT','WARNING','OPEN','conflito agendado',now())`,
      [E1, campId],
    );

    // Fonte 13: odometer_events
    const assetId = randomUUID();
    await pool.query(
      `INSERT INTO public.odometer_events
       (empresa_id, asset_id, frete_id, event_type, reading_km, source, recorded_by, metadata, occurred_at)
       VALUES ($1,$2,$3,'check_in',1250.5,'api',$4,'{}'::jsonb,now())`,
      [E1, assetId, F1, A1],
    );

    // Fonte 14: maintenance_events
    await pool.query(
      `INSERT INTO public.maintenance_events
       (empresa_id, asset_id, maintenance_type, category, status, work_order, odometer_km, notes, created_by, created_at)
       VALUES ($1,$2,'preventive','engine','open','WO-001',1500.0,'troca oleo',$3,now())`,
      [E1, assetId, A1],
    );

    // Executa projecao global: deve retornar eventos de todas as 14 tabelas
    const { rows: allEvents } = await pool.query(
      `SELECT * FROM public.listar_auditoria_unificada($1, 100)`,
      [E1],
    );
    assert.ok(allEvents.length >= 14, `esperado ao menos 14 eventos (recebidos: ${allEvents.length})`);

    const sourcesFound = new Set(allEvents.map((r) => r.source_kind));
    const expectedSources = [
      'frete_envelopes_digitais',
      'lancamento_eventos',
      'fretes_financeiro_auditoria',
      'frete_documento_eventos',
      'erp_outbox',
      'permission_change_events',
      'operational_scope_auditoria',
      'auth_event_audit',
      'billing_outbox',
      'contrato_eventos',
      'partner_network_events',
      'campaign_exceptions',
      'odometer_events',
      'maintenance_events',
    ];

    for (const s of expectedSources) {
      assert.ok(sourcesFound.has(s), `fonte ${s} deve projetar sem erros`);
    }

    // Executa timeline de frete: deve retornar exatamente as 6 fontes ligadas a F1
    const { rows: freightTimeline } = await pool.query(
      `SELECT * FROM public.listar_auditoria_unificada($1, 100, NULL, NULL, 'frete', $2)`,
      [E1, F1],
    );
    assert.ok(freightTimeline.length >= 6, `esperado ao menos 6 eventos na freight timeline (recebidos: ${freightTimeline.length})`);
    const freightSources = new Set(freightTimeline.map((r) => r.source_kind));
    const expectedFreightSources = [
      'frete_envelopes_digitais',
      'lancamento_eventos',
      'fretes_financeiro_auditoria',
      'frete_documento_eventos',
      'erp_outbox',
      'odometer_events',
    ];
    for (const fs of expectedFreightSources) {
      assert.ok(freightSources.has(fs), `freight timeline source ${fs} deve estar presente`);
    }
  });
}
