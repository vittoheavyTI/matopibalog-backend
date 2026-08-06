// Testes REAIS (PostgreSQL isolado, múltiplas conexões) do modelo de sessões
// revogáveis — migration 062 (SEC-1).
//
// Executado no CI contra um Postgres efêmero (service container), NUNCA contra
// produção. Requer env DATABASE_URL. Fixtures 100% sintéticas. O pepper e os
// tokens usados aqui são SINTÉTICOS de teste — nunca segredos reais.
//
//   node --test backend/tests-pg/auth_sessions.pgtest.mjs
//
// Cobre (complementos vinculantes): schema/tipos/constraints/índices/RLS/FORCE
// RLS/grants; criar sessão (FKs, client_type, idle>absoluto); refresh (só hash,
// rotacionar, expirado/revogado/inexistente); POLÍTICA de janela — colisão
// concorrente/retry dentro da janela → refresh_already_rotated (SEM revogar),
// reuse FORA da janela → reuse_detected (revoga família); limites exatos da
// janela com RELÓGIO CONTROLADO (sem sleep longo); resposta perdida/retry;
// isolamento entre famílias; auditoria (colisão/reuse/sucesso, request_id, SEM
// token/hash); rollback integral; limpeza/retenção.

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
  const seg  = (base, n) => new Date(base.getTime() + n * 1000);

  async function criarSessao(client, {
    usuario = U1, empresa = E1, clientType = 'web', deviceId = null, deviceLabel = null,
    familyId = randomUUID(), token = novoToken(),
    refreshExp = dias(30), idle = min(120), abs = dias(30),
    ip = 'ip_hash_sintetico', ua = 'ua-teste', createdBy = null,
  } = {}) {
    const r = await client.query(
      `SELECT * FROM public.criar_sessao_auth($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [usuario, empresa, clientType, deviceId, deviceLabel, familyId, hash(token), refreshExp, idle, abs, ip, ua, createdBy]
    );
    return { ...r.rows[0], token, familyId };
  }

  // p_agora controlado (relógio) evita sleeps: testa limites exatos da janela.
  async function rotacionar(client, apresentadoToken, {
    novo = novoToken(), novoExp = dias(30), novoIdle = min(120),
    reqId = 'req-teste', origem = 'teste', grace = 10, agora = null,
  } = {}) {
    const r = await client.query(
      `SELECT * FROM public.rotacionar_refresh_token($1,$2,$3,$4,$5,$6,$7, COALESCE($8, now()))`,
      [hash(apresentadoToken), hash(novo), novoExp, novoIdle, reqId, origem, grace, agora]
    );
    return { ...r.rows[0], novoToken: novo };
  }

  const sessRow = async (id) => (await pool.query('SELECT * FROM public.auth_sessions WHERE id=$1', [id])).rows[0];
  const tokRows = async (sid) => (await pool.query('SELECT * FROM public.auth_refresh_tokens WHERE session_id=$1 ORDER BY version', [sid])).rows;
  const auditos = async (sid) => (await pool.query('SELECT * FROM public.auth_event_audit WHERE session_id=$1 ORDER BY created_at', [sid])).rows;
  const ativos  = async (sid) => (await pool.query('SELECT count(*)::int c FROM public.auth_refresh_tokens WHERE session_id=$1 AND used_at IS NULL AND revoked_at IS NULL', [sid])).rows[0].c;

  before(async () => {
    await pool.query('INSERT INTO public.usuarios(id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [U1]);
    await pool.query('INSERT INTO public.empresas(id,nome) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING', [E1, 'Empresa Teste SEC1']);
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM public.auth_event_audit');
    await pool.query('DELETE FROM public.auth_sessions'); // cascade limpa refresh tokens
  });

  after(async () => { await pool.end(); });

  // ── SCHEMA / RLS / GRANTS ───────────────────────────────────────────────────
  test('1. tabelas existem com RLS habilitado E forçado', async () => {
    const r = await pool.query(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE relname IN ('auth_sessions','auth_refresh_tokens','auth_event_audit') AND relnamespace='public'::regnamespace ORDER BY relname`);
    assert.equal(r.rows.length, 3);
    for (const row of r.rows) {
      assert.equal(row.relrowsecurity, true, `${row.relname} RLS`);
      assert.equal(row.relforcerowsecurity, true, `${row.relname} FORCE RLS`);
    }
  });

  test('2. auditoria NÃO tem coluna de token/hash/cookie/authorization', async () => {
    const r = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_event_audit'`);
    const cols = r.rows.map(x => x.column_name.toLowerCase());
    for (const proibido of ['token','token_hash','hash','cookie','authorization','refresh','senha','password']) {
      assert.ok(!cols.some(c => c.includes(proibido)), `auditoria não pode ter coluna ~${proibido} (achou em ${cols})`);
    }
  });

  test('3. grants: anon/authenticated negados (42501); service_role ok; auditoria append-only (sem DELETE)', async () => {
    const c = await pool.connect();
    try {
      for (const role of ['anon', 'authenticated']) {
        for (const tbl of ['auth_sessions','auth_event_audit']) {
          await c.query('BEGIN'); await c.query(`SET LOCAL ROLE ${role}`);
          await assert.rejects(() => c.query(`SELECT 1 FROM public.${tbl} LIMIT 1`), (e) => e.code === '42501', `${role}/${tbl}`);
          await c.query('ROLLBACK');
        }
        await c.query('BEGIN'); await c.query(`SET LOCAL ROLE ${role}`);
        await assert.rejects(() => c.query('SELECT public.limpar_sessoes_expiradas(90)'), (e) => e.code === '42501');
        await c.query('ROLLBACK');
      }
      // service_role: pode ler/inserir; auditoria é append-only via TRIGGER (P0001),
      // bloqueando UPDATE/DELETE mesmo com GRANT ALL/BYPASSRLS. Insere 1 linha para o
      // trigger FOR EACH ROW disparar (DELETE em tabela vazia afeta 0 linhas).
      await c.query('BEGIN'); await c.query('SET LOCAL ROLE service_role');
      await c.query('SELECT 1 FROM public.auth_sessions LIMIT 1');
      await c.query(`INSERT INTO public.auth_event_audit(event, resultado) VALUES ('teste_append_only','ok')`);
      await assert.rejects(() => c.query('DELETE FROM public.auth_event_audit'), (e) => e.code === 'P0001', 'DELETE bloqueado por trigger append-only');
      await assert.rejects(() => c.query(`UPDATE public.auth_event_audit SET event='x'`), (e) => e.code === 'P0001', 'UPDATE bloqueado por trigger append-only');
      await c.query('ROLLBACK');
    } finally { c.release(); }
  });

  // ── CRIAÇÃO ─────────────────────────────────────────────────────────────────
  test('4. criar sessão → v1, guarda SÓ hash', async () => {
    const s = await criarSessao(pool);
    const toks = await tokRows(s.session_id);
    assert.equal(toks.length, 1);
    assert.equal(toks[0].version, 1);
    assert.equal(toks[0].token_hash, hash(s.token));
    assert.notEqual(toks[0].token_hash, s.token);
    const plano = await pool.query('SELECT count(*)::int c FROM public.auth_refresh_tokens WHERE token_hash=$1', [s.token]);
    assert.equal(plano.rows[0].c, 0, 'token aberto nunca no banco');
  });

  test('5. FK usuário inexistente → 23503', async () => { await assert.rejects(() => criarSessao(pool, { usuario: randomUUID() }), (e) => e.code === '23503'); });
  test('6. FK empresa inexistente → 23503', async () => { await assert.rejects(() => criarSessao(pool, { empresa: randomUUID() }), (e) => e.code === '23503'); });
  test('7. client_type inválido → P0001', async () => { await assert.rejects(() => criarSessao(pool, { clientType: 'desktop' }), (e) => e.code === 'P0001' || e.code === '23514'); });
  test('8. idle > absoluto → CHECK 23514', async () => { await assert.rejects(() => criarSessao(pool, { idle: dias(40), abs: dias(30) }), (e) => e.code === '23514'); });

  // ── ROTAÇÃO NORMAL ──────────────────────────────────────────────────────────
  test('9. rotação válida → ok, v2, antigo usado+replaced_by, sessão atualizada, audita refresh_sucesso', async () => {
    const s = await criarSessao(pool);
    const rot = await rotacionar(pool, s.token);
    assert.equal(rot.resultado, 'ok');
    assert.equal(rot.nova_version, 2);
    assert.equal(rot.usuario_id, U1);
    const toks = await tokRows(s.session_id);
    const v1 = toks.find(t => t.version === 1), v2 = toks.find(t => t.version === 2);
    assert.ok(v1.used_at !== null); assert.equal(v1.replaced_by, v2.id); assert.equal(v2.used_at, null);
    const aud = await auditos(s.session_id);
    assert.ok(aud.some(a => a.event === 'refresh_sucesso' && a.resultado === 'ok'));
  });

  test('10. hash inexistente → invalido', async () => { assert.equal((await rotacionar(pool, novoToken())).resultado, 'invalido'); });
  test('11. refresh expirado → expirado', async () => {
    const s = await criarSessao(pool, { refreshExp: min(-5) });
    assert.equal((await rotacionar(pool, s.token)).resultado, 'expirado');
  });
  test('12. sessão revogada → sessao_invalida', async () => {
    const s = await criarSessao(pool);
    await pool.query('UPDATE public.auth_sessions SET revoked_at=now() WHERE id=$1', [s.session_id]);
    assert.equal((await rotacionar(pool, s.token)).resultado, 'sessao_invalida');
  });
  test('13. sessão com absoluta expirada → sessao_invalida', async () => {
    const s = await criarSessao(pool);
    await pool.query(`UPDATE public.auth_sessions SET created_at=now()-interval '3 days', idle_expires_at=now()-interval '2 days', absolute_expires_at=now()-interval '1 day' WHERE id=$1`, [s.session_id]);
    assert.equal((await rotacionar(pool, s.token)).resultado, 'sessao_invalida');
  });

  // ── POLÍTICA DE JANELA: colisão (dentro) vs reuse (fora) ─────────────────────
  test('14. colisão concorrente/retry DENTRO da janela → refresh_already_rotated, NÃO revoga, audita refresh_colisao, sem novo token', async () => {
    const s = await criarSessao(pool);
    const T0 = new Date();
    const ok = await rotacionar(pool, s.token, { agora: T0 });          // rotaciona em T0 (used_at=T0)
    assert.equal(ok.resultado, 'ok');
    const antesTokens = (await tokRows(s.session_id)).length;           // 2 (v1 usado + v2)
    const colisao = await rotacionar(pool, s.token, { agora: seg(T0, 5), grace: 10 }); // reapresenta v1 dentro da janela
    assert.equal(colisao.resultado, 'refresh_already_rotated');
    const sess = await sessRow(s.session_id);
    assert.equal(sess.revoked_at, null, 'colisão NÃO pode revogar a família');
    assert.equal((await tokRows(s.session_id)).length, antesTokens, 'colisão NÃO emite novo token');
    assert.ok((await auditos(s.session_id)).some(a => a.event === 'refresh_colisao' && a.request_id === 'req-teste'));
  });

  test('15. reuse FORA da janela → reuse_detected, revoga família+sessão, audita refresh_reuse; OUTRA família intacta', async () => {
    const outra = await criarSessao(pool, { familyId: randomUUID() });
    const s = await criarSessao(pool);
    const T0 = new Date();
    await rotacionar(pool, s.token, { agora: T0 });                     // used_at=T0
    const reuse = await rotacionar(pool, s.token, { agora: seg(T0, 30), grace: 10 }); // 30s > 10s → reuse
    assert.equal(reuse.resultado, 'reuse_detected');
    const sess = await sessRow(s.session_id);
    assert.ok(sess.revoked_at !== null); assert.equal(sess.revoke_reason, 'refresh_reuse_detected');
    for (const t of await tokRows(s.session_id)) assert.ok(t.revoked_at !== null, 'todos tokens da família revogados');
    assert.ok((await auditos(s.session_id)).some(a => a.event === 'refresh_reuse' && a.resultado === 'reuse_detected'));
    assert.equal((await sessRow(outra.session_id)).revoked_at, null, 'outra família intacta');
    // Filho (v2) também inutilizável após revogação da família.
    // (v2 estava não-usado; a revogação da família setou revoked_at nele)
  });

  test('16. limites EXATOS da janela (relógio controlado): <=grace → colisão; >grace → reuse', async () => {
    const s = await criarSessao(pool);
    const T0 = new Date();
    await rotacionar(pool, s.token, { agora: T0 });                     // used_at = T0
    // 9s (dentro) → colisão; família intacta
    assert.equal((await rotacionar(pool, s.token, { agora: seg(T0, 9),  grace: 10 })).resultado, 'refresh_already_rotated');
    assert.equal((await sessRow(s.session_id)).revoked_at, null);
    // 10s (limite, <=) → colisão; família intacta
    assert.equal((await rotacionar(pool, s.token, { agora: seg(T0, 10), grace: 10 })).resultado, 'refresh_already_rotated');
    assert.equal((await sessRow(s.session_id)).revoked_at, null);
    // 11s (fora) → reuse; família revogada
    assert.equal((await rotacionar(pool, s.token, { agora: seg(T0, 11), grace: 10 })).resultado, 'reuse_detected');
    assert.ok((await sessRow(s.session_id)).revoked_at !== null);
  });

  // ── CONCORRÊNCIA REAL (2 conexões, mesmo refresh) ───────────────────────────
  test('17. concorrência: 2 conexões, MESMO refresh → 1 vence (ok), outra refresh_already_rotated, família ATIVA, 1 só filho', async () => {
    const s = await criarSessao(pool);
    const cA = await pool.connect(), cB = await pool.connect();
    try {
      const [ra, rb] = await Promise.all([
        rotacionar(cA, s.token, { novo: novoToken(), grace: 30 }),
        rotacionar(cB, s.token, { novo: novoToken(), grace: 30 }),
      ]);
      const res = [ra.resultado, rb.resultado].sort();
      assert.deepEqual(res, ['ok', 'refresh_already_rotated'], `esperado 1 ok + 1 colisão, veio ${JSON.stringify(res)}`);
      assert.equal((await sessRow(s.session_id)).revoked_at, null, 'família deve permanecer ATIVA (colisão não revoga)');
      assert.equal(await ativos(s.session_id), 1, 'exatamente 1 refresh ativo (nunca 2 filhos)');
    } finally { cA.release(); cB.release(); }
  });

  // ── RESPOSTA PERDIDA / RETRY ────────────────────────────────────────────────
  test('18. resposta perdida: retry imediato → refresh_already_rotated, família intacta, sem token aberto no retorno', async () => {
    const s = await criarSessao(pool);
    const T0 = new Date();
    const ok = await rotacionar(pool, s.token, { agora: T0 });           // resposta "perdida"
    assert.equal(ok.resultado, 'ok');
    const retry = await rotacionar(pool, s.token, { agora: seg(T0, 2), grace: 10 });
    assert.equal(retry.resultado, 'refresh_already_rotated');
    assert.equal(retry.novo_token_id, null, 'retry não emite/entrega novo token');
    assert.equal((await sessRow(s.session_id)).revoked_at, null);
  });

  // ── ROLLBACK INTEGRAL ───────────────────────────────────────────────────────
  test('19. rollback: falha na transação → zero estado parcial', async () => {
    const antes = (await pool.query('SELECT count(*)::int c FROM public.auth_sessions')).rows[0].c;
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await criarSessao(c);
      await assert.rejects(() => c.query('SELECT * FROM public.tabela_inexistente_sec1'));
      await c.query('ROLLBACK');
    } finally { c.release(); }
    assert.equal((await pool.query('SELECT count(*)::int c FROM public.auth_sessions')).rows[0].c, antes);
    assert.equal((await pool.query('SELECT count(*)::int c FROM public.auth_refresh_tokens')).rows[0].c, 0);
  });

  // ── LIMPEZA / RETENÇÃO ──────────────────────────────────────────────────────
  test('20. limpeza: remove expiradas antigas; preserva ativa e recém-revogada', async () => {
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
