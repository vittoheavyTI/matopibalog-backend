// Testes reais (PostgreSQL isolado) da migration 067.
// Fixtures sinteticas; nunca roda contra producao.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const CONN = process.env.DATABASE_URL;

if (!CONN) {
  test('operational scope PG tests (pulados: sem DATABASE_URL)', { skip: true }, () => {});
} else {
  registrar();
}

function registrar() {
  const pool = new Pool({ connectionString: CONN, max: 8 });
  const empresaId = randomUUID();
  const usuarioId = randomUUID();

  before(async () => {
    await pool.query(
      `INSERT INTO public.empresas (id, nome) VALUES ($1, 'Empresa P1') ON CONFLICT DO NOTHING`,
      [empresaId],
    );
    await pool.query(
      `INSERT INTO public.usuarios (id, empresa_id, tipo, status) VALUES ($1, $2, 'admin', 'ativo') ON CONFLICT DO NOTHING`,
      [usuarioId, empresaId],
    );
  });

  after(async () => {
    await pool.query('DELETE FROM public.usuario_operacional_memberships WHERE empresa_id=$1', [empresaId]).catch(() => {});
    await pool.query('DELETE FROM public.regiao_operacional_unidades WHERE empresa_id=$1', [empresaId]).catch(() => {});
    await pool.query('DELETE FROM public.regioes_operacionais WHERE empresa_id=$1', [empresaId]).catch(() => {});
    await pool.query('DELETE FROM public.unidades_operacionais WHERE empresa_id=$1', [empresaId]).catch(() => {});
    await pool.query('DELETE FROM public.usuarios WHERE id=$1', [usuarioId]).catch(() => {});
    await pool.query('DELETE FROM public.empresas WHERE id=$1', [empresaId]).catch(() => {});
    await pool.end();
  });

  test('uma empresa tem no maximo uma unidade default ativa', async () => {
    await pool.query(
      `INSERT INTO public.unidades_operacionais (empresa_id, nome, codigo, is_default)
       VALUES ($1, 'Matriz', 'MTZ', true)`,
      [empresaId],
    );
    await assert.rejects(
      () => pool.query(
        `INSERT INTO public.unidades_operacionais (empresa_id, nome, codigo, is_default)
         VALUES ($1, 'Outra default', 'DEF2', true)`,
        [empresaId],
      ),
      /duplicate key|unique/i,
    );
  });

  test('membership LOCAL, REGIONAL e GLOBAL respeitam shape constraints', async () => {
    const { rows: [unidade] } = await pool.query(
      `INSERT INTO public.unidades_operacionais (empresa_id, nome, codigo)
       VALUES ($1, 'Unidade Local', 'LOC') RETURNING id`,
      [empresaId],
    );
    const { rows: [regiao] } = await pool.query(
      `INSERT INTO public.regioes_operacionais (empresa_id, nome, codigo)
       VALUES ($1, 'Regional Norte', 'NORTE') RETURNING id`,
      [empresaId],
    );

    await pool.query(
      `INSERT INTO public.usuario_operacional_memberships
       (usuario_id, empresa_id, scope_level, unidade_operacional_id)
       VALUES ($1, $2, 'LOCAL', $3)`,
      [usuarioId, empresaId, unidade.id],
    );
    await pool.query(
      `INSERT INTO public.usuario_operacional_memberships
       (usuario_id, empresa_id, scope_level, regiao_operacional_id)
       VALUES ($1, $2, 'REGIONAL', $3)`,
      [usuarioId, empresaId, regiao.id],
    );
    await pool.query(
      `INSERT INTO public.usuario_operacional_memberships
       (usuario_id, empresa_id, scope_level)
       VALUES ($1, $2, 'GLOBAL')`,
      [usuarioId, empresaId],
    );

    await assert.rejects(
      () => pool.query(
        `INSERT INTO public.usuario_operacional_memberships
         (usuario_id, empresa_id, scope_level)
         VALUES ($1, $2, 'LOCAL')`,
        [randomUUID(), empresaId],
      ),
      /membership_shape_chk|violates check/i,
    );
  });

  test('anon/authenticated nao recebem grants diretos nas tabelas P1', async () => {
    const { rows } = await pool.query(`
      SELECT grantee, table_name, privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema='public'
        AND table_name IN (
          'grupos_empresariais',
          'unidades_operacionais',
          'usuario_operacional_memberships',
          'operational_scope_auditoria'
        )
        AND grantee IN ('anon','authenticated','PUBLIC')
    `);
    assert.equal(rows.length, 0);
  });
}
