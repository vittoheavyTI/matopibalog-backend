const test = require('node:test');
const assert = require('node:assert/strict');
const { criarTrackingCredentialService } = require('../services/auth/trackingCredentialService');

// ── Fake supabase em memória (insert→id, in/limit, join de escopo, CAS) ──
function criarFakeSupabase(store) {
  let seq = 0;
  function builder(tabela) {
    const st = { tabela, op: 'select', payload: null, eqs: [], isNulls: [], gtes: [], lts: [], ins: [], limit: null, select: false };
    const rows = () => (store[tabela] = store[tabela] || []);
    const casa = (r) =>
      st.eqs.every(([c, v]) => String(r[c]) === String(v)) &&
      st.isNulls.every((c) => r[c] === null || r[c] === undefined) &&
      st.gtes.every(([c, v]) => new Date(r[c]).getTime() >= new Date(v).getTime()) &&
      st.lts.every(([c, v]) => new Date(r[c]).getTime() < new Date(v).getTime()) &&
      st.ins.every(([c, arr]) => arr.map(String).includes(String(r[c])));

    function exec() {
      const t = rows();
      if (st.op === 'insert') {
        const novos = Array.isArray(st.payload) ? st.payload : [st.payload];
        const inseridos = [];
        for (const nv of novos) {
          if (nv.credential_hash && t.some((r) => r.credential_hash === nv.credential_hash)) {
            return { data: null, error: { message: 'duplicate credential_hash' } };
          }
          const row = { id: nv.id || `${tabela}-${++seq}`, ...nv };
          t.push(row); inseridos.push(row);
        }
        return { data: st.select ? inseridos.map((r) => ({ id: r.id })) : null, error: null };
      }
      if (st.op === 'update') {
        const alvo = t.filter(casa);
        for (const r of alvo) Object.assign(r, st.payload);
        return { data: st.select ? alvo.map((r) => ({ id: r.id })) : null, error: null };
      }
      let out = t.filter(casa);
      if (st.limit != null) out = out.slice(0, st.limit);
      return { data: out, error: null };
    }

    const b = {
      select() { st.select = true; return b; },
      insert(p) { st.op = 'insert'; st.payload = p; return b; },
      update(p) { st.op = 'update'; st.payload = p; return b; },
      eq(c, v) { st.eqs.push([c, v]); return b; },
      is(c) { st.isNulls.push(c); return b; },
      gte(c, v) { st.gtes.push([c, v]); return b; },
      lt(c, v) { st.lts.push([c, v]); return b; },
      in(c, arr) { st.ins.push([c, arr]); return b; },
      limit(n) { st.limit = n; return b; },
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
const cfgFake = (o = {}) => ({ trackingCredentialTtlSeconds: 3600, trackingCredentialMaxLifetimeSeconds: 7 * 86400, getPepper: () => PEPPER, ...o });
function novoStore(extraFretes = []) {
  return {
    frete_tracking_credenciais: [],
    frete_tracking_credencial_fretes: [],
    usuarios: [{ id: 'mot-1', status: 'ativo', empresa_id: 'emp-1' }],
    auth_sessions: [{ id: 'sess-1', revoked_at: null }],
    fretes: [
      { id: 'frete-A', status: 'em_viagem', empresa_id: 'emp-1', motorista_id: 'mot-1' },
      { id: 'frete-B', status: 'ativo', empresa_id: 'emp-1', motorista_id: 'mot-1' },
      ...extraFretes,
    ],
  };
}
const criar = (store, agoraRef, cfg = cfgFake()) => criarTrackingCredentialService({ supabase: criarFakeSupabase(store), cfg, agora: () => agoraRef.v });
const emitirPadrao = (svc) => svc.emitir({ empresa_id: 'emp-1', motorista_id: 'mot-1', session_id: 'sess-1', device_id: DEV });
const idsAutorizados = (r) => (r.fretesAutorizados || []).map((f) => f.id).sort();

test('emitir exige sid e device; snapshot do escopo = viagens ativas (A,B)', async () => {
  const store = novoStore(); const agora = { v: Date.now() }; const svc = criar(store, agora);
  await assert.rejects(() => svc.emitir({ empresa_id: 'emp-1', motorista_id: 'mot-1', device_id: DEV }), (e) => e.code === 'tracking_session_revoked');
  await assert.rejects(() => svc.emitir({ empresa_id: 'emp-1', motorista_id: 'mot-1', session_id: 'sess-1' }), (e) => e.code === 'tracking_device_mismatch');
  const { delivery, fretes_escopo } = await emitirPadrao(svc);
  assert.ok(delivery.reveal().startsWith('mtk1.'));
  assert.deepEqual(fretes_escopo.sort(), ['frete-A', 'frete-B']);
  // vínculo persistido
  assert.equal(store.frete_tracking_credencial_fretes.length, 2);
});

test('emitir sem viagem ativa → trip_inactive (não emite)', async () => {
  const store = novoStore(); store.fretes.forEach((f) => (f.status = 'finalizado'));
  const agora = { v: Date.now() }; const svc = criar(store, agora);
  await assert.rejects(() => emitirPadrao(svc), (e) => e.code === 'tracking_trip_inactive');
  assert.equal(store.frete_tracking_credenciais.length, 0);
});

test('fan-out = interseção do escopo; A encerra → só B', async () => {
  const store = novoStore(); const agora = { v: Date.now() }; const svc = criar(store, agora);
  const { delivery } = await emitirPadrao(svc); const token = delivery.reveal();
  assert.deepEqual(idsAutorizados(await svc.validar({ token, deviceId: DEV })), ['frete-A', 'frete-B']);
  store.fretes.find((f) => f.id === 'frete-A').status = 'finalizado';
  assert.deepEqual(idsAutorizados(await svc.validar({ token, deviceId: DEV })), ['frete-B']);
});

test('A+B encerram → trip_inactive', async () => {
  const store = novoStore(); const agora = { v: Date.now() }; const svc = criar(store, agora);
  const { delivery } = await emitirPadrao(svc); const token = delivery.reveal();
  store.fretes.find((f) => f.id === 'frete-A').status = 'finalizado';
  store.fretes.find((f) => f.id === 'frete-B').status = 'cancelado';
  await assert.rejects(() => svc.validar({ token, deviceId: DEV }), (e) => e.code === 'tracking_trip_inactive');
});

test('RESSURREIÇÃO (teste principal): hook falho + A/B encerradas + nova viagem C → credencial ANTIGA continua rejeitada', async () => {
  const store = novoStore(); const agora = { v: Date.now() }; const svc = criar(store, agora);
  const { delivery } = await emitirPadrao(svc); const token = delivery.reveal(); // escopo {A,B}
  // A e B encerram; hook de revogação NÃO roda (simulado: nada é revogado)
  store.fretes.find((f) => f.id === 'frete-A').status = 'finalizado';
  store.fretes.find((f) => f.id === 'frete-B').status = 'finalizado';
  await assert.rejects(() => svc.validar({ token, deviceId: DEV }), (e) => e.code === 'tracking_trip_inactive');
  // nasce viagem C, ativa, do MESMO motorista
  store.fretes.push({ id: 'frete-C', status: 'em_viagem', empresa_id: 'emp-1', motorista_id: 'mot-1' });
  // credencial antiga {A,B} CONTINUA rejeitada — C não está no snapshot
  await assert.rejects(() => svc.validar({ token, deviceId: DEV }), (e) => e.code === 'tracking_trip_inactive');
});

test('nova EMISSÃO com C ativa → nova credencial aceita C (escopo próprio)', async () => {
  const store = novoStore(); store.fretes.forEach((f) => (f.status = 'finalizado'));
  store.fretes.push({ id: 'frete-C', status: 'em_viagem', empresa_id: 'emp-1', motorista_id: 'mot-1' });
  const agora = { v: Date.now() }; const svc = criar(store, agora);
  const { delivery, fretes_escopo } = await emitirPadrao(svc);
  assert.deepEqual(fretes_escopo, ['frete-C']);
  assert.deepEqual(idsAutorizados(await svc.validar({ token: delivery.reveal(), deviceId: DEV })), ['frete-C']);
});

test('renew NÃO amplia escopo: {A,B} + C posterior → renovada segue sem C', async () => {
  const store = novoStore(); const agora = { v: Date.parse('2026-08-10T12:00:00Z') }; const svc = criar(store, agora);
  const { delivery } = await emitirPadrao(svc); // {A,B}
  agora.v += 2 * 3600 * 1000; // expira nominal
  const { delivery: novo } = await svc.renovar({ token: delivery.reveal(), deviceId: DEV });
  const tokenB = novo.reveal();
  // surge C ativa
  store.fretes.push({ id: 'frete-C', status: 'em_viagem', empresa_id: 'emp-1', motorista_id: 'mot-1' });
  // renovada ainda cobre só {A,B} (ambas ativas) — C fora
  assert.deepEqual(idsAutorizados(await svc.validar({ token: tokenB, deviceId: DEV })), ['frete-A', 'frete-B']);
  assert.equal(store.frete_tracking_credencial_fretes.length, 2); // vínculo inalterado
});

test('renew rotaciona (A morre, B vale) e respeita teto', async () => {
  const store = novoStore(); const agora = { v: Date.parse('2026-08-10T12:00:00Z') };
  const svc = criar(store, agora, cfgFake({ trackingCredentialMaxLifetimeSeconds: 2 * 3600 }));
  const { delivery } = await emitirPadrao(svc); const tokenA = delivery.reveal();
  agora.v += 90 * 60 * 1000;
  const { delivery: nB } = await svc.renovar({ token: tokenA, deviceId: DEV });
  await assert.rejects(() => svc.validar({ token: tokenA, deviceId: DEV }), (e) => e.code === 'tracking_credential_invalid');
  assert.ok((await svc.validar({ token: nB.reveal(), deviceId: DEV })).uid);
  agora.v += 60 * 60 * 1000; // além do teto (2h)
  await assert.rejects(() => svc.renovar({ token: nB.reveal(), deviceId: DEV }), (e) => e.code === 'tracking_credential_max_lifetime');
});

test('device mismatch / sessão revogada / motorista bloqueado', async () => {
  {
    const store = novoStore(); const agora = { v: Date.now() }; const svc = criar(store, agora);
    const { delivery } = await emitirPadrao(svc);
    await assert.rejects(() => svc.validar({ token: delivery.reveal(), deviceId: 'x' }), (e) => e.code === 'tracking_device_mismatch');
  }
  {
    const store = novoStore(); const agora = { v: Date.now() }; const svc = criar(store, agora);
    const { delivery } = await emitirPadrao(svc); store.auth_sessions[0].revoked_at = new Date().toISOString();
    await assert.rejects(() => svc.validar({ token: delivery.reveal(), deviceId: DEV }), (e) => e.code === 'tracking_session_revoked');
  }
  {
    const store = novoStore(); const agora = { v: Date.now() }; const svc = criar(store, agora);
    const { delivery } = await emitirPadrao(svc); store.usuarios[0].status = 'bloqueado';
    await assert.rejects(() => svc.validar({ token: delivery.reveal(), deviceId: DEV }), (e) => e.code === 'tracking_driver_blocked');
  }
});

test('§23: credencial sobrevive à expiração do ACCESS (independe de JWT)', async () => {
  const store = novoStore(); const agora = { v: Date.parse('2026-08-10T12:00:00Z') }; const svc = criar(store, agora);
  const { delivery } = await emitirPadrao(svc); const token = delivery.reveal();
  assert.ok((await svc.validar({ token, deviceId: DEV })).uid);
  agora.v += 30 * 60 * 1000;
  assert.ok((await svc.validar({ token, deviceId: DEV })).uid);
});

test('revogarDaSessao/DoMotorista revogam → uso rejeitado', async () => {
  for (const [fn, arg] of [['revogarDaSessao', 'sess-1'], ['revogarDoMotorista', 'mot-1']]) {
    const store = novoStore(); const agora = { v: Date.now() }; const svc = criar(store, agora);
    const { delivery } = await emitirPadrao(svc); const token = delivery.reveal();
    assert.ok((await svc.validar({ token, deviceId: DEV })).uid);
    assert.equal((await svc[fn](arg, 'motivo')).revogadas, 1);
    await assert.rejects(() => svc.validar({ token, deviceId: DEV }), (e) => e.code === 'tracking_credential_revoked', fn);
  }
});

const ativas = (store) => store.frete_tracking_credenciais.filter((c) => !c.revoked_at).length;

test('BLOCKER-1: re-emissão na mesma sessão+device → 1 ativa (mais nova); anterior revogada (reemitida_substituida)', async () => {
  const store = novoStore(); const agora = { v: Date.now() }; const svc = criar(store, agora);
  const rA = await emitirPadrao(svc); const tokenA = rA.delivery.reveal();
  agora.v += 60_000; // emissão POSTERIOR (issued_at maior) → mantém a mais nova
  const rB = await emitirPadrao(svc); const tokenB = rB.delivery.reveal();
  assert.equal(ativas(store), 1, 'exatamente 1 credencial ativa após re-emissão');
  assert.ok((await svc.validar({ token: tokenB, deviceId: DEV })).uid, 'a nova valida');
  await assert.rejects(() => svc.validar({ token: tokenA, deviceId: DEV }), (e) => e.code === 'tracking_credential_revoked', 'a antiga foi revogada');
  assert.equal(store.frete_tracking_credenciais.filter((c) => c.revoked_reason === 'reemitida_substituida').length, 1);
});

test('BLOCKER-1: reconcile/resume/timer repetido (5 emissões, único start) → continua 1 ativa', async () => {
  const store = novoStore(); const agora = { v: Date.now() }; const svc = criar(store, agora);
  let ultima;
  for (let i = 0; i < 5; i++) { agora.v += 30_000; ultima = await emitirPadrao(svc); }
  assert.equal(ativas(store), 1, 'nunca acumula credenciais simultâneas');
  assert.ok((await svc.validar({ token: ultima.delivery.reveal(), deviceId: DEV })).uid);
  assert.equal(store.frete_tracking_credenciais.length, 5, 'históricas preservadas para auditoria');
  assert.equal(store.frete_tracking_credenciais.filter((c) => c.revoked_reason === 'reemitida_substituida').length, 4);
});

test('BLOCKER-1: mudança legítima de escopo (nova viagem C) re-emite, revoga a anterior e mantém 1 ativa com escopo novo', async () => {
  const store = novoStore(); const agora = { v: Date.now() }; const svc = criar(store, agora);
  const rAB = await emitirPadrao(svc);
  store.fretes.push({ id: 'frete-C', status: 'ativo', empresa_id: 'emp-1', motorista_id: 'mot-1' });
  agora.v += 60_000;
  const rABC = await emitirPadrao(svc);
  assert.equal(ativas(store), 1);
  assert.deepEqual([...rABC.fretes_escopo].sort(), ['frete-A', 'frete-B', 'frete-C']);
  // Anti-resurrection: a credencial ANTIGA não volta a valer após a nova emissão.
  await assert.rejects(() => svc.validar({ token: rAB.delivery.reveal(), deviceId: DEV }), (e) => e.code === 'tracking_credential_revoked');
});

test('BLOCKER-1: unicidade é por (session+device) — outro device não é revogado pela emissão', async () => {
  const store = novoStore(); const agora = { v: Date.now() }; const svc = criar(store, agora);
  await svc.emitir({ empresa_id: 'emp-1', motorista_id: 'mot-1', session_id: 'sess-1', device_id: 'device-1' });
  agora.v += 60_000;
  await svc.emitir({ empresa_id: 'emp-1', motorista_id: 'mot-1', session_id: 'sess-1', device_id: 'device-2' });
  assert.equal(ativas(store), 2, 'cada device tem sua credencial operacional corrente');
});
