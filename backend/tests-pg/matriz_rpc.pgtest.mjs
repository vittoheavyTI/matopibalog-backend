// Testes REAIS (PostgreSQL isolado, múltiplas conexões) da RPC transacional
// public.publicar_matriz_funcionalidades — migration 061.
//
// Executado no CI contra um Postgres efêmero (service container), NUNCA contra
// produção. Requer env DATABASE_URL. Fixtures 100% sintéticas.
//
//   node --test backend/tests-pg/matriz_rpc.pgtest.mjs
//
// Cobre (mandato seção 7): mudança/bump único/auditoria; idempotência; conflito
// de versão (409); concorrência (um vence, outro conflita); idêntica concorrente
// (no máx. 1 versão); planos distintos (locks restritos); rollback integral em
// falha; campos de auditoria; e privilégios (anon/authenticated/PUBLIC negados,
// service_role permitido).

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const CONN = process.env.DATABASE_URL;

// Robustez: se este arquivo for descoberto por um `node --test` sem DATABASE_URL
// (ex.: CI backend padrão), NÃO falhar — pular. Só executa no workflow pg-rpc-ci,
// que provê um Postgres efêmero. Assim não quebra o CI backend existente.
if (!CONN) {
  test('PG RPC tests (pulados: sem DATABASE_URL — rodam no workflow pg-rpc-ci)', { skip: true }, () => {});
} else {
  registrarTestes();
}

function registrarTestes() {
const pool = new Pool({ connectionString: CONN, max: 8 });

// UUIDs sintéticos estáveis por execução.
const P1 = randomUUID(), P2 = randomUUID();
const F1 = randomUUID(), F2 = randomUUID(), F3 = randomUUID();
const ATOR = randomUUID();

const FN = 'public.publicar_matriz_funcionalidades';

// Chama a RPC. Retorna o objeto jsonb; propaga erro (com .code SQLSTATE).
async function publicar(client, itens, versoes, { ator = ATOR, origem = 'painel_admin', reqId = 'req-1', motivo = null } = {}) {
  const q = `SELECT ${FN}($1::jsonb,$2::jsonb,$3::uuid,$4::text,$5::text,$6::text) AS r`;
  const res = await client.query(q, [JSON.stringify(itens), JSON.stringify(versoes || {}), ator, origem, reqId, motivo]);
  return res.rows[0].r;
}

async function versao(client, planoId) {
  const r = await client.query('SELECT matriz_funcionalidades_versao v FROM public.planos WHERE id=$1', [planoId]);
  return r.rows[0].v;
}
async function contarAuditoria(client) {
  const r = await client.query(`SELECT count(*)::int c FROM public.funcionalidade_auditoria WHERE acao='publicar'`);
  return r.rows[0].c;
}
async function contarCelulas(client, planoId) {
  const r = await client.query('SELECT count(*)::int c FROM public.plano_funcionalidades WHERE plano_id=$1', [planoId]);
  return r.rows[0].c;
}

before(async () => {
  // Fixtures sintéticas idempotentes.
  await pool.query('INSERT INTO public.planos(id,nome) VALUES ($1,$2),($3,$4) ON CONFLICT (id) DO NOTHING', [P1, 'Plano Teste 1', P2, 'Plano Teste 2']);
  await pool.query(
    `INSERT INTO public.funcionalidades(id,codigo,nome) VALUES ($1,$2,$3),($4,$5,$6),($7,$8,$9) ON CONFLICT (id) DO NOTHING`,
    [F1, 'feat_um', 'Feat Um', F2, 'feat_dois', 'Feat Dois', F3, 'feat_tres', 'Feat Tres']);
});

// Estado limpo antes de cada teste: zera matriz + auditoria + versões=1.
beforeEach(async () => {
  await pool.query('DELETE FROM public.plano_funcionalidades WHERE plano_id = ANY($1)', [[P1, P2]]);
  await pool.query('DELETE FROM public.funcionalidade_auditoria');
  await pool.query('UPDATE public.planos SET matriz_funcionalidades_versao=1 WHERE id = ANY($1)', [[P1, P2]]);
});

after(async () => { await pool.end(); });

// 1) Publicação com mudança: células, bump único, auditoria, retorno.
test('1. publicação com mudança → altera, bump único, 1 auditoria', async () => {
  const itens = [
    { plano_id: P1, funcionalidade_id: F1, disponibilidade: 'incluida' },
    { plano_id: P1, funcionalidade_id: F2, disponibilidade: 'opcional_paga', preco_especifico_centavos: 9900 },
  ];
  const r = await publicar(pool, itens, { [P1]: 1 }, { motivo: 'setup inicial' });
  assert.equal(r.alterado, true);
  assert.equal(r.idempotente, false);
  assert.equal(r.celulas_alteradas, 2);
  assert.equal(r.versao_nova[P1], 2);
  assert.equal(await versao(pool, P1), 2);
  assert.equal(await contarAuditoria(pool), 1);
  assert.equal(await contarCelulas(pool, P1), 2);
});

// 2) Publicação idêntica: nada escrito, sem versão nova, sem auditoria, idempotente.
test('2. republicação idêntica → idempotente, zero escrita/versão/auditoria', async () => {
  const itens = [{ plano_id: P1, funcionalidade_id: F1, disponibilidade: 'incluida' }];
  await publicar(pool, itens, { [P1]: 1 });               // v1 → v2
  assert.equal(await versao(pool, P1), 2);
  const audAntes = await contarAuditoria(pool);
  const r = await publicar(pool, itens, { [P1]: 2 });     // idêntico
  assert.equal(r.alterado, false);
  assert.equal(r.idempotente, true);
  assert.equal(await versao(pool, P1), 2);                // sem bump
  assert.equal(await contarAuditoria(pool), audAntes);    // sem novo evento
});

// 3) Versão esperada divergente → 409 (P0003), sem escrita/bump/auditoria.
test('3. versão esperada divergente → conflito P0003, sem efeitos', async () => {
  const itens = [{ plano_id: P1, funcionalidade_id: F1, disponibilidade: 'incluida' }];
  await assert.rejects(
    () => publicar(pool, itens, { [P1]: 999 }),
    (e) => { assert.equal(e.code, 'P0003'); assert.match(e.message, /conflito_versao/); return true; });
  assert.equal(await versao(pool, P1), 1);
  assert.equal(await contarCelulas(pool, P1), 0);
  assert.equal(await contarAuditoria(pool), 0);
});

// 3b) Versão esperada ausente para plano afetado → P0001 (422).
test('3b. versão esperada ausente → P0001', async () => {
  const itens = [{ plano_id: P1, funcionalidade_id: F1, disponibilidade: 'incluida' }];
  await assert.rejects(() => publicar(pool, itens, {}), (e) => { assert.equal(e.code, 'P0001'); return true; });
});

// 3c) Célula duplicada no payload → P0001.
test('3c. célula (plano+func) duplicada no payload → P0001', async () => {
  const itens = [
    { plano_id: P1, funcionalidade_id: F1, disponibilidade: 'incluida' },
    { plano_id: P1, funcionalidade_id: F1, disponibilidade: 'indisponivel' },
  ];
  await assert.rejects(() => publicar(pool, itens, { [P1]: 1 }), (e) => { assert.equal(e.code, 'P0001'); return true; });
});

// 3d) Disponibilidade inválida → P0001; plano/func inexistente → P0002.
test('3d. disponibilidade inválida → P0001; inexistente → P0002', async () => {
  await assert.rejects(
    () => publicar(pool, [{ plano_id: P1, funcionalidade_id: F1, disponibilidade: 'xxx' }], { [P1]: 1 }),
    (e) => { assert.equal(e.code, 'P0001'); return true; });
  await assert.rejects(
    () => publicar(pool, [{ plano_id: randomUUID(), funcionalidade_id: F1, disponibilidade: 'incluida' }], {}),
    (e) => { assert.equal(e.code, 'P0002'); return true; });
});

// 4) Duas publicações concorrentes na MESMA versão esperada → uma vence, outra conflita.
test('4. concorrência mesma versão → exatamente uma vence, outra 409', async () => {
  const a = await pool.connect(), b = await pool.connect();
  try {
    const itensA = [{ plano_id: P1, funcionalidade_id: F1, disponibilidade: 'incluida' }];
    const itensB = [{ plano_id: P1, funcionalidade_id: F2, disponibilidade: 'incluida' }];
    const [ra, rb] = await Promise.allSettled([
      publicar(a, itensA, { [P1]: 1 }, { reqId: 'A' }),
      publicar(b, itensB, { [P1]: 1 }, { reqId: 'B' }),
    ]);
    const ok = [ra, rb].filter((x) => x.status === 'fulfilled');
    const err = [ra, rb].filter((x) => x.status === 'rejected');
    assert.equal(ok.length, 1, 'exatamente uma deve vencer');
    assert.equal(err.length, 1, 'exatamente uma deve conflitar');
    assert.equal(err[0].reason.code, 'P0003');
    assert.equal(await versao(pool, P1), 2);              // só um bump
    assert.equal(await contarAuditoria(pool), 1);          // sem auditoria duplicada
  } finally { a.release(); b.release(); }
});

// 5) Duas publicações IDÊNTICAS simultâneas → no máx. 1 versão nova, sem auditoria vazia duplicada.
test('5. idênticas concorrentes → no máximo 1 versão nova', async () => {
  const a = await pool.connect(), b = await pool.connect();
  try {
    const itens = [{ plano_id: P1, funcionalidade_id: F1, disponibilidade: 'incluida' }];
    const res = await Promise.allSettled([
      publicar(a, itens, { [P1]: 1 }, { reqId: 'A' }),
      publicar(b, itens, { [P1]: 1 }, { reqId: 'B' }),
    ]);
    const ok = res.filter((x) => x.status === 'fulfilled');
    assert.ok(ok.length >= 1);
    assert.equal(await versao(pool, P1), 2, 'no máximo uma versão nova');
    assert.equal(await contarAuditoria(pool), 1, 'exatamente um evento de auditoria');
  } finally { a.release(); b.release(); }
});

// 6) Publicações em planos DIFERENTES → sem bloqueio global; ambas vencem.
test('6. planos distintos concorrentes → ambas vencem (locks restritos)', async () => {
  const a = await pool.connect(), b = await pool.connect();
  try {
    const [ra, rb] = await Promise.all([
      publicar(a, [{ plano_id: P1, funcionalidade_id: F1, disponibilidade: 'incluida' }], { [P1]: 1 }),
      publicar(b, [{ plano_id: P2, funcionalidade_id: F1, disponibilidade: 'incluida' }], { [P2]: 1 }),
    ]);
    assert.equal(ra.alterado, true);
    assert.equal(rb.alterado, true);
    assert.equal(await versao(pool, P1), 2);
    assert.equal(await versao(pool, P2), 2);
  } finally { a.release(); b.release(); }
});

// 7) Falha forçada (trigger de teste) após início → rollback integral, nada parcial.
test('7. falha no meio → rollback total (sem célula/versão/auditoria parcial)', async () => {
  await pool.query(`
    CREATE OR REPLACE FUNCTION public._falha_teste() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'falha_injetada_teste'; END $$;`);
  await pool.query(`CREATE TRIGGER _t_falha BEFORE INSERT ON public.funcionalidade_auditoria
                    FOR EACH ROW EXECUTE FUNCTION public._falha_teste();`);
  try {
    await assert.rejects(
      () => publicar(pool, [{ plano_id: P1, funcionalidade_id: F1, disponibilidade: 'incluida' }], { [P1]: 1 }),
      (e) => { assert.match(e.message, /falha_injetada_teste/); return true; });
    // Tudo revertido: célula, versão e auditoria.
    assert.equal(await contarCelulas(pool, P1), 0, 'nenhuma célula parcial');
    assert.equal(await versao(pool, P1), 1, 'nenhum bump parcial');
    assert.equal(await contarAuditoria(pool), 0, 'nenhuma auditoria órfã');
  } finally {
    await pool.query('DROP TRIGGER IF EXISTS _t_falha ON public.funcionalidade_auditoria');
    await pool.query('DROP FUNCTION IF EXISTS public._falha_teste()');
  }
});

// 8) Auditoria: ator/origem/request_id/before/after/diff/versões/células/motivo.
test('8. auditoria registra ator, origem, request_id, diff, versões, motivo', async () => {
  const itens = [{ plano_id: P1, funcionalidade_id: F1, disponibilidade: 'incluida' }];
  await publicar(pool, itens, { [P1]: 1 }, { origem: 'painel_admin', reqId: 'req-XYZ', motivo: 'motivo teste' });
  const r = await pool.query(`SELECT ator_id, origem, request_id, detalhe FROM public.funcionalidade_auditoria WHERE acao='publicar' ORDER BY criado_em DESC LIMIT 1`);
  const a = r.rows[0];
  assert.equal(a.ator_id, ATOR);
  assert.equal(a.origem, 'painel_admin');
  assert.equal(a.request_id, 'req-XYZ');
  assert.equal(a.detalhe.motivo, 'motivo teste');
  assert.equal(a.detalhe.celulas_alteradas, 1);
  assert.ok(Array.isArray(a.detalhe.diff) && a.detalhe.diff.length === 1);
  assert.equal(a.detalhe.diff[0].antes, null);            // era inexistente
  assert.equal(a.detalhe.diff[0].depois.disponibilidade, 'incluida');
  assert.equal(a.detalhe.versao_anterior[P1], 1);
  assert.equal(a.detalhe.versao_nova[P1], 2);
});

// 9) Privilégios: PUBLIC/anon/authenticated NÃO executam; service_role executa.
test('9. privilégios: anon/authenticated/PUBLIC negados; service_role permitido', async () => {
  const c = await pool.connect();
  try {
    for (const role of ['anon', 'authenticated']) {
      await c.query('RESET ROLE');
      await c.query(`SET ROLE ${role}`);
      await assert.rejects(
        () => publicar(c, [{ plano_id: P1, funcionalidade_id: F1, disponibilidade: 'incluida' }], { [P1]: 1 }),
        (e) => { assert.equal(e.code, '42501', `${role} deveria ser negado`); return true; });
    }
    // service_role executa (concede EXECUTE). Usa versão corrente para não conflitar.
    await c.query('RESET ROLE');
    await c.query('SET ROLE service_role');
    const v = await versao(pool, P1);
    const r = await publicar(c, [{ plano_id: P1, funcionalidade_id: F1, disponibilidade: 'incluida' }], { [P1]: v });
    assert.ok(r.alterado === true || r.idempotente === true);
  } finally { await c.query('RESET ROLE'); c.release(); }
});
} // fim registrarTestes()
