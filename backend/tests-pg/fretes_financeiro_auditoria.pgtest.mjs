// Testes reais da migration 065: correcao financeira atomica de fretes legado.
// Roda no Postgres isolado do CI apos tests-pg/apply_schema.mjs.

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const CONN = process.env.DATABASE_URL;
const TABELA = 'public.fretes_financeiro_auditoria';

if (!CONN) {
  test('PG fretes-financeiro-auditoria (pulado: sem DATABASE_URL)', { skip: true }, () => {});
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
  const F_LOCKED = randomUUID();

  before(async () => {
    await pool.query(`INSERT INTO public.empresas (id, nome, status) VALUES ($1,'Empresa A','ativo'),($2,'Empresa B','ativo') ON CONFLICT DO NOTHING`, [E1, E2]);
    await pool.query(`INSERT INTO public.usuarios (id) VALUES ($1) ON CONFLICT DO NOTHING`, [A1]);
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM public.fretes_financeiro_auditoria');
    await pool.query('DELETE FROM public.fretes WHERE id = ANY($1::uuid[])', [[F1, F2, F_LOCKED]]);
    await pool.query(
      `INSERT INTO public.fretes
       (id, empresa_id, motorista_id, status, data, modalidade_calculo, toneladas, valor_tonelada_km, valor_frete, km_inicial, km_final)
       VALUES
       ($1,$2,$3,'ativo',now(),'tonelada_km',5,245,0,1,NULL),
       ($4,$2,$3,'ativo',now(),'tonelada_km',5,245,0,1,NULL),
       ($5,$2,$3,'cancelado',now(),'tonelada_km',5,245,0,1,NULL)`,
      [F1, E1, A1, F2, F_LOCKED],
    );
  });

  after(async () => { await pool.end(); });

  async function snapshot(frete = F1) {
    const { rows } = await pool.query(
      `SELECT jsonb_build_object(
        'modalidade_calculo', modalidade_calculo,
        'toneladas', toneladas,
        'valor_tonelada_km', valor_tonelada_km,
        'valor_frete', valor_frete,
        'km_inicial', km_inicial,
        'km_final', km_final,
        'status', status
      ) AS snapshot
       FROM public.fretes
       WHERE id=$1`,
      [frete],
    );
    return rows[0].snapshot;
  }

  async function rpc({
    frete = F1,
    empresa = E1,
    requestId = `req-${randomUUID()}`,
    patch = {},
    reason = 'correcao financeira legado auditada',
    source = 'painel_admin',
    correctionType = 'manual_legacy_financial_correction',
    expectedBeforeSnapshot,
  } = {}) {
    const expected = expectedBeforeSnapshot ?? await snapshot(frete);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE service_role');
      const { rows } = await c.query(
        `SELECT public.corrigir_frete_financeiro_legacy($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb) AS result`,
        [
          frete,
          empresa,
          A1,
          A1,
          reason,
          source,
          requestId,
          correctionType,
          JSON.stringify(expected),
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

  test('schema: RLS forca acesso indireto e service_role tem somente SELECT/INSERT na auditoria', async () => {
    const { rows: rls } = await pool.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = '${TABELA}'::regclass`);
    assert.equal(rls[0].relrowsecurity, true);
    assert.equal(rls[0].relforcerowsecurity, true);

    for (const role of ['anon', 'authenticated']) {
      const { rows } = await pool.query(`SELECT has_table_privilege($1, '${TABELA}', 'SELECT') AS ok`, [role]);
      assert.equal(rows[0].ok, false, `${role} sem SELECT direto`);
      const { rows: exec } = await pool.query(
        `SELECT has_function_privilege($1, 'public.corrigir_frete_financeiro_legacy(uuid,uuid,uuid,text,text,text,text,text,jsonb,jsonb)', 'EXECUTE') AS ok`,
        [role],
      );
      assert.equal(exec[0].ok, false, `${role} sem EXECUTE`);
    }

    for (const priv of ['SELECT', 'INSERT']) {
      const { rows } = await pool.query(`SELECT has_table_privilege('service_role', '${TABELA}', $1) AS ok`, [priv]);
      assert.equal(rows[0].ok, true, `service_role ${priv}`);
    }
    for (const priv of ['UPDATE', 'DELETE', 'TRUNCATE']) {
      const { rows } = await pool.query(`SELECT has_table_privilege('service_role', '${TABELA}', $1) AS ok`, [priv]);
      assert.equal(rows[0].ok, false, `service_role sem ${priv}`);
    }
  });

  test('correcao operacional grava update e auditoria no mesmo resultado', async () => {
    const result = await rpc({ patch: { valor_tonelada_km: 0.245, km_final: 800, valor_frete: 978.78 } });
    assert.equal(result.idempotent, false);
    assert.equal(result.before_snapshot.valor_tonelada_km, 245);
    assert.equal(Number(result.after_snapshot.valor_tonelada_km), 0.245);
    assert.equal(Number(result.after_snapshot.valor_frete), 978.78);

    const { rows: fretes } = await pool.query('SELECT valor_tonelada_km, km_final, valor_frete FROM public.fretes WHERE id=$1', [F1]);
    assert.equal(Number(fretes[0].valor_tonelada_km), 0.245);
    assert.equal(Number(fretes[0].km_final), 800);

    const { rows: audit } = await pool.query(`SELECT reason, source, request_id, actor_user_id, actor_auth_uid FROM ${TABELA} WHERE frete_id=$1`, [F1]);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].source, 'painel_admin');
    assert.equal(audit[0].actor_user_id, A1);
    assert.equal(audit[0].actor_auth_uid, A1);
  });

  test('request_id torna a correcao idempotente e nao aplica segundo patch', async () => {
    const requestId = `req-${randomUUID()}`;
    const expected = await snapshot(F1);
    await rpc({ requestId, expectedBeforeSnapshot: expected, patch: { valor_tonelada_km: 0.245, valor_frete: 0 } });
    const again = await rpc({ requestId, expectedBeforeSnapshot: expected, patch: { valor_tonelada_km: 0.5, valor_frete: 0 } });
    assert.equal(again.idempotent, true);

    const { rows: fretes } = await pool.query('SELECT valor_tonelada_km FROM public.fretes WHERE id=$1', [F1]);
    assert.equal(Number(fretes[0].valor_tonelada_km), 0.245);
    const { rows: audit } = await pool.query(`SELECT count(*)::int AS n FROM ${TABELA} WHERE frete_id=$1`, [F1]);
    assert.equal(audit[0].n, 1);
  });

  test('mesmo request_id concorrente serializa e retorna replay idempotente', async () => {
    const requestId = `req-${randomUUID()}`;
    const expected = await snapshot(F1);
    const calls = await Promise.allSettled([
      rpc({ requestId, expectedBeforeSnapshot: expected, patch: { valor_tonelada_km: 0.245, valor_frete: 0 } }),
      rpc({ requestId, expectedBeforeSnapshot: expected, patch: { valor_tonelada_km: 0.245, valor_frete: 0 } }),
    ]);

    assert.deepEqual(calls.map((r) => r.status), ['fulfilled', 'fulfilled']);
    const results = calls.map((r) => r.value);
    assert.equal(results.filter((r) => r.idempotent === false).length, 1);
    assert.equal(results.filter((r) => r.idempotent === true).length, 1);
    assert.equal(results[0].audit_id, results[1].audit_id);

    const { rows: audit } = await pool.query(`SELECT count(*)::int AS n FROM ${TABELA} WHERE frete_id=$1`, [F1]);
    assert.equal(audit[0].n, 1);
  });

  test('request_ids diferentes concorrentes no mesmo snapshot produzem 1 sucesso e 1 conflito', async () => {
    const expected = await snapshot(F1);
    const calls = await Promise.allSettled([
      rpc({ requestId: `req-${randomUUID()}`, expectedBeforeSnapshot: expected, patch: { valor_tonelada_km: 0.245, valor_frete: 0 } }),
      rpc({ requestId: `req-${randomUUID()}`, expectedBeforeSnapshot: expected, patch: { valor_tonelada_km: 0.5, valor_frete: 0 } }),
    ]);

    assert.equal(calls.filter((r) => r.status === 'fulfilled').length, 1);
    const rejected = calls.find((r) => r.status === 'rejected');
    assert.match(rejected.reason.message, /frete_financial_correction_concurrent_change/);

    const { rows: audit } = await pool.query(`SELECT count(*)::int AS n FROM ${TABELA} WHERE frete_id=$1`, [F1]);
    assert.equal(audit[0].n, 1);
    const { rows: fretes } = await pool.query('SELECT modalidade_calculo, toneladas, valor_tonelada_km, valor_frete, km_inicial, km_final FROM public.fretes WHERE id=$1', [F1]);
    const final = fretes[0];
    if (Number(final.valor_tonelada_km) === 0.245) assert.equal(Number(final.valor_frete), 0);
    else if (Number(final.valor_tonelada_km) === 0.5) assert.equal(Number(final.valor_frete), 0);
    else assert.fail(`valor_tonelada_km final inesperado: ${final.valor_tonelada_km}`);
  });

  test('snapshot esperado obsoleto recusa sem update e sem auditoria', async () => {
    const stale = await snapshot(F1);
    await rpc({ patch: { valor_tonelada_km: 0.245, valor_frete: 0 } });
    await assert.rejects(
      () => rpc({ requestId: `req-${randomUUID()}`, expectedBeforeSnapshot: stale, patch: { valor_tonelada_km: 0.5, valor_frete: 0 } }),
      /frete_financial_correction_concurrent_change/,
    );

    const { rows: fretes } = await pool.query('SELECT valor_tonelada_km FROM public.fretes WHERE id=$1', [F1]);
    assert.equal(Number(fretes[0].valor_tonelada_km), 0.245);
    const { rows: audit } = await pool.query(`SELECT count(*)::int AS n FROM ${TABELA} WHERE frete_id=$1`, [F1]);
    assert.equal(audit[0].n, 1);
  });

  test('request_id reutilizado para outro frete vira conflito e nao vaza auditoria anterior', async () => {
    const requestId = `req-${randomUUID()}`;
    await rpc({ requestId, patch: { valor_tonelada_km: 0.245, valor_frete: 0 } });
    await assert.rejects(
      () => rpc({ frete: F2, requestId, patch: { valor_tonelada_km: 0.5, valor_frete: 0 } }),
      /frete_financial_correction_request_id_conflict/,
    );

    const { rows: fretes } = await pool.query('SELECT valor_tonelada_km FROM public.fretes WHERE id=$1', [F2]);
    assert.equal(Number(fretes[0].valor_tonelada_km), 245);
  });

  test('status cancelado/finalizado fica locked e nao gera auditoria', async () => {
    await assert.rejects(
      () => rpc({ frete: F_LOCKED, patch: { valor_tonelada_km: 0.245, valor_frete: 0 } }),
      /frete_financial_correction_status_locked/,
    );
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${TABELA} WHERE frete_id=$1`, [F_LOCKED]);
    assert.equal(rows[0].n, 0);
  });

  test('empresa errada nao altera frete nem grava auditoria', async () => {
    await assert.rejects(
      () => rpc({ empresa: E2, patch: { valor_tonelada_km: 0.245, valor_frete: 0 } }),
      /frete_financial_correction_not_found/,
    );
    const { rows: fretes } = await pool.query('SELECT valor_tonelada_km FROM public.fretes WHERE id=$1', [F1]);
    assert.equal(Number(fretes[0].valor_tonelada_km), 245);
    const { rows: audit } = await pool.query(`SELECT count(*)::int AS n FROM ${TABELA}`);
    assert.equal(audit[0].n, 0);
  });

  test('campo fora da allowlist e limite operacional sao recusados sem update', async () => {
    await assert.rejects(() => rpc({ patch: { placa: 'ABC1234' } }), /frete_financial_correction_field_not_allowed/);
    await assert.rejects(() => rpc({ patch: { valor_tonelada_km: 150, valor_frete: 0 } }), /frete_operational_limit:valor_tonelada_km/);
    const { rows } = await pool.query('SELECT valor_tonelada_km FROM public.fretes WHERE id=$1', [F1]);
    assert.equal(Number(rows[0].valor_tonelada_km), 245);
  });

  test('source e correction_type sao allowlisted no banco', async () => {
    await assert.rejects(
      () => rpc({ source: 'browser', patch: { valor_tonelada_km: 0.245, valor_frete: 0 } }),
      /frete_financial_correction_source_not_allowed/,
    );
    await assert.rejects(
      () => rpc({ correctionType: 'tipo_livre', patch: { valor_tonelada_km: 0.245, valor_frete: 0 } }),
      /frete_financial_correction_type_not_allowed/,
    );
    const { rows: audit } = await pool.query(`SELECT count(*)::int AS n FROM ${TABELA}`);
    assert.equal(audit[0].n, 0);
  });

  test('se a auditoria falha, o update do frete tambem faz rollback', async () => {
    await pool.query('REVOKE INSERT ON TABLE public.fretes_financeiro_auditoria FROM service_role');
    try {
      await assert.rejects(
        () => rpc({ patch: { valor_tonelada_km: 0.245, valor_frete: 0 } }),
        /permission denied/,
      );
    } finally {
      await pool.query('GRANT INSERT ON TABLE public.fretes_financeiro_auditoria TO service_role');
    }
    const { rows: fretes } = await pool.query('SELECT valor_tonelada_km FROM public.fretes WHERE id=$1', [F1]);
    assert.equal(Number(fretes[0].valor_tonelada_km), 245);
    const { rows: audit } = await pool.query(`SELECT count(*)::int AS n FROM ${TABELA}`);
    assert.equal(audit[0].n, 0);
  });
}
