'use strict';

// Autorização REAL + inércia do endpoint de verifiability do ERP Hub:
//   GET /erp-hub/status
//
// MEDIUM-01 — ERP_DIAGNOSTICS_AUTHORITY = EFFECTIVE_PERMISSION('integracoes_erp.gerenciar'),
// com a precedência do resolver PRESERVADA: ENTITLEMENT → OVERRIDE → TEMPLATE → DEFAULT_DENY.
//
// A versão anterior deste teste injetava `{'integracoes_erp.gerenciar': true}` direto
// no efetivo e afirmava "200 para tenant". Isso passava por cima da realidade: no
// registry essa permissão tem `entitlementCodigo:'integracoes_erp'`, e o resolver nega
// ANTES de olhar template/override quando o entitlement técnico não está concedido —
// que é exatamente o caso hoje, com `funcionalidades.integracoes_erp` em `em_breve`.
// O teste então provava um acesso que ninguém tem de verdade.
//
// Aqui o I/O é stubado, mas quem decide é o `computeEffectivePermissions` REAL.
// Nenhuma permissão nova foi criada e nenhuma precedência foi relaxada: enquanto o
// ERP for `em_breve`, só o super-admin (autoridade de plataforma) enxerga o
// diagnóstico. A rota de diagnóstico NÃO abre acesso operacional de ERP.

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const Module = require('node:module');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
delete process.env.ERP_PROVIDER_MODE; // garante default disabled

// Resolver REAL — é ele quem aplica a precedência.
const { computeEffectivePermissions } = require('../services/permissions/permissionResolver');

// Cenário controla apenas o que viria do BANCO (template/overrides/entitlements).
let cenario = { template: null, overrides: {}, entitlements: {} };

// Estado técnico do ERP hoje em produção: 'em_breve' → entitlement negado.
const ENTITLEMENTS_HOJE = { integracoes_erp: false };
// Cenário futuro hipotético: ERP 'disponivel' e concedido pelo plano.
const ENTITLEMENTS_ERP_LIBERADO = { integracoes_erp: true };
// Template de administrador que concede a chave de gestão de ERP.
const TEMPLATE_ADMIN_COM_ERP = {
  stable_key: 'administrador',
  permissions: { 'integracoes_erp.gerenciar': true },
};

function supabaseStub() {
  function builder(tabela) {
    const b = {
      select: () => b,
      eq: () => b,
      maybeSingle: () => {
        if (tabela === 'funcionalidades') {
          return Promise.resolve({ data: { codigo: 'integracoes_erp', status_ciclo_vida: 'em_breve', ativo: true }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      single: () => {
        if (tabela === 'usuarios') return Promise.resolve({ data: { empresa_id: 'emp-1' }, error: null });
        return Promise.resolve({ data: null, error: null });
      },
    };
    return b;
  }
  return { from: (t) => builder(t) };
}

function carregarRouterReal() {
  const originalLoad = Module._load;
  for (const p of ['../routes/erpHub', '../middlewares/tenant', '../middlewares/requirePermission']) {
    try { delete require.cache[require.resolve(p)]; } catch (_) { /* noop */ }
  }
  Module._load = function (request, parent, isMain) {
    if (request === '../config/supabase') return supabaseStub();
    if (request === '../services/permissions/permissionResolver') {
      return {
        // Só o I/O é substituído; a DECISÃO é do resolver real.
        loadEffectivePermissions: async (_supabase, user) => computeEffectivePermissions({
          user: {
            id: user.uid,
            tipo: user.tipo || 'admin',
            is_super_admin: user.is_super_admin === true,
            empresa_id: 'emp-1',
            empresa_tipo: 'transportadora',
          },
          template: cenario.template,
          overrides: cenario.overrides,
          entitlements: cenario.entitlements,
        }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require('../routes/erpHub');
  } finally {
    Module._load = originalLoad;
  }
}

function subirApp() {
  const app = express();
  app.use(express.json());
  app.use('/erp-hub', carregarRouterReal());
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

function token(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '5m' });
}

async function get(port, headers = {}) {
  const r = await fetch(`http://127.0.0.1:${port}/erp-hub/status`, { headers });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

async function comApp(fn) {
  const { server, port } = await subirApp();
  try { return await fn(port); } finally { server.close(); }
}

// ── MATRIZ DE AUTORIDADE ──────────────────────────────────────────────

test('matriz: anônimo → 401', async () => {
  cenario = { template: TEMPLATE_ADMIN_COM_ERP, overrides: {}, entitlements: ENTITLEMENTS_HOJE };
  await comApp(async (port) => {
    assert.equal((await get(port)).status, 401);
  });
});

test('matriz: tenant COM template que concede, mas entitlement técnico negado → 403', async () => {
  // Este é o estado REAL de produção hoje (integracoes_erp = 'em_breve').
  cenario = { template: TEMPLATE_ADMIN_COM_ERP, overrides: {}, entitlements: ENTITLEMENTS_HOJE };
  await comApp(async (port) => {
    const r = await get(port, { Authorization: `Bearer ${token({ uid: 'u1', tipo: 'admin' })}` });
    assert.equal(r.status, 403, 'template sozinho não pode abrir ERP enquanto o entitlement técnico nega');
    assert.equal(r.body.permission, 'integracoes_erp.gerenciar');
  });
});

test('matriz: entitlement negado vence até OVERRIDE explícito de allow', async () => {
  cenario = {
    template: TEMPLATE_ADMIN_COM_ERP,
    overrides: { 'integracoes_erp.gerenciar': 'allow' },
    entitlements: ENTITLEMENTS_HOJE,
  };
  await comApp(async (port) => {
    const r = await get(port, { Authorization: `Bearer ${token({ uid: 'u1', tipo: 'admin' })}` });
    assert.equal(r.status, 403, 'precedência ENTITLEMENT → OVERRIDE → TEMPLATE não pode ser relaxada');
  });
});

test('matriz: tenant sem template e sem entitlement → 403 (default deny)', async () => {
  cenario = { template: null, overrides: {}, entitlements: ENTITLEMENTS_HOJE };
  await comApp(async (port) => {
    const r = await get(port, { Authorization: `Bearer ${token({ uid: 'u2', tipo: 'operador' })}` });
    assert.equal(r.status, 403);
  });
});

test('matriz: classe de conta admin (role) NÃO é autoridade', async () => {
  // Sem template e sem entitlement, ser `tipo=admin` não concede nada — a autoridade
  // é permissão efetiva, nunca a classe da conta (D-072 / RBV9-INV-110).
  cenario = { template: null, overrides: {}, entitlements: ENTITLEMENTS_HOJE };
  await comApp(async (port) => {
    const r = await get(port, { Authorization: `Bearer ${token({ uid: 'u3', tipo: 'admin', role: 'admin' })}` });
    assert.equal(r.status, 403);
  });
});

test('matriz: super-admin consulta como autoridade de plataforma → 200 inerte', async () => {
  cenario = { template: null, overrides: {}, entitlements: ENTITLEMENTS_HOJE };
  await comApp(async (port) => {
    const r = await get(port, { Authorization: `Bearer ${token({ uid: 'u0', is_super_admin: true })}` });
    assert.equal(r.status, 200);
    assert.equal(r.body.production_inert, true);
    assert.equal(r.body.entitlement.access, 'nao_implementada');
  });
});

test('matriz: cenário futuro (ERP disponível + concedido) → 200 pelo resolver real', async () => {
  // Prova que a rota funciona quando o entitlement técnico for concedido de verdade,
  // sem que nada precise ser afrouxado agora.
  cenario = { template: TEMPLATE_ADMIN_COM_ERP, overrides: {}, entitlements: ENTITLEMENTS_ERP_LIBERADO };
  await comApp(async (port) => {
    const r = await get(port, { Authorization: `Bearer ${token({ uid: 'u1', tipo: 'admin' })}` });
    assert.equal(r.status, 200);
  });
});

// ── INÉRCIA DA RESPOSTA ───────────────────────────────────────────────

test('resposta é inerte e honesta (nunca "conectado"/"sincronizando")', async () => {
  cenario = { template: null, overrides: {}, entitlements: ENTITLEMENTS_HOJE };
  await comApp(async (port) => {
    const r = await get(port, { Authorization: `Bearer ${token({ uid: 'u0', is_super_admin: true })}` });
    assert.equal(r.status, 200);
    assert.equal(r.body.mode, 'disabled');
    assert.equal(r.body.enabled, false);
    assert.equal(r.body.provider_available, false);
    assert.equal(r.body.read_only, true);
    assert.equal(r.body.production_inert, true);
    assert.deepEqual(r.body.provider_capabilities, []);
    assert.equal(r.body.display_status, 'em_preparacao');
    assert.equal(r.body.crash_safety, 'CRASH_SAFE_CONTRACT_DEFINED');
    assert.equal(r.body.event_identity_authority, 'LOGICAL_EVENT_ID');
    assert.equal(r.body.intent_fingerprint_role, 'CONFLICT_GUARD');
    assert.equal(r.body.outbox_ambiguous_recovery, 'RECONCILE_BEFORE_RESEND');
    assert.equal(r.body.entitlement.codigo, 'integracoes_erp');
    assert.equal(r.body.entitlement.technical_state, 'em_breve');
    const flat = JSON.stringify(r.body).toLowerCase();
    for (const proibido of ['conectado', 'sincronizando', 'sankhya', 'totvs', 'omie']) {
      assert.equal(flat.includes(proibido), false, `resposta não pode sugerir: ${proibido}`);
    }
  });
});
