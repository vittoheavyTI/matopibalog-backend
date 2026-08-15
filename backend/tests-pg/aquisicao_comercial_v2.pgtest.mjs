// Testes REAIS (PostgreSQL isolado) da aquisicao comercial v2.
//
// Prova a garantia persistente de concorrencia/atomicidade da migration 068:
// - duas chamadas simultaneas equivalentes retornam uma aquisicao canonica;
// - duas chamadas simultaneas divergentes deixam apenas uma ativa e a outra em conflito;
// - falha apos superseder contrato antigo faz rollback integral.
//
// Fixtures 100% sinteticas. Pula sem DATABASE_URL.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const CONN = process.env.DATABASE_URL;

if (!CONN) {
  test('aquisicao comercial v2 PG tests (pulados: sem DATABASE_URL)', { skip: true }, () => {});
} else {
  registrar();
}

function registrar() {
  const pool = new Pool({ connectionString: CONN, max: 8 });
  const ids = [];

  before(async () => {
    const { rows } = await pool.query(`
      SELECT to_regprocedure('public.iniciar_aquisicao_comercial_v2(uuid,uuid,uuid,text,jsonb,text,text,boolean)') AS fn
    `);
    assert.ok(rows[0]?.fn, 'Schema PG nao aplicado: execute npm run test:pg:apply antes dos pgtests.');
  });

  after(async () => {
    for (const id of ids) {
      await pool.query('DELETE FROM public.billing_outbox WHERE empresa_id = $1', [id]).catch(() => {});
      await pool.query('DELETE FROM public.empresas WHERE id = $1', [id]).catch(() => {});
    }
    await pool.end();
  });

  async function fixtureEmpresa() {
    const empresa = randomUUID();
    const plano = randomUUID();
    const usuario = randomUUID();
    ids.push(empresa);
    await pool.query('INSERT INTO public.planos (id, nome) VALUES ($1, $2) ON CONFLICT DO NOTHING', [plano, 'Start PG']);
    await pool.query(
      `INSERT INTO public.empresas (id, nome, status, plano_id, trial_started_at, trial_ends_at, commercial_flow_version)
       VALUES ($1, 'Empresa PG', 'trial', $2, now() - interval '15 days', now() - interval '1 day', 'v2')`,
      [empresa, plano],
    );
    await pool.query('INSERT INTO public.usuarios (id, empresa_id, tipo, status) VALUES ($1, $2, $3, $4)', [usuario, empresa, 'admin', 'ativo']);
    return { empresa, plano, usuario };
  }

  function snapshot(plano, overrides = {}) {
    return {
      template_version: 'comercial-v1-tecnico',
      origem: 'pos_trial_continuar',
      plano_id: plano,
      plano_nome: 'Start PG',
      quantidade_contratada: 7,
      valor_mensal: 499.9,
      valor_implantacao: 0,
      implantacao_gratis: true,
      total_inicial: 0,
      trial_dias: 0,
      trial_started_at: new Date(Date.now() - 15 * 86400000).toISOString(),
      trial_ends_at: new Date(Date.now() - 86400000).toISOString(),
      ...overrides,
    };
  }

  function chamar({ empresa, usuario, plano, snap }) {
    return pool.query(
      `SELECT * FROM public.iniciar_aquisicao_comercial_v2($1,$2,$3,$4,$5,$6,$7,$8)`,
      [empresa, usuario, plano, 'pos_trial_continuar', snap, 'Cliente PG', null, true],
    );
  }

  test('concorrencia mesma composicao cria/reusa uma aquisicao canonica', async () => {
    const fx = await fixtureEmpresa();
    const snap = snapshot(fx.plano);
    const resultados = await Promise.all([chamar({ ...fx, snap }), chamar({ ...fx, snap })]);
    const rows = resultados.map((r) => r.rows[0]);

    assert.equal(new Set(rows.map((r) => r.proposta_id)).size, 1);
    assert.equal(new Set(rows.map((r) => r.contrato_id)).size, 1);
    const { rows: counts } = await pool.query(
      `SELECT
         count(*) FILTER (WHERE p.origem IN ('aquisicao_explicita','pos_trial_continuar'))::int AS propostas,
         count(c.id)::int AS contratos
       FROM public.propostas_comerciais p
       LEFT JOIN public.contratos_comerciais c ON c.proposta_id = p.id
       WHERE p.empresa_id = $1`,
      [fx.empresa],
    );
    assert.equal(counts[0].propostas, 1);
    assert.equal(counts[0].contratos, 1);
  });

  test('concorrencia composicao divergente deixa uma ativa e uma em conflito', async () => {
    const fx = await fixtureEmpresa();
    const plano2 = randomUUID();
    await pool.query('INSERT INTO public.planos (id, nome) VALUES ($1, $2)', [plano2, 'Outro PG']);
    const a = chamar({ ...fx, snap: snapshot(fx.plano) });
    const b = chamar({ empresa: fx.empresa, usuario: fx.usuario, plano: plano2, snap: snapshot(plano2, { valor_mensal: 799.9 }) });
    const rows = (await Promise.all([a, b])).map((r) => r.rows[0]);

    assert.equal(rows.filter((r) => r.resultado === 'criada').length, 1);
    assert.equal(rows.filter((r) => r.resultado === 'conflito_aquisicao_ativa').length, 1);
    const { rows: counts } = await pool.query(
      `SELECT count(*)::int AS n FROM public.propostas_comerciais
       WHERE empresa_id = $1 AND origem IN ('aquisicao_explicita','pos_trial_continuar') AND status IN ('rascunho','enviada','aceita')`,
      [fx.empresa],
    );
    assert.equal(counts[0].n, 1);
  });

  test('erro depois de superseder contrato antigo faz rollback integral', async () => {
    const fx = await fixtureEmpresa();
    const { rows: prop } = await pool.query(
      `INSERT INTO public.propostas_comerciais (empresa_id, plano_id, status, origem, snapshot, valor_mensal)
       VALUES ($1,$2,'enviada','cadastro_publico',$3,499.90) RETURNING id`,
      [fx.empresa, fx.plano, snapshot(fx.plano)],
    );
    const { rows: ct } = await pool.query(
      `INSERT INTO public.contratos_comerciais (empresa_id, proposta_id, status, obrigatorio, template_version, provider, content_hash)
       VALUES ($1,$2,'aguardando_assinatura',true,'v','manual',$3) RETURNING id`,
      [fx.empresa, prop[0].id, 'a'.repeat(64)],
    );

    await assert.rejects(
      () => chamar({ ...fx, snap: snapshot(fx.plano, { valor_mensal: 'valor-invalido' }) }),
      /invalid input syntax|aquisicao/i,
    );

    const { rows } = await pool.query('SELECT status FROM public.contratos_comerciais WHERE id = $1', [ct[0].id]);
    assert.equal(rows[0].status, 'aguardando_assinatura');
  });
}
