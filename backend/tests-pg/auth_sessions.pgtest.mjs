// Testes REAIS (PostgreSQL isolado, múltiplas conexões) do modelo de sessões
// revogáveis — migration 062 (SEC-1). CI: Postgres efêmero. Fixtures 100%
// sintéticas; pepper/tokens sintéticos (nunca segredos reais).
//
//   node --test backend/tests-pg/auth_sessions.pgtest.mjs
//
// Cobre (hardening): schema/RLS/FORCE/append-only REAL (UPDATE/DELETE/TRUNCATE/
// ALTER/DISABLE TRIGGER negados p/ service_role); criar sessão (FKs, client_type,
// idle>absoluto); refresh (só hash, expirado/revogado/inexistente); janela de
// graça VALIDADA (faixa) e SEM relógio injetável (limites determinísticos via
// now() constante-na-tx ajustando used_at); colisão×reuse; concorrência real;
// retry de resposta perdida; auditoria que SOBREVIVE ao resultado + rollback
// integral (sem auditoria enganosa); limpeza/retenção. Sem sleep.

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const CONN = process.env.DATABASE_URL;

if (!CONN) {
  test('PG auth-sessions (pulados: sem DATABASE_URL — rodam no workflow pg-rpc-ci)', { skip: true }, () => {});
} else {
  registrar();
}

function registrar() {
  const pool = new Pool({ connectionString: CONN, max: 8 });

  const TEST_PEPPER = 'pepper-sintetico-de-teste-SEC1-nao-usar-em-producao';
  const hash = (token) => createHmac('sha256', TEST_PEPPER).update(token).digest('hex');
  const novoToken = () => `rt_${randomUUID()}${randomUUID()}`;

  const U1 = randomUUID();
  const E1 = randomUUID();
  const dias = (n) => new Date(Date.now() + n * 86400000);
  const min  = (n) => new Date(Date.now() + n * 60000);

  async function criarSessao(client, {
    usuario = U1, empresa = E1, clientType = 'web', familyId = randomUUID(), token = novoToken(),
    refreshExp = dias(30), idle = min(120), abs = dias(30),
  } = {}) {
    const r = await client.query(
      `SELECT * FROM public.criar_sessao_auth($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [usuario, empresa, clientType, null, null, familyId, hash(token), refreshExp, idle, abs, 'ip_hash_sint', 'ua-teste', null]);
    return { ...r.rows[0], token, familyId };
  }

  // Rotação SEM relógio injetável (a RPC usa now()). grace do config server-side.
  async function rotacionar(client, apresentadoToken, { novo = novoToken(), novoExp = dias(30), novoIdle = min(120), reqId = 'req-teste', origem = 'teste', grace = 10 } = {}) {
    const r = await client.query(
      `SELECT * FROM public.rotacionar_refresh_token($1,$2,$3,$4,$5,$6,$7)`,
      [hash(apresentadoToken), hash(novo), novoExp, novoIdle, reqId, origem, grace]);
    return { ...r.rows[0], novoToken: novo };
  }

  // Reapresenta o refresh v1 (já usado) com IDADE controlada, SEM relógio injetável:
  // dentro de UMA transação now() é constante; ajustamos used_at = now()-idade e
  // chamamos a RPC na MESMA tx → (now()-used_at) = idade EXATA. Determinístico, sem sleep.
  async function reapresentarComIdade(s, idadeSeg, grace) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE public.auth_refresh_tokens SET used_at = now() - make_interval(secs => $1) WHERE session_id=$2 AND version=1`, [idadeSeg, s.session_id]);
      const r = await c.query(`SELECT * FROM public.rotacionar_refresh_token($1,$2,$3,$4,$5,$6,$7)`,
        [hash(s.token), hash(novoToken()), dias(30), min(120), 'req-idade', 'teste', grace]);
      await c.query('COMMIT');
      return r.rows[0];
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
    finally { c.release(); }
  }

  const sessRow  = async (id) => (await pool.query('SELECT * FROM public.auth_sessions WHERE id=$1', [id])).rows[0];
  const tokRows  = async (sid) => (await pool.query('SELECT * FROM public.auth_refresh_tokens WHERE session_id=$1 ORDER BY version', [sid])).rows;
  const auditos  = async (sid) => (await pool.query('SELECT * FROM public.auth_event_audit WHERE session_id=$1 ORDER BY created_at', [sid])).rows;
  const ativos   = async (sid) => (await pool.query('SELECT count(*)::int c FROM public.auth_refresh_tokens WHERE session_id=$1 AND used_at IS NULL AND revoked_at IS NULL', [sid])).rows[0].c;
  const totalAudit = async () => (await pool.query('SELECT count(*)::int c FROM public.auth_event_audit')).rows[0].c;

  before(async () => {
    await pool.query('INSERT INTO public.usuarios(id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [U1]);
    await pool.query('INSERT INTO public.empresas(id,nome) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING', [E1, 'Empresa Teste SEC1']);
  });

  // Limpeza pelo OWNER/postgres (nunca como service_role). A auditoria é append-only
  // (triggers bloqueiam DELETE/TRUNCATE); o owner desabilita os triggers p/ limpar.
  beforeEach(async () => {
    await pool.query('ALTER TABLE public.auth_event_audit DISABLE TRIGGER USER');
    await pool.query('TRUNCATE public.auth_event_audit');
    await pool.query('ALTER TABLE public.auth_event_audit ENABLE TRIGGER USER');
    await pool.query('DELETE FROM public.auth_sessions'); // cascade → refresh tokens
  });

  after(async () => { await pool.end(); });

  // ── SCHEMA / RLS / APPEND-ONLY / GRANTS ─────────────────────────────────────
  test('1. 3 tabelas com RLS habilitado E forçado', async () => {
    const r = await pool.query(`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname IN ('auth_sessions','auth_refresh_tokens','auth_event_audit') AND relnamespace='public'::regnamespace ORDER BY relname`);
    assert.equal(r.rows.length, 3);
    for (const row of r.rows) { assert.equal(row.relrowsecurity, true); assert.equal(row.relforcerowsecurity, true); }
  });

  test('2. auditoria NÃO tem coluna de token/hash/cookie/authorization/senha/otp', async () => {
    const r = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_event_audit'`);
    const cols = r.rows.map(x => x.column_name.toLowerCase());
    // Proibidos = segredos. ip_hash (IP mascarado) e refresh_family_id (id, não token)
    // são metadados legítimos e NÃO devem ser confundidos com token/hash de token.
    for (const p of ['token','cookie','authorization','senha','password','otp','payload']) {
      assert.ok(!cols.some(c => c.includes(p)), `auditoria não pode ter coluna ~${p} (${cols})`);
    }
  });

  test('3. append-only REAL + matriz de privilégios (service_role)', async () => {
    const c = await pool.connect();
    const rej = async (setupSql, badSql, code, msg) => {
      await c.query('BEGIN');
      try {
        if (setupSql) await c.query(setupSql);
        let err = null; try { await c.query(badSql); } catch (e) { err = e; }
        assert.ok(err, `${msg}: esperava rejeição`);
        if (code) assert.equal(err.code, code, `${msg}: code=${err.code}`);
      } finally { await c.query('ROLLBACK').catch(() => {}); }
    };
    try {
      // anon/authenticated: SELECT e EXECUTE negados (42501).
      for (const role of ['anon', 'authenticated']) {
        for (const tbl of ['auth_sessions', 'auth_event_audit']) {
          await rej(`SET LOCAL ROLE ${role}`, `SELECT 1 FROM public.${tbl} LIMIT 1`, '42501', `${role}/${tbl}`);
        }
        await rej(`SET LOCAL ROLE ${role}`, 'SELECT public.limpar_sessoes_expiradas(90)', '42501', `${role} EXECUTE`);
      }
      // service_role: INSERT/SELECT ok.
      await c.query('BEGIN');
      try {
        await c.query('SET LOCAL ROLE service_role');
        await c.query('SELECT 1 FROM public.auth_sessions LIMIT 1');
        await c.query(`INSERT INTO public.auth_event_audit(event,resultado) VALUES ('t','ok')`);
      } finally { await c.query('ROLLBACK').catch(() => {}); }
      // service_role: UPDATE/DELETE/TRUNCATE negados pelo GRANT (42501 — a checagem de
      // privilégio ocorre ANTES do trigger); ALTER TABLE e DISABLE TRIGGER negados por
      // NÃO ser owner (42501).
      await rej(`SET LOCAL ROLE service_role`, `UPDATE public.auth_event_audit SET event='x'`, '42501', 'service_role UPDATE');
      await rej(`SET LOCAL ROLE service_role`, `DELETE FROM public.auth_event_audit`, '42501', 'service_role DELETE');
      await rej(`SET LOCAL ROLE service_role`, `TRUNCATE public.auth_event_audit`, '42501', 'service_role TRUNCATE');
      await rej(`SET LOCAL ROLE service_role`, `ALTER TABLE public.auth_event_audit ADD COLUMN x int`, '42501', 'ALTER TABLE');
      await rej(`SET LOCAL ROLE service_role`, `ALTER TABLE public.auth_event_audit DISABLE TRIGGER USER`, '42501', 'DISABLE TRIGGER');
      // TRIGGER (defesa em profundidade): bloqueia mesmo COM privilégio. Como OWNER
      // (sem SET ROLE), UPDATE/DELETE (com 1 linha) e TRUNCATE disparam o trigger → P0001.
      await rej(`INSERT INTO public.auth_event_audit(event) VALUES ('t')`, `UPDATE public.auth_event_audit SET event='x'`, 'P0001', 'owner UPDATE (trigger)');
      await rej(`INSERT INTO public.auth_event_audit(event) VALUES ('t')`, `DELETE FROM public.auth_event_audit`, 'P0001', 'owner DELETE (trigger)');
      await rej(null, `TRUNCATE public.auth_event_audit`, 'P0001', 'owner TRUNCATE (trigger)');
    } finally { c.release(); }
  });

  // ── CRIAÇÃO ─────────────────────────────────────────────────────────────────
  test('4. criar sessão → v1, guarda SÓ hash', async () => {
    const s = await criarSessao(pool);
    const toks = await tokRows(s.session_id);
    assert.equal(toks.length, 1); assert.equal(toks[0].version, 1);
    assert.equal(toks[0].token_hash, hash(s.token)); assert.notEqual(toks[0].token_hash, s.token);
    assert.equal((await pool.query('SELECT count(*)::int c FROM public.auth_refresh_tokens WHERE token_hash=$1', [s.token])).rows[0].c, 0);
  });
  test('5. FK usuário inexistente → 23503', async () => { await assert.rejects(() => criarSessao(pool, { usuario: randomUUID() }), (e) => e.code === '23503'); });
  test('6. FK empresa inexistente → 23503', async () => { await assert.rejects(() => criarSessao(pool, { empresa: randomUUID() }), (e) => e.code === '23503'); });
  test('7. client_type inválido → P0001', async () => { await assert.rejects(() => criarSessao(pool, { clientType: 'desktop' }), (e) => e.code === 'P0001' || e.code === '23514'); });
  test('8. idle > absoluto → CHECK 23514', async () => { await assert.rejects(() => criarSessao(pool, { idle: dias(40), abs: dias(30) }), (e) => e.code === '23514'); });

  // ── ROTAÇÃO ─────────────────────────────────────────────────────────────────
  test('9. rotação ok → v2, usado+replaced, audita refresh_sucesso (PERSISTE)', async () => {
    const s = await criarSessao(pool);
    const rot = await rotacionar(pool, s.token);
    assert.equal(rot.resultado, 'ok'); assert.equal(rot.nova_version, 2);
    const toks = await tokRows(s.session_id);
    const v1 = toks.find(t => t.version === 1), v2 = toks.find(t => t.version === 2);
    assert.ok(v1.used_at !== null); assert.equal(v1.replaced_by, v2.id); assert.equal(v2.used_at, null);
    const aud = await auditos(s.session_id);
    assert.ok(aud.some(a => a.event === 'refresh_sucesso' && a.resultado === 'ok' && a.refresh_family_id === s.familyId), 'audit refresh_sucesso persistido');
  });
  test('10. hash inexistente → invalido', async () => { assert.equal((await rotacionar(pool, novoToken())).resultado, 'invalido'); });
  test('11. refresh expirado → expirado', async () => { const s = await criarSessao(pool, { refreshExp: min(-5) }); assert.equal((await rotacionar(pool, s.token)).resultado, 'expirado'); });
  test('12. sessão revogada → sessao_invalida', async () => {
    const s = await criarSessao(pool); await pool.query('UPDATE public.auth_sessions SET revoked_at=now() WHERE id=$1', [s.session_id]);
    assert.equal((await rotacionar(pool, s.token)).resultado, 'sessao_invalida');
  });
  test('13. absoluta expirada → sessao_invalida', async () => {
    const s = await criarSessao(pool);
    await pool.query(`UPDATE public.auth_sessions SET created_at=now()-interval '3 days', idle_expires_at=now()-interval '2 days', absolute_expires_at=now()-interval '1 day' WHERE id=$1`, [s.session_id]);
    assert.equal((await rotacionar(pool, s.token)).resultado, 'sessao_invalida');
  });

  // ── JANELA DE GRAÇA: validação de faixa ─────────────────────────────────────
  test('14. grace inválida (NULL / <0 / >300) → P0001', async () => {
    const s = await criarSessao(pool);
    for (const g of [null, -1, 301]) {
      await assert.rejects(() => rotacionar(pool, s.token, { grace: g }), (e) => e.code === 'P0001', `grace=${g}`);
    }
  });

  // ── COLISÃO (dentro) × REUSE (fora) ─────────────────────────────────────────
  test('15. colisão/retry DENTRO da janela → refresh_already_rotated, NÃO revoga, sem novo token, audita (PERSISTE)', async () => {
    const s = await criarSessao(pool);
    await rotacionar(pool, s.token, { grace: 10 });          // rotaciona; v1.used_at ~ now
    const antes = (await tokRows(s.session_id)).length;
    const col = await rotacionar(pool, s.token, { grace: 10 });  // reapresenta imediatamente → colisão
    assert.equal(col.resultado, 'refresh_already_rotated');
    assert.equal((await sessRow(s.session_id)).revoked_at, null, 'colisão NÃO revoga');
    assert.equal((await tokRows(s.session_id)).length, antes, 'colisão não emite novo token');
    assert.ok((await auditos(s.session_id)).some(a => a.event === 'refresh_colisao' && a.request_id === 'req-teste'), 'audit colisão persistido');
  });

  test('16. reuse FORA da janela → reuse_detected, revoga família+sessão, audita (PERSISTE); OUTRA família intacta', async () => {
    const outra = await criarSessao(pool, { familyId: randomUUID() });
    const s = await criarSessao(pool);
    await rotacionar(pool, s.token, { grace: 10 });
    const reuse = await reapresentarComIdade(s, 30, 10);      // 30s > 10s → reuse
    assert.equal(reuse.resultado, 'reuse_detected');
    const sess = await sessRow(s.session_id);
    assert.ok(sess.revoked_at !== null); assert.equal(sess.revoke_reason, 'refresh_reuse_detected');
    for (const t of await tokRows(s.session_id)) assert.ok(t.revoked_at !== null, 'todos tokens revogados');
    assert.ok((await auditos(s.session_id)).some(a => a.event === 'refresh_reuse' && a.resultado === 'reuse_detected'), 'audit reuse persistido');
    assert.equal((await sessRow(outra.session_id)).revoked_at, null, 'outra família intacta');
  });

  test('17. limites EXATOS (relógio controlado, sem sleep): 9s→colisão; 10s→colisão; 11s→reuse', async () => {
    for (const [idade, esperado, revoga] of [[9, 'refresh_already_rotated', false], [10, 'refresh_already_rotated', false], [11, 'reuse_detected', true]]) {
      const s = await criarSessao(pool, { familyId: randomUUID() });
      await rotacionar(pool, s.token, { grace: 10 });
      const r = await reapresentarComIdade(s, idade, 10);
      assert.equal(r.resultado, esperado, `idade=${idade}`);
      assert.equal((await sessRow(s.session_id)).revoked_at !== null, revoga, `idade=${idade} revoga?`);
    }
  });

  // ── CONCORRÊNCIA REAL ───────────────────────────────────────────────────────
  test('18. concorrência: 2 conexões, MESMO refresh → 1 ok + 1 colisão, família ATIVA, 1 filho, sem evento duplicado', async () => {
    const s = await criarSessao(pool);
    const cA = await pool.connect(), cB = await pool.connect();
    try {
      const [ra, rb] = await Promise.all([rotacionar(cA, s.token, { grace: 30 }), rotacionar(cB, s.token, { grace: 30 })]);
      assert.deepEqual([ra.resultado, rb.resultado].sort(), ['ok', 'refresh_already_rotated']);
      assert.equal((await sessRow(s.session_id)).revoked_at, null, 'família ativa');
      assert.equal(await ativos(s.session_id), 1, '1 só filho ativo');
      const aud = await auditos(s.session_id);
      assert.equal(aud.filter(a => a.event === 'refresh_sucesso').length, 1, '1 refresh_sucesso');
      assert.equal(aud.filter(a => a.event === 'refresh_colisao').length, 1, '1 refresh_colisao');
    } finally { cA.release(); cB.release(); }
  });

  // ── RESPOSTA PERDIDA / RETRY ────────────────────────────────────────────────
  test('19. resposta perdida: retry imediato → refresh_already_rotated, sem token no retorno, família intacta', async () => {
    const s = await criarSessao(pool);
    assert.equal((await rotacionar(pool, s.token, { grace: 10 })).resultado, 'ok');
    const retry = await rotacionar(pool, s.token, { grace: 10 });
    assert.equal(retry.resultado, 'refresh_already_rotated');
    assert.equal(retry.novo_token_id, null);
    assert.equal((await sessRow(s.session_id)).revoked_at, null);
  });

  // ── ROLLBACK: erro inesperado → sem estado parcial E sem auditoria enganosa ──
  test('20. erro inesperado na tx → rollback integral (rotação E auditoria descartadas)', async () => {
    const s = await criarSessao(pool);
    const auditAntes = await totalAudit();
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT * FROM public.rotacionar_refresh_token($1,$2,$3,$4,$5,$6,$7)`,
        [hash(s.token), hash(novoToken()), dias(30), min(120), 'req', 'teste', 10]);      // rotaciona + audita NA tx
      await assert.rejects(() => c.query('SELECT * FROM public.tabela_inexistente_sec1')); // erro inesperado
      await c.query('ROLLBACK');
    } finally { c.release(); }
    // Rotação revertida (só v1) e auditoria revertida (sem evento enganoso).
    assert.equal((await tokRows(s.session_id)).length, 1, 'rotação revertida');
    assert.equal(await totalAudit(), auditAntes, 'auditoria da tx abortada NÃO persiste');
  });

  // ── LIMPEZA / RETENÇÃO ──────────────────────────────────────────────────────
  test('21. limpeza: remove expiradas antigas; preserva ativa e recém-revogada', async () => {
    const ativa = await criarSessao(pool, { familyId: randomUUID() });
    const velha = await criarSessao(pool, { familyId: randomUUID() });
    await pool.query(`UPDATE public.auth_sessions SET created_at=now()-interval '200 days', idle_expires_at=now()-interval '190 days', absolute_expires_at=now()-interval '180 days' WHERE id=$1`, [velha.session_id]);
    const recem = await criarSessao(pool, { familyId: randomUUID() });
    await pool.query('UPDATE public.auth_sessions SET revoked_at=now() WHERE id=$1', [recem.session_id]);
    const n = (await pool.query('SELECT public.limpar_sessoes_expiradas(90) AS n')).rows[0].n;
    assert.ok(n >= 1);
    assert.ok(await sessRow(ativa.session_id));
    assert.equal(await sessRow(velha.session_id), undefined);
    assert.ok(await sessRow(recem.session_id));
  });
}
