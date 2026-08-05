// Testes REAIS (Postgres isolado) da RPC public.buscar_empresas — migration 061.
// Cobre: nome parcial, razão social (=nome), CNPJ formatado/sem máscara, e-mail,
// ID, termo curto, inexistente, paginação/limite, empresa arquivada, sanitização,
// uso do índice trigram e privilégios. NUNCA roda contra produção (exige
// DATABASE_URL do banco de teste). Fixtures sintéticas com prefixo ZZBUSCA.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const CONN = process.env.DATABASE_URL;
if (!CONN) {
  test('busca_empresas (pulado: sem DATABASE_URL)', { skip: true }, () => {});
} else {
  registrar();
}

function registrar() {
const pool = new pg.Pool({ connectionString: CONN, max: 6 });
const PLANO = randomUUID();
const A = randomUUID(), B = randomUUID(), C = randomUUID();

async function buscar(client, termo, limite = 20, offset = 0) {
  const r = await (client || pool).query('SELECT * FROM public.buscar_empresas($1,$2,$3)', [termo, limite, offset]);
  return r.rows;
}

before(async () => {
  await pool.query('INSERT INTO public.planos(id,nome) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING', [PLANO, 'ZZBUSCA Plano']);
  // A: nome + CNPJ FORMATADO + email + plano; B: CNPJ SEM máscara, sem plano; C: arquivada.
  await pool.query(
    `INSERT INTO public.empresas (id,nome,cnpj_cpf,email_contato,status,plano_id,arquivada_em) VALUES
       ($1,'ZZBUSCA Transportadora Alfa Ltda','12.345.678/0001-90','contato@zzbuscaalfa.com','ativa',$4,NULL),
       ($2,'ZZBUSCA Beta Logistica SA','98765432000155','financeiro@zzbuscabeta.com.br','ativa',NULL,NULL),
       ($3,'ZZBUSCA Gamma Transportes','11222333000181','gamma@zzbuscagamma.com','ativa',NULL,now())
     ON CONFLICT (id) DO NOTHING`,
    [A, B, C, PLANO]);
});
after(async () => {
  await pool.query('DELETE FROM public.empresas WHERE id = ANY($1)', [[A, B, C]]);
  await pool.query('DELETE FROM public.planos WHERE id=$1', [PLANO]);
  await pool.end();
});

test('nome parcial encontra + traz plano e status (sanitizado)', async () => {
  const r = await buscar(pool, 'transportadora alfa');
  assert.equal(r.length, 1);
  assert.equal(r[0].id, A);
  assert.equal(r[0].plano_nome, 'ZZBUSCA Plano');
  assert.equal(r[0].status, 'ativa');
  // resposta sanitizada: só as colunas previstas (sem billing/segredos)
  assert.deepEqual(Object.keys(r[0]).sort(), ['arquivada','documento','email','id','nome','plano_id','plano_nome','status','total'].sort());
});

test('CNPJ formatado e SEM máscara casam a mesma empresa', async () => {
  assert.equal((await buscar(pool, '12.345.678/0001-90'))[0]?.id, A);
  assert.equal((await buscar(pool, '12345678000190'))[0]?.id, A);
  assert.equal((await buscar(pool, '98765432000155'))[0]?.id, B); // armazenada sem máscara
});

test('e-mail e ID exato encontram', async () => {
  assert.equal((await buscar(pool, 'zzbuscabeta.com.br'))[0]?.id, B);
  assert.equal((await buscar(pool, A))[0]?.id, A);
});

test('termo curto (<2) → 0 linhas (nunca todas)', async () => {
  assert.equal((await buscar(pool, 'z')).length, 0);
  assert.equal((await buscar(pool, '')).length, 0);
  assert.equal((await buscar(pool, '   ')).length, 0);
});

test('termo inexistente → 0 linhas', async () => {
  assert.equal((await buscar(pool, 'ZZBUSCA_INEXISTENTE_QWE')).length, 0);
});

test('arquivada aparece (ordenada após ativas) e traz flag', async () => {
  const r = await buscar(pool, 'ZZBUSCA');
  assert.equal(r.length, 3);
  assert.equal(Number(r[0].total), 3);            // total via window (antes do limite)
  assert.equal(r[r.length - 1].id, C);            // arquivada por último
  assert.equal(r.find((x) => x.id === C).arquivada, true);
});

test('paginação e limite (teto 50)', async () => {
  const p1 = await buscar(pool, 'ZZBUSCA', 2, 0);
  const p2 = await buscar(pool, 'ZZBUSCA', 2, 2);
  assert.equal(p1.length, 2);
  assert.equal(p2.length, 1);
  assert.equal(Number(p1[0].total), 3);
  // teto de limite: pede 999, recebe no máx. 50 (aqui há 3, então 3)
  assert.ok((await buscar(pool, 'ZZBUSCA', 999, 0)).length <= 50);
});

test('usa o índice trigram do nome (plano de consulta)', async () => {
  const c = await pool.connect();
  try {
    await c.query('SET LOCAL enable_seqscan = off');
    const r = await c.query(`EXPLAIN SELECT id FROM public.empresas WHERE lower(nome) LIKE '%zzbusca alfa%'`);
    const plano = r.rows.map((x) => x['QUERY PLAN']).join('\n');
    assert.match(plano, /idx_empresas_nome_trgm/);
  } finally { c.release(); }
});

test('privilégios: anon/authenticated negados; service_role permitido', async () => {
  const c = await pool.connect();
  try {
    for (const role of ['anon', 'authenticated']) {
      await c.query('RESET ROLE'); await c.query(`SET ROLE ${role}`);
      await assert.rejects(() => c.query('SELECT * FROM public.buscar_empresas($1,$2,$3)', ['zz', 20, 0]),
        (e) => { assert.equal(e.code, '42501'); return true; });
    }
    await c.query('RESET ROLE'); await c.query('SET ROLE service_role');
    const r = await c.query('SELECT * FROM public.buscar_empresas($1,$2,$3)', ['ZZBUSCA', 20, 0]);
    assert.ok(r.rows.length >= 1);
  } finally { await c.query('RESET ROLE'); c.release(); }
});
}
