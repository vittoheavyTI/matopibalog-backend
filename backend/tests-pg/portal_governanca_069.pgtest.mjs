// PG real (CI): valida a migration 069 (catálogo Estrutura/ERP/SSO do portal do
// cliente) contra Postgres 16 efêmero. Cobre:
//   - status técnico HONESTO: estrutura='disponivel'; ERP/SSO='em_breve'
//     (conector não implementado NÃO pode ser declarado disponível);
//   - matriz comercial por plano (plano_funcionalidades.disponibilidade);
//   - IDEMPOTÊNCIA: reaplicar 069 não lança e não duplica linhas.
// Nunca roda contra produção: exige DATABASE_URL do banco de teste.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const CONN = process.env.DATABASE_URL;

if (!CONN) {
  test('portal governança 069 PG (pulado: sem DATABASE_URL)', { skip: true }, () => {});
} else {
  registrar();
}

function registrar() {
  const here = dirname(fileURLToPath(import.meta.url));
  const sql069 = readFileSync(join(here, '..', 'migrations', '069_portal_cliente_governanca_entitlements.sql'), 'utf8');

  // Ids fixos e nomes distintos para não colidir com outros pgtests (DB compartilhado).
  const PLANOS = {
    start: { id: '10000000-0000-4000-a000-000000000101', nome: 'PG069 Start', categoria: 'empresa', limite_motoristas: 5, capacidade_inclusa: null, requer_negociacao: false },
    growth: { id: '10000000-0000-4000-a000-000000000102', nome: 'PG069 Growth', categoria: 'empresa', limite_motoristas: null, capacidade_inclusa: 25, requer_negociacao: false },
    scale: { id: '10000000-0000-4000-a000-000000000103', nome: 'PG069 Scale', categoria: 'empresa', limite_motoristas: null, capacidade_inclusa: 50, requer_negociacao: false },
    enterprise: { id: '10000000-0000-4000-a000-000000000104', nome: 'PG069 Enterprise', categoria: 'empresa', limite_motoristas: null, capacidade_inclusa: null, requer_negociacao: true },
  };

  const pool = new Pool({ connectionString: CONN });

  before(async () => {
    for (const p of Object.values(PLANOS)) {
      await pool.query(
        `INSERT INTO public.planos (id, nome, categoria, limite_motoristas, capacidade_inclusa, requer_negociacao)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET categoria=EXCLUDED.categoria, limite_motoristas=EXCLUDED.limite_motoristas,
           capacidade_inclusa=EXCLUDED.capacidade_inclusa, requer_negociacao=EXCLUDED.requer_negociacao`,
        [p.id, p.nome, p.categoria, p.limite_motoristas, p.capacidade_inclusa, p.requer_negociacao]
      );
    }
    // Reaplica 069 já com os planos semeados (o apply_schema roda 069 antes deles).
    await pool.query(sql069);
  });

  after(async () => {
    // plano_funcionalidades cai por ON DELETE CASCADE ao remover os planos de teste.
    for (const p of Object.values(PLANOS)) {
      await pool.query('DELETE FROM public.planos WHERE id = $1', [p.id]);
    }
    await pool.end();
  });

  async function statusFunc(codigo) {
    const { rows } = await pool.query('SELECT status_ciclo_vida, ativo, visivel_publicamente FROM public.funcionalidades WHERE codigo = $1', [codigo]);
    return rows[0];
  }

  async function disp(planoId, codigo) {
    const { rows } = await pool.query(
      `SELECT pf.disponibilidade
         FROM public.plano_funcionalidades pf
         JOIN public.funcionalidades f ON f.id = pf.funcionalidade_id
        WHERE pf.plano_id = $1 AND f.codigo = $2`,
      [planoId, codigo]
    );
    return rows[0]?.disponibilidade || null;
  }

  test('status técnico honesto: estrutura disponível; ERP/SSO em breve', async () => {
    assert.equal((await statusFunc('estrutura_operacional')).status_ciclo_vida, 'disponivel');
    assert.equal((await statusFunc('integracoes_erp')).status_ciclo_vida, 'em_breve');
    assert.equal((await statusFunc('acesso_corporativo_sso')).status_ciclo_vida, 'em_breve');
  });

  test('matriz comercial por plano (Start/Growth/Scale/Enterprise)', async () => {
    // Start (base 5): nada disponível.
    assert.equal(await disp(PLANOS.start.id, 'estrutura_operacional'), 'indisponivel');
    assert.equal(await disp(PLANOS.start.id, 'integracoes_erp'), 'indisponivel');
    assert.equal(await disp(PLANOS.start.id, 'acesso_corporativo_sso'), 'indisponivel');

    // Growth (base 25): estrutura/ERP como adicional pago; SSO ainda indisponível.
    assert.equal(await disp(PLANOS.growth.id, 'estrutura_operacional'), 'opcional_paga');
    assert.equal(await disp(PLANOS.growth.id, 'integracoes_erp'), 'opcional_paga');
    assert.equal(await disp(PLANOS.growth.id, 'acesso_corporativo_sso'), 'indisponivel');

    // Scale (base 50): estrutura/ERP incluídos; SSO sob negociação.
    assert.equal(await disp(PLANOS.scale.id, 'estrutura_operacional'), 'incluida');
    assert.equal(await disp(PLANOS.scale.id, 'integracoes_erp'), 'incluida');
    assert.equal(await disp(PLANOS.scale.id, 'acesso_corporativo_sso'), 'sob_negociacao');

    // Enterprise (sob proposta): tudo incluído comercialmente.
    assert.equal(await disp(PLANOS.enterprise.id, 'estrutura_operacional'), 'incluida');
    assert.equal(await disp(PLANOS.enterprise.id, 'integracoes_erp'), 'incluida');
    assert.equal(await disp(PLANOS.enterprise.id, 'acesso_corporativo_sso'), 'incluida');
  });

  test('idempotência: reaplicar 069 não lança e não duplica', async () => {
    await pool.query(sql069);
    await pool.query(sql069);
    for (const p of Object.values(PLANOS)) {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n
           FROM public.plano_funcionalidades pf
           JOIN public.funcionalidades f ON f.id = pf.funcionalidade_id
          WHERE pf.plano_id = $1
            AND f.codigo IN ('estrutura_operacional','integracoes_erp','acesso_corporativo_sso')`,
        [p.id]
      );
      assert.equal(rows[0].n, 3, `plano ${p.nome} deve ter exatamente 3 vínculos (sem duplicar)`);
    }
  });
}
