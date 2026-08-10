// Testes REAIS (PostgreSQL isolado) da migration 064 — credencial operacional
// escopada de rastreamento (SEC-1), pós-revisão adversarial. Fixtures 100% sintéticas.
//
//   node --test backend/tests-pg/tracking_credenciais.pgtest.mjs
//
// Cobre: schema/colunas (incl. max_expires_at, device_id NOT NULL, session_id/frete_id
// NOT NULL), UNIQUE(hash), CHECK(max>=expires>=issued), RLS ENABLE+FORCE, grants
// (service_role CRUD; anon/authenticated negados), FKs obrigatórios, ON DELETE CASCADE
// (session e frete), revogação + filtro de ativas.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const CONN = process.env.DATABASE_URL;
const TABELA = 'public.frete_tracking_credenciais';

if (!CONN) {
  test('PG tracking-credenciais (pulados: sem DATABASE_URL — rodam no workflow pg-rpc-ci)', { skip: true }, () => {});
} else {
  registrar();
}

function registrar() {
  const pool = new Pool({ connectionString: CONN, max: 6 });
  const PEPPER = 'pepper-sintetico-tracking-SEC1-nao-usar-em-producao';
  const hash = (t) => createHmac('sha256', PEPPER).update('tracking:' + t).digest('hex');
  const dias = (n) => new Date(Date.now() + n * 86400000);
  const DEV = 'device-sintetico-1';

  const E1 = randomUUID();
  const M1 = randomUUID();
  const F1 = randomUUID();
  let S1; // session_id criado via RPC 062

  before(async () => {
    await pool.query(`INSERT INTO public.empresas (id, nome, status) VALUES ($1,'Empresa Teste','ativo') ON CONFLICT DO NOTHING`, [E1]);
    await pool.query(`INSERT INTO public.usuarios (id) VALUES ($1) ON CONFLICT DO NOTHING`, [M1]);
    await pool.query(`INSERT INTO public.fretes (id, empresa_id, motorista_id, status, data) VALUES ($1,$2,$3,'em_viagem', now()) ON CONFLICT DO NOTHING`, [F1, E1, M1]);
    const r = await pool.query(
      `SELECT * FROM public.criar_sessao_auth($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [M1, E1, 'android', null, null, randomUUID(), hash(randomUUID()), dias(30), dias(1), dias(30), null, 'ua', null]);
    S1 = r.rows[0].session_id;
  });

  after(async () => { await pool.end(); });

  async function inserir({ hashVal = hash(randomUUID()), empresa = E1, motorista = M1, frete = F1, session = null, device = DEV,
    issued = new Date(), expires = dias(1), max = dias(7) } = {}) {
    const sess = session || S1;
    const r = await pool.query(
      `INSERT INTO ${TABELA} (empresa_id, motorista_id, session_id, frete_id, device_id, credential_hash, issued_at, expires_at, max_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [empresa, motorista, sess, frete, device, hashVal, issued, expires, max]);
    return r.rows[0].id;
  }

  test('schema: colunas essenciais; session_id/device_id/max NOT NULL; frete_id NULLABLE (contexto)', async () => {
    const { rows } = await pool.query(
      `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='frete_tracking_credenciais'`);
    const map = Object.fromEntries(rows.map((r) => [r.column_name, r.is_nullable]));
    for (const c of ['id', 'empresa_id', 'motorista_id', 'session_id', 'frete_id', 'device_id', 'credential_hash', 'issued_at', 'expires_at', 'max_expires_at', 'last_used_at', 'revoked_at']) {
      assert.ok(c in map, `coluna ${c} ausente`);
    }
    // Âncoras operacionais NOT NULL:
    for (const c of ['session_id', 'device_id', 'max_expires_at']) {
      assert.equal(map[c], 'NO', `${c} deveria ser NOT NULL`);
    }
    // MULTI-VIAGEM: frete_id é contexto de emissão → NULLABLE.
    assert.equal(map['frete_id'], 'YES', 'frete_id deveria ser NULLABLE (contexto)');
  });

  test('RLS habilitada e forçada', async () => {
    const { rows } = await pool.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.frete_tracking_credenciais'::regclass`);
    assert.equal(rows[0].relrowsecurity, true);
    assert.equal(rows[0].relforcerowsecurity, true);
  });

  test('grants: service_role CRUD; anon/authenticated negados', async () => {
    for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      const { rows } = await pool.query(`SELECT has_table_privilege('service_role', '${TABELA}', $1) AS ok`, [priv]);
      assert.equal(rows[0].ok, true, `service_role deve ter ${priv}`);
    }
    for (const role of ['anon', 'authenticated']) {
      const { rows } = await pool.query(`SELECT has_table_privilege($1, '${TABELA}', 'SELECT') AS ok`, [role]);
      assert.equal(rows[0].ok, false, `${role} NÃO pode SELECT`);
    }
  });

  test('UNIQUE(credential_hash) rejeita duplicado', async () => {
    const h = hash(randomUUID());
    await inserir({ hashVal: h });
    await assert.rejects(() => inserir({ hashVal: h }), /duplicate key|unique/i);
  });

  test('CHECK(max_expires_at >= expires_at >= issued_at)', async () => {
    await assert.rejects(() => inserir({ issued: new Date(), expires: new Date(Date.now() - 1000) }), /exp_chk|check/i);
    await assert.rejects(() => inserir({ expires: dias(10), max: dias(1) }), /max_chk|check/i);
  });

  test('FK: empresa/motorista/sessão inexistentes rejeitados; frete inexistente (não-nulo) rejeitado', async () => {
    await assert.rejects(() => inserir({ empresa: randomUUID() }), /foreign key|violates/i);
    await assert.rejects(() => inserir({ motorista: randomUUID() }), /foreign key|violates/i);
    await assert.rejects(() => inserir({ session: randomUUID() }), /foreign key|violates/i);
    await assert.rejects(() => inserir({ frete: randomUUID() }), /foreign key|violates/i);
  });

  test('frete_id NULL é permitido (credencial sem contexto de emissão)', async () => {
    const id = await inserir({ frete: null });
    const { rows } = await pool.query(`SELECT frete_id FROM ${TABELA} WHERE id=$1`, [id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].frete_id, null);
  });

  test('device_id NOT NULL (binding)', async () => {
    await assert.rejects(() => inserir({ device: null }), /null value|not-null|violates/i);
  });

  test('revogação: revoked_at exclui do conjunto ATIVO', async () => {
    const id = await inserir();
    await pool.query(`UPDATE ${TABELA} SET revoked_at = now(), revoked_reason='logout' WHERE id=$1`, [id]);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${TABELA} WHERE id=$1 AND revoked_at IS NULL`, [id]);
    assert.equal(rows[0].n, 0);
  });

  test('ON DELETE SET NULL do FRETE: apagar a viagem de contexto NÃO mata a credencial (frete_id→null)', async () => {
    const fLocal = randomUUID();
    await pool.query(`INSERT INTO public.fretes (id, empresa_id, motorista_id, status, data) VALUES ($1,$2,$3,'em_viagem', now())`, [fLocal, E1, M1]);
    const id = await inserir({ frete: fLocal });
    await pool.query(`DELETE FROM public.fretes WHERE id=$1`, [fLocal]);
    const { rows } = await pool.query(`SELECT frete_id FROM ${TABELA} WHERE id=$1`, [id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].frete_id, null);
  });

  test('ON DELETE CASCADE: apagar a SESSÃO (âncora) remove a credencial', async () => {
    const r = await pool.query(
      `SELECT * FROM public.criar_sessao_auth($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [M1, E1, 'android', null, null, randomUUID(), hash(randomUUID()), dias(30), dias(1), dias(30), null, 'ua', null]);
    const sLocal = r.rows[0].session_id;
    const id = await inserir({ session: sLocal });
    await pool.query(`DELETE FROM public.auth_sessions WHERE id=$1`, [sLocal]);
    const { rows } = await pool.query(`SELECT id FROM ${TABELA} WHERE id=$1`, [id]);
    assert.equal(rows.length, 0);
  });
}
