// Testes reais da migration 085: fechamento formal de frete com envelope digital
// na mesma transacao e read model unificado sem inventar historico.

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
  const pool = new Pool({ connectionString: CONN, max: 8 });

  const E1 = randomUUID();
  const E2 = randomUUID();
  const A1 = randomUUID();
  const F1 = randomUUID();
  const F2 = randomUUID();
  const F_LEGACY = randomUUID();
  const F_CANCELLED = randomUUID();

  before(async () => {
    await pool.query(`INSERT INTO public.empresas (id, nome, status) VALUES ($1,'Empresa E38','ativo'),($2,'Empresa Outra','ativo') ON CONFLICT DO NOTHING`, [E1, E2]);
    await pool.query(`INSERT INTO public.usuarios (id, empresa_id, status) VALUES ($1,$2,'ativo') ON CONFLICT DO NOTHING`, [A1, E1]);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE public.frete_envelopes_digitais, public.lancamento_eventos CASCADE');
    await pool.query('DELETE FROM public.fretes WHERE id = ANY($1::uuid[])', [[F1, F2, F_LEGACY, F_CANCELLED]]);
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

  test('schema: envelope e service_role sao append-only/fail-closed', async () => {
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

  test('update direto para finalizado sem RPC e recusado pela guarda', async () => {
    await assert.rejects(
      () => pool.query(`UPDATE public.fretes SET status='finalizado' WHERE id=$1`, [F1]),
      /E38_FINALIZED_WITHOUT_FORMAL_ENVELOPE/,
    );

    const { rows } = await pool.query(`SELECT status FROM public.fretes WHERE id=$1`, [F1]);
    assert.equal(rows[0].status, 'ativo');
  });

  test('RPC finaliza frete e sela envelope na mesma transacao', async () => {
    const result = await rpc({ patch: { km_final: 300 } });
    assert.equal(result.idempotent, false);
    assert.equal(result.frete.status, 'finalizado');
    assert.equal(Number(result.frete.km_final), 300);
    assert.equal(result.envelope.frete_id, F1);
    assert.equal(result.envelope.payload.schema_version, 'e38.freight_closure.v1');
    assert.equal(result.envelope.payload.frete_snapshot.status, 'finalizado');
    assert.equal(typeof result.envelope.envelope_hash, 'string');
    assert.equal(result.envelope.envelope_hash.length, 64);
    assert.equal(result.envelope.payload.envelope_hash, result.envelope.envelope_hash);

    const { rows: envelopes } = await pool.query(`SELECT count(*)::int AS n, envelope_hash FROM public.frete_envelopes_digitais WHERE frete_id=$1 GROUP BY envelope_hash`, [F1]);
    assert.equal(envelopes[0].n, 1);
    assert.equal(envelopes[0].envelope_hash.length, 64);
  });

  test('concorrencia: duas finalizacoes concorrentes resultam em exatamente 1 envelope formal', async () => {
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

  test('read model unificado inclui envelope e lancamento sem inventar campos', async () => {
    await rpc({ patch: { km_final: 300 } });
    await pool.query(
      `INSERT INTO public.lancamento_eventos
       (empresa_id, entity_type, entity_id, frete_id, action, actor_user_id, actor_role, source, reason, metadata)
       VALUES ($1,'despesa',$2,$3,'approved',$4,'admin','web','aprovacao operacional','{}'::jsonb)`,
      [E1, randomUUID(), F1, A1],
    );

    const { rows } = await pool.query(
      `SELECT * FROM public.listar_auditoria_unificada($1, 50, NULL, NULL) WHERE entity_id=$2 OR metadata->>'frete_id'=$2`,
      [E1, F1],
    );
    const sources = rows.map((r) => r.source_kind).sort();
    assert.deepEqual(sources, ['frete_envelopes_digitais', 'lancamento_eventos']);
    assert.ok(rows.every((r) => r.event_id && r.occurred_at));
  });
}
