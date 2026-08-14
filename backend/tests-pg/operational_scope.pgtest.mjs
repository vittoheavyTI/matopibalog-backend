// Testes reais (PostgreSQL isolado) da migration 067.
// Fixtures sinteticas; nunca roda contra producao.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const CONN = process.env.DATABASE_URL;

if (!CONN) {
  test('operational scope PG tests exigem DATABASE_URL real', () => {
    assert.fail('DATABASE_URL ausente: a CI P1 deve executar Postgres 16 real, sem SKIP.');
  });
} else {
  registrar();
}

async function rejectsDb(fn, pattern) {
  await assert.rejects(fn, (error) => pattern.test(String(error.message || error.code || error)));
}

function registrar() {
  const pool = new Pool({ connectionString: CONN, max: 12 });
  const e1 = randomUUID();
  const e2 = randomUUID();
  const e3 = randomUUID();
  const g1 = randomUUID();
  const adminA = randomUUID();
  const adminB = randomUUID();
  let u1;
  let u2;
  let r1;

  before(async () => {
    await pool.query(`INSERT INTO public.empresas (id, nome) VALUES ($1, 'Empresa P1 A'), ($2, 'Empresa P1 B'), ($3, 'Empresa P1 C')`, [e1, e2, e3]);
    await pool.query(
      `INSERT INTO public.usuarios (id, empresa_id, tipo, status) VALUES ($1, $3, 'admin', 'ativo'), ($2, $3, 'admin', 'ativo')`,
      [adminA, adminB, e1],
    );
    await pool.query(`INSERT INTO public.grupos_empresariais (id, nome) VALUES ($1, 'Grupo P1')`, [g1]);
    await pool.query(
      `INSERT INTO public.grupo_empresarial_empresas (grupo_id, empresa_id, status) VALUES ($1, $2, 'ativo'), ($1, $3, 'ativo')`,
      [g1, e1, e2],
    );
  });

  after(async () => {
    await pool.query('DELETE FROM public.operational_scope_auditoria WHERE empresa_id IN ($1,$2,$3) OR grupo_id=$4', [e1, e2, e3, g1]).catch(() => {});
    await pool.query('DELETE FROM public.usuario_operacional_memberships WHERE empresa_id IN ($1,$2,$3) OR grupo_id=$4', [e1, e2, e3, g1]).catch(() => {});
    await pool.query('DELETE FROM public.regiao_operacional_unidades WHERE empresa_id IN ($1,$2,$3)', [e1, e2, e3]).catch(() => {});
    await pool.query('DELETE FROM public.regioes_operacionais WHERE empresa_id IN ($1,$2,$3)', [e1, e2, e3]).catch(() => {});
    await pool.query('DELETE FROM public.unidades_operacionais WHERE empresa_id IN ($1,$2,$3)', [e1, e2, e3]).catch(() => {});
    await pool.query('DELETE FROM public.grupo_empresarial_empresas WHERE grupo_id=$1 OR empresa_id IN ($2,$3,$4)', [g1, e1, e2, e3]).catch(() => {});
    await pool.query('DELETE FROM public.grupos_empresariais WHERE id=$1', [g1]).catch(() => {});
    await pool.query('DELETE FROM public.usuarios WHERE id IN ($1,$2)', [adminA, adminB]).catch(() => {});
    await pool.query('DELETE FROM public.empresas WHERE id IN ($1,$2,$3)', [e1, e2, e3]).catch(() => {});
    await pool.end();
  });

  test('rollout inicia legacy e primeira unidade muda para configured sem enforcement', async () => {
    const { rows } = await pool.query(
      `SELECT * FROM public.p1_criar_unidade($1,$2,'Matriz','MTZ','matriz',NULL,'Luis Eduardo','BA','America/Sao_Paulo',true,$3,'primeira unidade')`,
      [e1, g1, adminA],
    );
    u1 = rows[0].id;
    const mode = await pool.query('SELECT operational_scope_mode FROM public.empresas WHERE id=$1', [e1]);
    assert.equal(mode.rows[0].operational_scope_mode, 'configured');
    const audit = await pool.query(`SELECT count(*)::int AS n FROM public.operational_scope_auditoria WHERE action='unidade_criada' AND empresa_id=$1`, [e1]);
    assert.equal(audit.rows[0].n, 1);
  });

  test('duas primeiras unidades concorrentes resultam em apenas uma default ativa', async () => {
    const empresa = randomUUID();
    await pool.query(`INSERT INTO public.empresas (id, nome) VALUES ($1, 'Concorrencia')`, [empresa]);
    await Promise.allSettled([
      pool.query(`SELECT public.p1_criar_unidade($1,NULL,'A','A','operacional',NULL,NULL,NULL,NULL,true,$2,'race')`, [empresa, adminA]),
      pool.query(`SELECT public.p1_criar_unidade($1,NULL,'B','B','operacional',NULL,NULL,NULL,NULL,true,$2,'race')`, [empresa, adminA]),
    ]);
    const result = await pool.query(`SELECT count(*)::int AS n FROM public.unidades_operacionais WHERE empresa_id=$1 AND status='ativo' AND is_default=true`, [empresa]);
    assert.equal(result.rows[0].n, 1);
  });

  test('cross-company direto: membership/regiao/unidade incoerente falha no banco', async () => {
    const unitB = await pool.query(`SELECT * FROM public.p1_criar_unidade($1,$2,'B1','B1','operacional',NULL,NULL,NULL,NULL,true,$3,'b')`, [e2, g1, adminA]);
    u2 = unitB.rows[0].id;
    const reg = await pool.query(`SELECT * FROM public.p1_criar_regiao($1,$2,'Reg A','RA',$3,'reg')`, [e1, g1, adminA]);
    r1 = reg.rows[0].id;
    await rejectsDb(
      () => pool.query(`SELECT public.p1_criar_unidade($1,$2,'C1','C1','operacional',NULL,NULL,NULL,NULL,true,$3,'grupo inativo')`, [e3, g1, adminA]),
      /grupo_empresa_not_active/i,
    );
    await rejectsDb(
      () => pool.query(`SELECT public.p1_criar_regiao($1,$2,'Reg C','RC',$3,'grupo inativo')`, [e3, g1, adminA]),
      /grupo_empresa_not_active/i,
    );
    await rejectsDb(
      () => pool.query(
        `INSERT INTO public.usuario_operacional_memberships (usuario_id, empresa_id, scope_level, unidade_operacional_id)
         VALUES ($1,$2,'LOCAL',$3)`,
        [adminA, e1, u2],
      ),
      /violates foreign key|insert or update/i,
    );
    await rejectsDb(
      () => pool.query(
        `INSERT INTO public.regiao_operacional_unidades (empresa_id, regiao_id, unidade_operacional_id)
         VALUES ($1,$2,$3)`,
        [e1, r1, u2],
      ),
      /violates foreign key|insert or update/i,
    );
  });

  test('regiao atualiza atomicamente e rollback preserva vinculos anteriores', async () => {
    await pool.query(`SELECT public.p1_definir_unidades_regiao($1, ARRAY[$2]::uuid[], $3, 'ok')`, [r1, u1, adminA]);
    await rejectsDb(
      () => pool.query(`SELECT public.p1_definir_unidades_regiao($1, ARRAY[$2]::uuid[], $3, 'cross')`, [r1, u2, adminA]),
      /region_unit_cross_company_or_archived/i,
    );
    const result = await pool.query(`SELECT unidade_operacional_id FROM public.regiao_operacional_unidades WHERE regiao_id=$1 AND status='ativo'`, [r1]);
    assert.deepEqual(result.rows.map((r) => r.unidade_operacional_id), [u1]);
  });

  test('membership duplicado concorrente resulta em uma ativa e erro controlado por constraint', async () => {
    const target = randomUUID();
    await pool.query(`INSERT INTO public.usuarios (id, empresa_id, tipo, status) VALUES ($1,$2,'admin','ativo')`, [target, e1]);
    const attempts = await Promise.allSettled([
      pool.query(`SELECT public.p1_criar_membership($1,$2,NULL,'LOCAL',$3,NULL,'gestor',false,$4,'race')`, [target, e1, u1, adminA]),
      pool.query(`SELECT public.p1_criar_membership($1,$2,NULL,'LOCAL',$3,NULL,'gestor',false,$4,'race')`, [target, e1, u1, adminA]),
    ]);
    assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
    const active = await pool.query(`SELECT count(*)::int AS n FROM public.usuario_operacional_memberships WHERE usuario_id=$1 AND status='ativo'`, [target]);
    assert.equal(active.rows[0].n, 1);
  });

  test('enforcement falha se admin ativo nao tem membership e nao deixa estado parcial', async () => {
    await rejectsDb(
      () => pool.query(`SELECT public.p1_ativar_enforcement($1,$2,'sem admin B')`, [e1, adminA]),
      /admins_without_operational_membership/i,
    );
    const mode = await pool.query('SELECT operational_scope_mode FROM public.empresas WHERE id=$1', [e1]);
    assert.equal(mode.rows[0].operational_scope_mode, 'configured');
  });

  test('enforcement passa apos todos admins receberem membership', async () => {
    await pool.query(`SELECT public.p1_criar_membership($1,$2,NULL,'GLOBAL',NULL,NULL,'admin',true,$3,'bootstrap A')`, [adminA, e1, adminA]);
    await pool.query(`SELECT public.p1_criar_membership($1,$2,NULL,'GLOBAL',NULL,NULL,'admin',true,$3,'bootstrap B')`, [adminB, e1, adminA]);
    const result = await pool.query(`SELECT public.p1_ativar_enforcement($1,$2,'gate') AS r`, [e1, adminA]);
    assert.equal(result.rows[0].r.ok, true);
    const mode = await pool.query('SELECT operational_scope_mode FROM public.empresas WHERE id=$1', [e1]);
    assert.equal(mode.rows[0].operational_scope_mode, 'enforced');
  });

  test('RLS FORCE e grants fechados para anon/authenticated/PUBLIC', async () => {
    const rls = await pool.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN ('grupos_empresariais','unidades_operacionais','usuario_operacional_memberships','operational_scope_auditoria')
    `);
    assert.ok(rls.rows.length >= 4);
    assert.ok(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity));

    const grants = await pool.query(`
      SELECT grantee, privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema='public'
        AND table_name IN ('grupos_empresariais','unidades_operacionais','usuario_operacional_memberships','operational_scope_auditoria')
        AND grantee IN ('anon','authenticated','PUBLIC')
    `);
    assert.equal(grants.rows.length, 0);
  });
}
