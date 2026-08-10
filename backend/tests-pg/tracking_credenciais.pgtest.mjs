// Testes REAIS (PostgreSQL isolado) da migration 064 — credencial operacional
// escopada de rastreamento (SEC-1). CI: Postgres efêmero. Fixtures 100% sintéticas
// (empresa/usuario/frete/sessão e hashes sintéticos — nunca segredos reais).
//
//   node --test backend/tests-pg/tracking_credenciais.pgtest.mjs
//
// Cobre: schema/colunas, UNIQUE(credential_hash), CHECK(expires_at>=issued_at),
// RLS ENABLE+FORCE, matriz de grants (service_role CRUD; anon/authenticated negados),
// FKs (empresa/usuario obrigatórios), ON DELETE SET NULL (session/frete) e CASCADE
// (empresa/motorista), revogação (revoked_at) + filtro de credenciais ativas.

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

  const E1 = randomUUID();
  const M1 = randomUUID();
  const F1 = randomUUID();

  before(async () => {
    await pool.query(`INSERT INTO public.empresas (id, nome, status) VALUES ($1,'Empresa Teste','ativo') ON CONFLICT DO NOTHING`, [E1]);
    await pool.query(`INSERT INTO public.usuarios (id) VALUES ($1) ON CONFLICT DO NOTHING`, [M1]);
    await pool.query(`INSERT INTO public.fretes (id, empresa_id, motorista_id, status, data) VALUES ($1,$2,$3,'em_viagem', now()) ON CONFLICT DO NOTHING`, [F1, E1, M1]);
  });

  after(async () => { await pool.end(); });

  async function inserir({ hashVal = hash(randomUUID()), empresa = E1, motorista = M1, frete = F1, session = null, expires = dias(1), issued = new Date() } = {}) {
    const r = await pool.query(
      `INSERT INTO ${TABELA} (empresa_id, motorista_id, session_id, frete_id, credential_hash, issued_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [empresa, motorista, session, frete, hashVal, issued, expires]);
    return r.rows[0].id;
  }

  test('schema: colunas essenciais existem', async () => {
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='frete_tracking_credenciais'`);
    const cols = rows.map((r) => r.column_name);
    for (const c of ['id', 'empresa_id', 'motorista_id', 'session_id', 'frete_id', 'device_id', 'credential_hash', 'issued_at', 'expires_at', 'last_used_at', 'revoked_at', 'revoked_reason']) {
      assert.ok(cols.includes(c), `coluna ${c} ausente`);
    }
  });

  test('RLS habilitada e forçada', async () => {
    const { rows } = await pool.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.frete_tracking_credenciais'::regclass`);
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

  test('UNIQUE(credential_hash): hash duplicado é rejeitado', async () => {
    const h = hash(randomUUID());
    await inserir({ hashVal: h });
    await assert.rejects(() => inserir({ hashVal: h }), /duplicate key|unique/i);
  });

  test('CHECK(expires_at >= issued_at): expiração antes da emissão é rejeitada', async () => {
    await assert.rejects(
      () => inserir({ issued: new Date(), expires: new Date(Date.now() - 1000) }),
      /frete_tracking_cred_exp_chk|check/i);
  });

  test('FK: empresa/motorista inexistentes são rejeitados', async () => {
    await assert.rejects(() => inserir({ empresa: randomUUID() }), /foreign key|violates/i);
    await assert.rejects(() => inserir({ motorista: randomUUID() }), /foreign key|violates/i);
  });

  test('revogação: revoked_at exclui a credencial do conjunto ATIVO', async () => {
    const id = await inserir();
    const ativasAntes = await pool.query(`SELECT count(*)::int AS n FROM ${TABELA} WHERE id=$1 AND revoked_at IS NULL`, [id]);
    assert.equal(ativasAntes.rows[0].n, 1);
    await pool.query(`UPDATE ${TABELA} SET revoked_at = now(), revoked_reason='logout' WHERE id=$1`, [id]);
    const ativasDepois = await pool.query(`SELECT count(*)::int AS n FROM ${TABELA} WHERE id=$1 AND revoked_at IS NULL`, [id]);
    assert.equal(ativasDepois.rows[0].n, 0);
  });

  test('ON DELETE SET NULL: apagar o frete não apaga a credencial (frete_id → null)', async () => {
    const fLocal = randomUUID();
    await pool.query(`INSERT INTO public.fretes (id, empresa_id, motorista_id, status, data) VALUES ($1,$2,$3,'em_viagem', now())`, [fLocal, E1, M1]);
    const id = await inserir({ frete: fLocal });
    await pool.query(`DELETE FROM public.fretes WHERE id=$1`, [fLocal]);
    const { rows } = await pool.query(`SELECT frete_id FROM ${TABELA} WHERE id=$1`, [id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].frete_id, null);
  });

  test('ON DELETE CASCADE: apagar o motorista remove suas credenciais', async () => {
    const mLocal = randomUUID();
    await pool.query(`INSERT INTO public.usuarios (id) VALUES ($1)`, [mLocal]);
    const id = await inserir({ motorista: mLocal });
    await pool.query(`DELETE FROM public.usuarios WHERE id=$1`, [mLocal]);
    const { rows } = await pool.query(`SELECT id FROM ${TABELA} WHERE id=$1`, [id]);
    assert.equal(rows.length, 0);
  });
}
