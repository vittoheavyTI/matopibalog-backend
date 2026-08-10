const test = require('node:test');
const assert = require('node:assert/strict');
const { criarTrackingCredentialService } = require('../services/auth/trackingCredentialService');

// ── Fake supabase em memória (fiel às operações usadas pelo serviço) ─────────────
function criarFakeSupabase(store) {
  function builder(tabela) {
    const st = { tabela, op: 'select', payload: null, eqs: [], isNulls: [], select: false };
    const rowsDaTabela = () => (store[tabela] = store[tabela] || []);
    const casa = (r) =>
      st.eqs.every(([c, v]) => String(r[c]) === String(v)) &&
      st.isNulls.every((c) => r[c] === null || r[c] === undefined);

    function executar() {
      const rows = rowsDaTabela();
      if (st.op === 'insert') {
        const novos = Array.isArray(st.payload) ? st.payload : [st.payload];
        for (const nv of novos) {
          if (nv.credential_hash && rows.some((r) => r.credential_hash === nv.credential_hash)) {
            return { data: null, error: { message: 'duplicate credential_hash' } };
          }
          rows.push({ ...nv });
        }
        return { data: null, error: null };
      }
      if (st.op === 'update') {
        const alvo = rows.filter(casa);
        for (const r of alvo) Object.assign(r, st.payload);
        return { data: st.select ? alvo.map((r) => ({ id: r.id })) : null, error: null };
      }
      // select
      const filtradas = rows.filter(casa);
      return { data: filtradas, error: null };
    }

    const b = {
      select(_cols) { st.select = true; return b; },
      insert(payload) { st.op = 'insert'; st.payload = payload; return b; },
      update(payload) { st.op = 'update'; st.payload = payload; return b; },
      eq(c, v) { st.eqs.push([c, v]); return b; },
      is(c, _v) { st.isNulls.push(c); return b; },
      async maybeSingle() { const r = executar(); return { data: (r.data && r.data[0]) || null, error: r.error }; },
      async single() { const r = executar(); return { data: (r.data && r.data[0]) || null, error: r.error }; },
      then(resolve, reject) {
        try {
          const r = executar();
          // .select('id') no update → resolve com a lista; select puro idem.
          return Promise.resolve(r).then(resolve, reject);
        } catch (e) { return Promise.reject(e).then(resolve, reject); }
      },
    };
    return b;
  }
  return { from: (t) => builder(t) };
}

const PEPPER = 'pepper-servico-teste';
function cfgFake(over = {}) {
  return {
    trackingCredentialTtlSeconds: 3600,
    getPepper: () => PEPPER,
    ...over,
  };
}

function novoStore() {
  return {
    frete_tracking_credenciais: [],
    usuarios: [{ id: 'mot-1', status: 'ativo', empresa_id: 'emp-1' }],
    auth_sessions: [{ id: 'sess-1', revoked_at: null }],
  };
}

function criar(store, agoraRef) {
  const supabase = criarFakeSupabase(store);
  return criarTrackingCredentialService({ supabase, cfg: cfgFake(), agora: () => agoraRef.v });
}

test('emitir grava só o HASH (nunca o token aberto) e devolve delivery redigido', async () => {
  const store = novoStore();
  const agora = { v: Date.parse('2026-08-10T12:00:00Z') };
  const svc = criar(store, agora);

  const { delivery, expiresAt } = await svc.emitir({ empresa_id: 'emp-1', motorista_id: 'mot-1', session_id: 'sess-1', frete_id: 'frete-1' });
  const token = delivery.reveal();
  assert.ok(token.startsWith('mtk1.'));
  const row = store.frete_tracking_credenciais[0];
  assert.ok(row.credential_hash && !row.credential_hash.includes(token));
  assert.ok(!JSON.stringify(store).includes(token), 'o token aberto nunca vai ao "banco"');
  assert.equal(Date.parse(expiresAt), agora.v + 3600 * 1000);
  // Delivery redige o token em JSON/inspect
  assert.ok(!JSON.stringify(delivery).includes(token));
});

test('validar aceita o token emitido e retorna identidade escopada', async () => {
  const store = novoStore();
  const agora = { v: Date.parse('2026-08-10T12:00:00Z') };
  const svc = criar(store, agora);
  const { delivery } = await svc.emitir({ empresa_id: 'emp-1', motorista_id: 'mot-1', session_id: 'sess-1' });

  const id = await svc.validar({ token: delivery.reveal() });
  assert.equal(id.uid, 'mot-1');
  assert.equal(id.empresa_id, 'emp-1');
  assert.equal(id.role, 'motorista');
  assert.equal(id.is_super_admin, false);
});

test('token inexistente/forjado → credential_invalid', async () => {
  const store = novoStore();
  const agora = { v: Date.now() };
  const svc = criar(store, agora);
  await assert.rejects(() => svc.validar({ token: 'mtk1.forjado-invalido' }), (e) => e.code === 'credential_invalid');
  await assert.rejects(() => svc.validar({ token: 'nao-e-tracking' }), (e) => e.code === 'credential_invalid');
});

test('§23 (núcleo): credencial sobrevive à expiração do ACCESS — validar não depende de JWT', async () => {
  const store = novoStore();
  const agora = { v: Date.parse('2026-08-10T12:00:00Z') };
  const svc = criar(store, agora);
  const { delivery } = await svc.emitir({ empresa_id: 'emp-1', motorista_id: 'mot-1', session_id: 'sess-1' });
  const token = delivery.reveal();

  // Ponto #1 (t0) ok
  assert.ok((await svc.validar({ token })).uid === 'mot-1');
  // Avança 30min (muito além do access TTL de UI, ~10min) — SEM renovar nada
  agora.v += 30 * 60 * 1000;
  // Ponto #2 ainda ok (a credencial de tracking é independente do access)
  assert.ok((await svc.validar({ token })).uid === 'mot-1');
});

test('logout/admin revoga a sessão → credencial rejeitada (credential_revoked)', async () => {
  const store = novoStore();
  const agora = { v: Date.now() };
  const svc = criar(store, agora);
  const { delivery } = await svc.emitir({ empresa_id: 'emp-1', motorista_id: 'mot-1', session_id: 'sess-1' });
  store.auth_sessions[0].revoked_at = new Date(agora.v).toISOString();
  await assert.rejects(() => svc.validar({ token: delivery.reveal() }), (e) => e.code === 'credential_revoked');
});

test('motorista bloqueado (status) → driver_blocked', async () => {
  const store = novoStore();
  const agora = { v: Date.now() };
  const svc = criar(store, agora);
  const { delivery } = await svc.emitir({ empresa_id: 'emp-1', motorista_id: 'mot-1', session_id: 'sess-1' });
  store.usuarios[0].status = 'bloqueado';
  await assert.rejects(() => svc.validar({ token: delivery.reveal() }), (e) => e.code === 'driver_blocked');
});

test('revogarDoMotorista revoga → próximo uso rejeitado', async () => {
  const store = novoStore();
  const agora = { v: Date.now() };
  const svc = criar(store, agora);
  const { delivery } = await svc.emitir({ empresa_id: 'emp-1', motorista_id: 'mot-1', session_id: 'sess-1' });
  const token = delivery.reveal();
  assert.ok((await svc.validar({ token })).uid);
  const r = await svc.revogarDoMotorista('mot-1', 'logout');
  assert.equal(r.revogadas, 1);
  await assert.rejects(() => svc.validar({ token }), (e) => e.code === 'credential_revoked');
});

test('renovar estende expires_at (mesmo token) e não revive credencial revogada', async () => {
  const store = novoStore();
  const agora = { v: Date.parse('2026-08-10T12:00:00Z') };
  const svc = criar(store, agora);
  const { delivery, expiresAt } = await svc.emitir({ empresa_id: 'emp-1', motorista_id: 'mot-1', session_id: 'sess-1' });
  const token = delivery.reveal();

  agora.v += 30 * 60 * 1000;
  const { expiresAt: novo } = await svc.renovar({ token });
  assert.ok(Date.parse(novo) > Date.parse(expiresAt));
  assert.equal(Date.parse(novo), agora.v + 3600 * 1000);
  // mesmo token continua válido após renovar
  assert.ok((await svc.validar({ token })).uid);

  // revogada → renovar falha
  await svc.revogarDoMotorista('mot-1', 'logout');
  await assert.rejects(() => svc.renovar({ token }), (e) => e.code === 'credential_revoked');
});

test('last_used_at é throttled (não escreve a cada ponto)', async () => {
  const store = novoStore();
  const agora = { v: Date.parse('2026-08-10T12:00:00Z') };
  const svc = criar(store, agora);
  const { delivery } = await svc.emitir({ empresa_id: 'emp-1', motorista_id: 'mot-1', session_id: 'sess-1' });
  const token = delivery.reveal();

  await svc.validar({ token });
  const t1 = store.frete_tracking_credenciais[0].last_used_at;
  assert.ok(t1); // primeiro uso grava
  // +10s (< throttle 60s): não atualiza
  agora.v += 10 * 1000;
  await svc.validar({ token });
  assert.equal(store.frete_tracking_credenciais[0].last_used_at, t1);
  // +60s: atualiza
  agora.v += 60 * 1000;
  await svc.validar({ token });
  assert.notEqual(store.frete_tracking_credenciais[0].last_used_at, t1);
});

test('unicidade de hash: dois emitir geram credenciais distintas (sem colisão)', async () => {
  const store = novoStore();
  const agora = { v: Date.now() };
  const svc = criar(store, agora);
  const a = await svc.emitir({ empresa_id: 'emp-1', motorista_id: 'mot-1' });
  const b = await svc.emitir({ empresa_id: 'emp-1', motorista_id: 'mot-1' });
  assert.notEqual(a.delivery.reveal(), b.delivery.reveal());
  assert.equal(store.frete_tracking_credenciais.length, 2);
});
