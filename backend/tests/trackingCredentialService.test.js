const test = require('node:test');
const assert = require('node:assert/strict');
const { criarTrackingCredentialService } = require('../services/auth/trackingCredentialService');

// ── Fake supabase em memória (fiel às operações do serviço, incl. CAS de rotação) ──
function criarFakeSupabase(store) {
  function builder(tabela) {
    const st = { tabela, op: 'select', payload: null, eqs: [], isNulls: [], gtes: [], select: false };
    const rows = () => (store[tabela] = store[tabela] || []);
    const casa = (r) =>
      st.eqs.every(([c, v]) => String(r[c]) === String(v)) &&
      st.isNulls.every((c) => r[c] === null || r[c] === undefined) &&
      st.gtes.every(([c, v]) => new Date(r[c]).getTime() >= new Date(v).getTime());

    function exec() {
      const t = rows();
      if (st.op === 'insert') {
        const novos = Array.isArray(st.payload) ? st.payload : [st.payload];
        for (const nv of novos) {
          if (nv.credential_hash && t.some((r) => r.credential_hash === nv.credential_hash)) {
            return { data: null, error: { message: 'duplicate credential_hash' } };
          }
          t.push({ ...nv });
        }
        return { data: null, error: null };
      }
      if (st.op === 'update') {
        const alvo = t.filter(casa);
        for (const r of alvo) Object.assign(r, st.payload);
        return { data: st.select ? alvo.map((r) => ({ id: r.id })) : null, error: null };
      }
      return { data: t.filter(casa), error: null };
    }

    const b = {
      select() { st.select = true; return b; },
      insert(p) { st.op = 'insert'; st.payload = p; return b; },
      update(p) { st.op = 'update'; st.payload = p; return b; },
      eq(c, v) { st.eqs.push([c, v]); return b; },
      is(c) { st.isNulls.push(c); return b; },
      gte(c, v) { st.gtes.push([c, v]); return b; },
      async maybeSingle() { const r = exec(); return { data: (r.data && r.data[0]) || null, error: r.error }; },
      async single() { const r = exec(); return { data: (r.data && r.data[0]) || null, error: r.error }; },
      then(res, rej) { try { return Promise.resolve(exec()).then(res, rej); } catch (e) { return Promise.reject(e).then(res, rej); } },
    };
    return b;
  }
  return { from: (t) => builder(t) };
}

const PEPPER = 'pepper-servico-teste';
const DEV = 'device-1';
function cfgFake(o = {}) {
  return { trackingCredentialTtlSeconds: 3600, trackingCredentialMaxLifetimeSeconds: 7 * 86400, getPepper: () => PEPPER, ...o };
}
function novoStore() {
  return {
    frete_tracking_credenciais: [],
    usuarios: [{ id: 'mot-1', status: 'ativo', empresa_id: 'emp-1' }],
    auth_sessions: [{ id: 'sess-1', revoked_at: null }],
    fretes: [{ id: 'frete-1', status: 'em_viagem', empresa_id: 'emp-1', motorista_id: 'mot-1' }],
  };
}
function criar(store, agoraRef) {
  return criarTrackingCredentialService({ supabase: criarFakeSupabase(store), cfg: cfgFake(), agora: () => agoraRef.v });
}
const emitirPadrao = (svc) => svc.emitir({ empresa_id: 'emp-1', motorista_id: 'mot-1', session_id: 'sess-1', frete_id: 'frete-1', device_id: DEV });

test('emitir exige sid, frete e device (binding canônico)', async () => {
  const store = novoStore(); const agora = { v: Date.now() }; const svc = criar(store, agora);
  await assert.rejects(() => svc.emitir({ empresa_id: 'emp-1', motorista_id: 'mot-1', frete_id: 'frete-1', device_id: DEV }), (e) => e.code === 'tracking_session_revoked');
  await assert.rejects(() => svc.emitir({ empresa_id: 'emp-1', motorista_id: 'mot-1', session_id: 'sess-1', device_id: DEV }), (e) => e.code === 'tracking_trip_mismatch');
  await assert.rejects(() => svc.emitir({ empresa_id: 'emp-1', motorista_id: 'mot-1', session_id: 'sess-1', frete_id: 'frete-1' }), (e) => e.code === 'tracking_device_mismatch');
});

test('emitir grava só o HASH + max_expires_at; delivery redige o token', async () => {
  const store = novoStore(); const agora = { v: Date.parse('2026-08-10T12:00:00Z') }; const svc = criar(store, agora);
  const { delivery, expiresAt, maxExpiresAt } = await emitirPadrao(svc);
  const token = delivery.reveal();
  assert.ok(token.startsWith('mtk1.'));
  const row = store.frete_tracking_credenciais[0];
  assert.ok(row.credential_hash && !row.credential_hash.includes(token));
  assert.ok(!JSON.stringify(store).includes(token));
  assert.equal(Date.parse(expiresAt), agora.v + 3600 * 1000);
  assert.equal(Date.parse(maxExpiresAt), agora.v + 7 * 86400 * 1000);
  assert.ok(!JSON.stringify(delivery).includes(token));
});

test('validar exige device correto e retorna frete_id vinculado', async () => {
  const store = novoStore(); const agora = { v: Date.now() }; const svc = criar(store, agora);
  const { delivery } = await emitirPadrao(svc);
  const id = await svc.validar({ token: delivery.reveal(), deviceId: DEV });
  assert.equal(id.uid, 'mot-1'); assert.equal(id.frete_id, 'frete-1');
  await assert.rejects(() => svc.validar({ token: delivery.reveal(), deviceId: 'outro' }), (e) => e.code === 'tracking_device_mismatch');
});

test('§23: credencial sobrevive à expiração do ACCESS (independe de JWT)', async () => {
  const store = novoStore(); const agora = { v: Date.parse('2026-08-10T12:00:00Z') }; const svc = criar(store, agora);
  const { delivery } = await emitirPadrao(svc); const token = delivery.reveal();
  assert.ok((await svc.validar({ token, deviceId: DEV })).uid);
  agora.v += 30 * 60 * 1000; // além do access TTL de UI
  assert.ok((await svc.validar({ token, deviceId: DEV })).uid);
});

test('viagem finalizada → validar rejeita canonicamente (trip_inactive), sem depender de hook', async () => {
  const store = novoStore(); const agora = { v: Date.now() }; const svc = criar(store, agora);
  const { delivery } = await emitirPadrao(svc);
  store.fretes[0].status = 'finalizado';
  await assert.rejects(() => svc.validar({ token: delivery.reveal(), deviceId: DEV }), (e) => e.code === 'tracking_trip_inactive');
});

test('sessão revogada (logout/admin) → tracking rejeitado', async () => {
  const store = novoStore(); const agora = { v: Date.now() }; const svc = criar(store, agora);
  const { delivery } = await emitirPadrao(svc);
  store.auth_sessions[0].revoked_at = new Date(agora.v).toISOString();
  await assert.rejects(() => svc.validar({ token: delivery.reveal(), deviceId: DEV }), (e) => e.code === 'tracking_session_revoked');
});

test('motorista bloqueado → driver_blocked', async () => {
  const store = novoStore(); const agora = { v: Date.now() }; const svc = criar(store, agora);
  const { delivery } = await emitirPadrao(svc);
  store.usuarios[0].status = 'bloqueado';
  await assert.rejects(() => svc.validar({ token: delivery.reveal(), deviceId: DEV }), (e) => e.code === 'tracking_driver_blocked');
});

test('renovar ROTACIONA o segredo: token antigo morre, novo vale; telemetria expirada não passa mas renova', async () => {
  const store = novoStore(); const agora = { v: Date.parse('2026-08-10T12:00:00Z') }; const svc = criar(store, agora);
  const { delivery } = await emitirPadrao(svc); const tokenA = delivery.reveal();

  agora.v += 2 * 3600 * 1000; // A expirou (TTL 1h), mas dentro do teto (7d)
  await assert.rejects(() => svc.validar({ token: tokenA, deviceId: DEV }), (e) => e.code === 'tracking_credential_expired');
  const { delivery: novo, expiresAt } = await svc.renovar({ token: tokenA, deviceId: DEV });
  const tokenB = novo.reveal();
  assert.notEqual(tokenA, tokenB);
  assert.equal(Date.parse(expiresAt), agora.v + 3600 * 1000);
  // A morreu (hash rotacionado); B vale
  await assert.rejects(() => svc.validar({ token: tokenA, deviceId: DEV }), (e) => e.code === 'tracking_credential_invalid');
  assert.ok((await svc.validar({ token: tokenB, deviceId: DEV })).uid);
});

test('renovar NÃO ultrapassa o teto absoluto; após o teto → max_lifetime', async () => {
  const store = novoStore(); const agora = { v: Date.parse('2026-08-10T12:00:00Z') };
  const svc = criarTrackingCredentialService({ supabase: criarFakeSupabase(store), cfg: cfgFake({ trackingCredentialMaxLifetimeSeconds: 2 * 3600 }), agora: () => agora.v });
  const { delivery, maxExpiresAt } = await emitirPadrao(svc); let token = delivery.reveal();
  agora.v += 90 * 60 * 1000; // 1h30 → expirou nominal, dentro do teto 2h
  const r1 = await svc.renovar({ token, deviceId: DEV });
  // novo expires limitado ao teto (2h do issued)
  assert.ok(Date.parse(r1.expiresAt) <= Date.parse(maxExpiresAt));
  token = r1.delivery.reveal();
  agora.v += 60 * 60 * 1000; // agora além do teto (2h30 do issued)
  await assert.rejects(() => svc.renovar({ token, deviceId: DEV }), (e) => e.code === 'tracking_credential_max_lifetime');
});

test('renovar com device errado → device_mismatch (não rotaciona)', async () => {
  const store = novoStore(); const agora = { v: Date.now() }; const svc = criar(store, agora);
  const { delivery } = await emitirPadrao(svc);
  await assert.rejects(() => svc.renovar({ token: delivery.reveal(), deviceId: 'outro' }), (e) => e.code === 'tracking_device_mismatch');
});

test('frete vinculado sumiu (CASCADE não pegou / corrida) → trip_mismatch', async () => {
  const store = novoStore(); const agora = { v: Date.now() }; const svc = criar(store, agora);
  const { delivery } = await emitirPadrao(svc);
  store.fretes = []; // frete não existe mais
  await assert.rejects(() => svc.validar({ token: delivery.reveal(), deviceId: DEV }), (e) => e.code === 'tracking_trip_mismatch');
});

test('frete vinculado passou a ser de outro motorista → tenant_mismatch', async () => {
  const store = novoStore(); const agora = { v: Date.now() }; const svc = criar(store, agora);
  const { delivery } = await emitirPadrao(svc);
  store.fretes[0].motorista_id = 'outro-mot';
  await assert.rejects(() => svc.validar({ token: delivery.reveal(), deviceId: DEV }), (e) => e.code === 'tracking_tenant_mismatch');
});

test('revogarDoFrete/DaSessao/DoMotorista revogam → uso rejeitado', async () => {
  for (const [fn, arg] of [['revogarDoFrete', 'frete-1'], ['revogarDaSessao', 'sess-1'], ['revogarDoMotorista', 'mot-1']]) {
    const store = novoStore(); const agora = { v: Date.now() }; const svc = criar(store, agora);
    const { delivery } = await emitirPadrao(svc); const token = delivery.reveal();
    assert.ok((await svc.validar({ token, deviceId: DEV })).uid);
    const r = await svc[fn](arg, 'motivo');
    assert.equal(r.revogadas, 1);
    await assert.rejects(() => svc.validar({ token, deviceId: DEV }), (e) => e.code === 'tracking_credential_revoked', `${fn}`);
  }
});
