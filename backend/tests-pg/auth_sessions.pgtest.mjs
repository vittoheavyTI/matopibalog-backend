// Testes REAIS (PostgreSQL isolado, múltiplas conexões) do modelo de sessões
// revogáveis — migration 062 (SEC-1).
//
// Executado no CI contra um Postgres efêmero (service container), NUNCA contra
// produção. Requer env DATABASE_URL. Fixtures 100% sintéticas. O pepper e os
// tokens usados aqui são SINTÉTICOS de teste — nunca segredos reais.
//
//   node --test backend/tests-pg/auth_sessions.pgtest.mjs
//
// Cobre (complemento vinculante, item 7): schema/tipos/constraints/índices/RLS/
// FORCE RLS/grants; criar sessão (FKs, client_type, idle>absoluto); refresh
// (emitir, só hash, rotacionar, marcar usado, substituir, atualizar sessão,
// expirado/revogado/inexistente); CONCORRÊNCIA real (2 conexões, mesmo refresh →
// 1 vence); REUSE (família revogada, nenhuma outra família afetada); ROLLBACK
// integral (sem failpoint na função de produção); LIMPEZA (retenção, ativas
// preservadas).

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

  // Pepper SINTÉTICO de teste (nunca um segredo real). Prova o modelo: o banco
  // guarda apenas HMAC-SHA256(pepper || token), nunca o token aberto.
  const TEST_PEPPER = 'pepper-sintetico-de-teste-SEC1-nao-usar-em-producao';
  const hash = (token) => createHmac('sha256', TEST_PEPPER).update(token).digest('hex');
  const novoToken = () => `rt_${randomUUID()}${randomUUID()}`; // alta entropia sintética

  const U1 = randomUUID();   // usuário sintético (FK usuarios.id)
  const E1 = randomUUID();   // empresa sintética (FK empresas.id)

  const dias = (n) => new Date(Date.now() + n * 86400000);
  const min  = (n) => new Date(Date.now() + n * 60000);

  // Cria uma sessão + 1º refresh token. Retorna { sessionId, familyId, tokenId, token }.
  async function criarSessao(client, {
    usuario = U1, empresa = E1, clientType = 'web', deviceId = null, deviceLabel = null,
    familyId = randomUUID(), token = novoToken(),
    refreshExp = dias(30), idle = min(30), abs = dias(30),
    ip = 'ip_hash_sintetico', ua = 'ua-teste', createdBy = null,
  } = {}) {
    const r = await client.query(
      `SELECT * FROM public.criar_sessao_auth($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [usuario, empresa, clientType, deviceId, deviceLabel, familyId, hash(token), refreshExp, idle, abs, ip, ua, createdBy]
    );
    return { ...r.rows[0], token, familyId };
  }

  async function rotacionar(client, apresentadoToken, {
    novo = novoToken(), novoExp = dias(30), novoIdle = min(30), agora = null,
  } = {}) {
    const r = await client.query(
      `SELECT * FROM public.rotacionar_refresh_token($1,$2,$3,$4, COALESCE($5, now()))`,
      [hash(apresentadoToken), hash(novo), novoExp, novoIdle, agora]
    );
    return { ...r.rows[0], novoToken: novo };
  }

  const sessRow = async (id) => (await pool.query('SELECT * FROM public.auth_sessions WHERE id=$1', [id])).rows[0];
  const tokRows = async (sid) => (await pool.query('SELECT * FROM public.auth_refresh_tokens WHERE session_id=$1 ORDER BY version', [sid])).rows;

  before(async () => {
    await pool.query('INSERT INTO public.usuarios(id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [U1]);
    await pool.query('INSERT INTO public.empresas(id,nome) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING', [E1, 'Empresa Teste SEC1']);
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM public.auth_sessions'); // cascade limpa auth_refresh_tokens
  });

  after(async () => { await pool.end(); });

  // ── SCHEMA / RLS / GRANTS ───────────────────────────────────────────────────
  test('1. tabelas existem com RLS habilitado E forçado', async () => {
    const r = await pool.query(
      `SELECT relname, relrowsecurity, relforcerowsecurity
         FROM pg_class WHERE relname IN ('auth_sessions','auth_refresh_tokens') AND relnamespace='public'::regnamespace
         ORDER BY relname`);
    assert.equal(r.rows.length, 2);
    for (const row of r.rows) {
      assert.equal(row.relrowsecurity, true, `${row.relname} deve ter RLS habilitado`);
      assert.equal(row.relforcerowsecurity, true, `${row.relname} deve ter FORCE RLS`);
    }
  });

  test('2. índices esperados presentes', async () => {
    const r = await pool.query(`SELECT indexname FROM pg_indexes WHERE tablename IN ('auth_sessions','auth_refresh_tokens')`);
    const nomes = r.rows.map(x => x.indexname);
    for (const idx of ['idx_auth_sessions_usuario','idx_auth_sessions_ativas','idx_auth_sessions_absolute_exp','idx_auth_refresh_session','idx_auth_refresh_family','auth_refresh_tokens_hash_uniq']) {
      assert.ok(nomes.includes(idx), `índice ausente: ${idx}`);
    }
  });

  test('3. grants: anon/authenticated NEGADOS (42501); service_role permitido', async () => {
    const c = await pool.connect();
    try {
      for (const role of ['anon', 'authenticated']) {
        await c.query('BEGIN');
        await c.query(`SET LOCAL ROLE ${role}`);
        await assert.rejects(() => c.query('SELECT 1 FROM public.auth_sessions LIMIT 1'), (e) => e.code === '42501', `${role} deveria ser negado em auth_sessions`);
        await c.query('ROLLBACK');
        // EXECUTE da RPC também negado
        await c.query('BEGIN');
        await c.query(`SET LOCAL ROLE ${role}`);
        await assert.rejects(() => c.query('SELECT public.limpar_sessoes_expiradas(90)'), (e) => e.code === '42501', `${role} deveria ser negado no EXECUTE`);
        await c.query('ROLLBACK');
      }
      // service_role: tem privilégio (BYPASSRLS no bootstrap de teste) → não lança.
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE service_role');
      await c.query('SELECT 1 FROM public.auth_sessions LIMIT 1');
      await c.query('SELECT public.limpar_sessoes_expiradas(90)');
      await c.query('ROLLBACK');
    } finally { c.release(); }
  });

  // ── CRIAÇÃO DE SESSÃO ───────────────────────────────────────────────────────
  test('4. criar sessão → 1ª versão, guarda SÓ hash (nunca o token aberto)', async () => {
    const s = await criarSessao(pool);
    assert.ok(s.session_id);
    assert.equal(s.refresh_family_id, s.familyId);
    const toks = await tokRows(s.session_id);
    assert.equal(toks.length, 1);
    assert.equal(toks[0].version, 1);
    assert.equal(toks[0].used_at, null);
    // Prova: o token aberto NÃO está no banco; só o hash.
    assert.notEqual(toks[0].token_hash, s.token);
    assert.equal(toks[0].token_hash, hash(s.token));
    const anyPlain = await pool.query(
      `SELECT count(*)::int c FROM public.auth_refresh_tokens WHERE token_hash = $1`, [s.token]);
    assert.equal(anyPlain.rows[0].c, 0, 'token aberto não pode aparecer como valor no banco');
  });

  test('5. criar sessão: usuário inexistente → FK violation (23503)', async () => {
    await assert.rejects(() => criarSessao(pool, { usuario: randomUUID() }), (e) => e.code === '23503');
  });

  test('6. criar sessão: empresa inexistente → FK violation (23503)', async () => {
    await assert.rejects(() => criarSessao(pool, { empresa: randomUUID() }), (e) => e.code === '23503');
  });

  test('7. criar sessão: client_type inválido → P0001', async () => {
    await assert.rejects(() => criarSessao(pool, { clientType: 'desktop' }), (e) => e.code === 'P0001' || e.code === '23514');
  });

  test('8. criar sessão: idle posterior ao absoluto → CHECK violation (23514)', async () => {
    await assert.rejects(() => criarSessao(pool, { idle: dias(40), abs: dias(30) }), (e) => e.code === '23514');
  });

  // ── REFRESH: ROTAÇÃO ────────────────────────────────────────────────────────
  test('9. rotação válida → ok, v2, antigo marcado usado+replaced_by, sessão atualizada', async () => {
    const s = await criarSessao(pool, { idle: min(10) });
    const antesAtividade = (await sessRow(s.session_id)).last_activity_at;
    await new Promise(r => setTimeout(r, 20));
    const rot = await rotacionar(pool, s.token, { novoIdle: min(45) });
    assert.equal(rot.resultado, 'ok');
    assert.equal(rot.nova_version, 2);
    assert.equal(rot.usuario_id, U1);
    assert.equal(rot.empresa_id, E1);
    assert.equal(rot.client_type, 'web');

    const toks = await tokRows(s.session_id);
    assert.equal(toks.length, 2);
    const v1 = toks.find(t => t.version === 1), v2 = toks.find(t => t.version === 2);
    assert.ok(v1.used_at !== null, 'v1 deve ficar usado');
    assert.equal(v1.replaced_by, v2.id);
    assert.equal(v2.used_at, null);
    assert.equal(v2.token_hash, hash(rot.novoToken));

    const sess = await sessRow(s.session_id);
    assert.ok(new Date(sess.last_activity_at) > new Date(antesAtividade), 'atividade deve avançar');
    // idle deslizou (mas nunca além do absoluto).
    assert.ok(new Date(sess.idle_expires_at) <= new Date(sess.absolute_expires_at));
  });

  test('10. rotação: hash inexistente → invalido', async () => {
    const rot = await rotacionar(pool, novoToken());
    assert.equal(rot.resultado, 'invalido');
  });

  test('11. rotação: refresh expirado → expirado', async () => {
    const s = await criarSessao(pool, { refreshExp: min(-5) }); // token já expirado; sessão válida
    const rot = await rotacionar(pool, s.token);
    assert.equal(rot.resultado, 'expirado');
  });

  test('12. rotação: sessão revogada → sessao_invalida', async () => {
    const s = await criarSessao(pool);
    await pool.query('UPDATE public.auth_sessions SET revoked_at=now(), revoke_reason=$2 WHERE id=$1', [s.session_id, 'teste']);
    const rot = await rotacionar(pool, s.token);
    assert.equal(rot.resultado, 'sessao_invalida');
  });

  test('13. rotação: sessão com absoluta expirada → sessao_invalida', async () => {
    const s = await criarSessao(pool);
    // Move a janela toda para o passado respeitando os CHECKs (created<=absolute, idle<=absolute).
    await pool.query(
      `UPDATE public.auth_sessions SET created_at=now()-interval '3 days', idle_expires_at=now()-interval '2 days', absolute_expires_at=now()-interval '1 day' WHERE id=$1`,
      [s.session_id]);
    const rot = await rotacionar(pool, s.token);
    assert.equal(rot.resultado, 'sessao_invalida');
  });

  // ── REUSE DETECTION ─────────────────────────────────────────────────────────
  test('14. reuse: reapresentar token JÁ usado → reuse_detected + família revogada; outra família intacta', async () => {
    const outra = await criarSessao(pool, { familyId: randomUUID() }); // família independente
    const s = await criarSessao(pool);
    const rot1 = await rotacionar(pool, s.token);
    assert.equal(rot1.resultado, 'ok');
    // Reapresenta o token v1 (já usado) → ataque de reutilização.
    const rot2 = await rotacionar(pool, s.token);
    assert.equal(rot2.resultado, 'reuse_detected');

    const sess = await sessRow(s.session_id);
    assert.ok(sess.revoked_at !== null, 'sessão da família deve ser revogada');
    assert.equal(sess.revoke_reason, 'refresh_reuse_detected');
    const toks = await tokRows(s.session_id);
    for (const t of toks) assert.ok(t.revoked_at !== null, 'todos os tokens da família revogados');

    // Nenhuma outra família afetada.
    const sessOutra = await sessRow(outra.session_id);
    assert.equal(sessOutra.revoked_at, null, 'outra família NÃO pode ser afetada');
  });

  // ── CONCORRÊNCIA REAL (2 conexões, mesmo refresh) ───────────────────────────
  test('15. concorrência: 2 conexões usam o MESMO refresh → exatamente 1 vence', async () => {
    const s = await criarSessao(pool);
    const cA = await pool.connect(), cB = await pool.connect();
    try {
      const [ra, rb] = await Promise.all([
        rotacionar(cA, s.token, { novo: novoToken() }),
        rotacionar(cB, s.token, { novo: novoToken() }),
      ]);
      const resultados = [ra.resultado, rb.resultado].sort();
      const oks = resultados.filter(x => x === 'ok').length;
      assert.equal(oks, 1, `exatamente 1 rotação deve vencer, veio: ${JSON.stringify(resultados)}`);
      // A perdedora é classificada (reuse_detected pela política estrita — a 2ª vê o token já usado).
      assert.ok(resultados.includes('reuse_detected') || resultados.includes('sessao_invalida'),
        `perdedora deve ser classificada, veio: ${JSON.stringify(resultados)}`);
      // Nenhuma duplicidade: no máximo 1 token NÃO-usado e NÃO-revogado.
      const ativos = await pool.query(
        'SELECT count(*)::int c FROM public.auth_refresh_tokens WHERE session_id=$1 AND used_at IS NULL AND revoked_at IS NULL', [s.session_id]);
      assert.ok(ativos.rows[0].c <= 1, 'nunca pode haver 2 refresh tokens ativos simultâneos');
    } finally { cA.release(); cB.release(); }
  });

  // ── ROLLBACK INTEGRAL (sem failpoint na função de produção) ──────────────────
  test('16. rollback: falha na transação → zero estado parcial', async () => {
    const antes = (await pool.query('SELECT count(*)::int c FROM public.auth_sessions')).rows[0].c;
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await criarSessao(c); // cria sessão + token DENTRO da tx
      // Provoca erro no MESMO tx (sem failpoint na função de produção): statement inválido.
      await assert.rejects(() => c.query('SELECT * FROM public.tabela_que_nao_existe_sec1'));
      await c.query('ROLLBACK');
    } finally { c.release(); }
    const depois = (await pool.query('SELECT count(*)::int c FROM public.auth_sessions')).rows[0].c;
    assert.equal(depois, antes, 'ROLLBACK deve descartar a sessão criada na tx');
    const orfaos = (await pool.query('SELECT count(*)::int c FROM public.auth_refresh_tokens')).rows[0].c;
    assert.equal(orfaos, 0, 'nenhum refresh token órfão após rollback');
  });

  // ── LIMPEZA / RETENÇÃO ──────────────────────────────────────────────────────
  test('17. limpeza: remove expiradas/revogadas antigas; preserva ativas e recém-revogadas', async () => {
    // Ativa (não deve sair).
    const ativa = await criarSessao(pool, { familyId: randomUUID() });
    // Expirada há muito (deve sair): move a janela p/ >90 dias atrás.
    const velha = await criarSessao(pool, { familyId: randomUUID() });
    await pool.query(
      `UPDATE public.auth_sessions SET created_at=now()-interval '200 days', idle_expires_at=now()-interval '190 days', absolute_expires_at=now()-interval '180 days' WHERE id=$1`,
      [velha.session_id]);
    // Revogada recentemente (NÃO deve sair — dentro da retenção).
    const recemRevogada = await criarSessao(pool, { familyId: randomUUID() });
    await pool.query('UPDATE public.auth_sessions SET revoked_at=now() WHERE id=$1', [recemRevogada.session_id]);

    const removidas = (await pool.query('SELECT public.limpar_sessoes_expiradas(90) AS n')).rows[0].n;
    assert.ok(removidas >= 1, 'deve remover ao menos a sessão expirada antiga');
    assert.ok(await sessRow(ativa.session_id), 'sessão ativa preservada');
    assert.equal(await sessRow(velha.session_id), undefined, 'sessão expirada antiga removida');
    assert.ok(await sessRow(recemRevogada.session_id), 'sessão revogada recente preservada (retenção)');
  });
}
