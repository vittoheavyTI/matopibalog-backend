'use strict';

// RBV9-INV-110 — provas de que a autoridade de produto é a PERMISSÃO EFETIVA, não a
// classe de conta legada.
//
// O que estes testes protegem: que um perfil de acesso atribuído realmente mude o que
// a pessoa consegue fazer. Antes disto, `role === 'admin'` valia para todo usuário
// interno (D-069), então o gate legado não distinguia Operador de Administrador —
// aprovava em silêncio quem não devia e negaria, no futuro, quem devia.
//
// Toda persona abaixo carrega `role: 'admin'` de propósito: é o estado real de
// produção. Se algum teste passar por causa dessa claim em vez da permissão, o
// fecho não aconteceu.

// O módulo supabase aborta o processo sem env. Os testes abaixo nunca chegam ao
// banco (a negação acontece antes), mas o require precisa carregar.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'service_key_de_teste';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// ── Stub do resolver ────────────────────────────────────────────────────────────
// `ensureEffective` (usado por requirePermission, freteAcesso, contratacao e
// lancamentoAcoes) resolve o efetivo por aqui. Controlamos o efetivo por UID.
const EFETIVO_POR_UID = new Map();
const resolverPath = require.resolve('../services/permissions/permissionResolver');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const arquivoPai = (parent && parent.filename) || '';
  const ehResolver = request === '../services/permissions/permissionResolver'
    || request === './permissionResolver'
    || request === './../services/permissions/permissionResolver';
  if (ehResolver && /requirePermission/.test(arquivoPai)) {
    return {
      ...originalLoad.call(this, request, parent, isMain),
      loadEffectivePermissions: async (_sb, ctx) => ({
        permissions: EFETIVO_POR_UID.get(ctx && ctx.uid) || {},
      }),
    };
  }
  // Depois da autorização, a transição chama a RPC e o banco. Estes testes provam
  // AUTORIZAÇÃO, então o que vem depois vira dublê: sem isso o caso permitido sairia
  // pela rede e o teste ficaria lento e não-determinístico.
  if (/lancamentoAcoesController/.test(arquivoPai) && request === '../services/lancamentoWorkflow') {
    return {
      transicionar: async () => ({ ok: true, data: { transicionado: true } }),
      detectarOrigem: () => 'teste',
    };
  }

  // O cliente real é substituído para TODO consumidor, não só o controller de
  // lançamentos. Dois motivos, e o segundo só aparece no CI: nenhum destes testes
  // deve tocar o banco; e o cliente real monta um RealtimeClient que, em Node 20 sem
  // WebSocket nativo, LANÇA na carga do módulo. Em Node 24 há WebSocket e o erro não
  // aparece localmente — foi assim que este teste passou aqui e quebrou no CI.
  if (request === '../config/supabase' || request === './../config/supabase') {
    const tabela = {
      select: () => tabela,
      eq: () => tabela,
      in: () => tabela,
      maybeSingle: async () => ({ data: { empresa_id: 'emp-1' } }),
      single: async () => ({ data: { empresa_id: 'emp-1' } }),
    };
    return { from: () => tabela, rpc: async () => ({ data: null, error: null }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

for (const m of [
  '../middlewares/requirePermission',
  '../controllers/lancamentoAcoesController',
  '../controllers/freteAcesso',
  resolverPath,
]) {
  delete require.cache[require.resolve(m)];
}

const { executarTransicao } = require('../controllers/lancamentoAcoesController');
const { podeGerenciarFrete, negarSeNaoGerenciaFrete } = require('../controllers/freteAcesso');

// ── Personas ────────────────────────────────────────────────────────────────────
// Chaves exatamente como no baseline do registry (permissionRegistry.js).
const PERSONAS = {
  ADMINISTRADOR: {
    uid: 'u-admin', role: 'admin', empresa_id: 'emp-1',
    permissoes: [
      'users.view', 'users.manage', 'permissions.manage',
      'company.settings.view', 'company.settings.manage',
      'freight.view', 'freight.manage', 'freight.finish',
      'launch.view', 'launch.create', 'launch.approve', 'launch.reject', 'launch.cancel',
      'finance.operational.view', 'finance.operational.manage', 'finance.saas.view',
      'reports.operational.view', 'reports.financial.view',
    ],
  },
  GERENTE_FROTA: {
    uid: 'u-gerente', role: 'admin', empresa_id: 'emp-1',
    permissoes: [
      'company.settings.view',
      'freight.view', 'freight.manage', 'freight.finish',
      'launch.view', 'launch.create', 'launch.approve', 'launch.reject', 'launch.cancel',
      'drivers.view', 'drivers.manage', 'fleet.view', 'fleet.manage',
      'reports.operational.view',
    ],
  },
  OPERADOR: {
    uid: 'u-operador', role: 'admin', empresa_id: 'emp-1',
    permissoes: [
      'company.settings.view',
      'freight.view', 'freight.create', 'freight.manage',
      'launch.view', 'launch.create',
      'documents.view', 'documents.manage',
      'drivers.view', 'reports.operational.view',
    ],
  },
  FINANCEIRO: {
    uid: 'u-financeiro', role: 'admin', empresa_id: 'emp-1',
    permissoes: [
      'company.settings.view', 'freight.view', 'launch.view', 'documents.view',
      'finance.operational.view', 'finance.operational.manage', 'finance.saas.view',
      'reports.operational.view', 'reports.financial.view',
    ],
  },
  // Perfil criado pela empresa, com nome que o código nunca viu. Prova que a
  // autoridade vem da capacidade, não do nome do template (§33/§64).
  CUSTOM_RESTRITO: {
    uid: 'u-custom', role: 'admin', empresa_id: 'emp-1',
    permissoes: ['launch.view', 'launch.approve'],
  },
  MOTORISTA: {
    uid: 'u-motorista', role: 'motorista', empresa_id: 'emp-1',
    permissoes: ['freight.view', 'launch.view', 'launch.create', 'documents.view'],
  },
  SUPERADMIN: {
    uid: 'u-super', role: 'admin', is_super_admin: true, empresa_id: null,
    permissoes: [],
  },
};

for (const p of Object.values(PERSONAS)) {
  EFETIVO_POR_UID.set(p.uid, Object.fromEntries(p.permissoes.map((k) => [k, true])));
}

function requisicao(persona, { body = {}, params = { id: 'lanc-1' }, empresaId = 'emp-1' } = {}) {
  return {
    user: {
      uid: persona.uid,
      role: persona.role,
      is_super_admin: persona.is_super_admin === true,
      empresa_id: persona.empresa_id,
    },
    empresa_id: empresaId,
    params,
    body,
    headers: {},
  };
}

function respostaFake() {
  const r = { statusCode: null, corpo: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.corpo = b; return r; };
  return r;
}

// ── §31 WRONG_ALLOW: a claim legada não abre porta ──────────────────────────────

test('operador com role=admin NÃO aprova lançamento — não tem launch.approve', async () => {
  const res = respostaFake();
  await executarTransicao(requisicao(PERSONAS.OPERADOR, { body: { status: 'aprovado' } }), res, 'despesa', 'aprovado');
  assert.equal(res.statusCode, 403, 'Operador deve ser negado mesmo carregando role=admin');
  assert.equal(res.corpo.permission, 'launch.approve');
});

test('operador com role=admin NÃO rejeita nem cancela lançamento', async () => {
  for (const [status, chave] of [['rejeitado', 'launch.reject'], ['cancelado', 'launch.cancel']]) {
    const res = respostaFake();
    await executarTransicao(requisicao(PERSONAS.OPERADOR), res, 'vale', status);
    assert.equal(res.statusCode, 403, `esperado 403 para ${status}`);
    assert.equal(res.corpo.permission, chave);
  }
});

test('o bypass do PATCH está fechado: a mesma transição é negada pelos dois caminhos', async () => {
  // O PATCH /:id é guardado só por launch.create — que o Operador TEM — e delegava
  // para esta função. A autoridade agora vive na transição, não na rota.
  const res = respostaFake();
  await executarTransicao(
    requisicao(PERSONAS.OPERADOR, { body: { status: 'aprovado' } }),
    res, 'abastecimento', 'aprovado',
  );
  assert.equal(res.statusCode, 403);
});

test('motorista NÃO aprova o próprio lançamento — tem launch.create, não launch.approve', async () => {
  const res = respostaFake();
  await executarTransicao(requisicao(PERSONAS.MOTORISTA), res, 'despesa', 'aprovado');
  assert.equal(res.statusCode, 403);
  assert.equal(res.corpo.permission, 'launch.approve');
});

test('financeiro NÃO valida comprovação de entrega — não tem freight.manage', async () => {
  const res = respostaFake();
  const respondeu = await negarSeNaoGerenciaFrete(requisicao(PERSONAS.FINANCEIRO), res);
  assert.equal(respondeu, true);
  assert.equal(res.statusCode, 403);
  assert.equal(res.corpo.permission, 'freight.manage');
});

// ── §32 WRONG_DENY: quem tem a capacidade delegada passa ────────────────────────

test('gerente de frota aprova lançamento sem ser do template Administrador', async () => {
  const res = respostaFake();
  await executarTransicao(requisicao(PERSONAS.GERENTE_FROTA), res, 'despesa', 'aprovado');
  assert.notEqual(res.statusCode, 403, 'quem tem launch.approve não pode ser barrado');
});

test('operador valida comprovação de entrega — tem freight.manage', async () => {
  const res = respostaFake();
  const respondeu = await negarSeNaoGerenciaFrete(requisicao(PERSONAS.OPERADOR), res);
  assert.equal(respondeu, false, 'Operador tem freight.manage e não pode ser barrado');
  assert.equal(res.statusCode, null);
});

// ── §33/§64 Perfil customizado: vale a capacidade, não o nome ───────────────────

test('perfil customizado com launch.approve aprova igual ao baseline', async () => {
  const res = respostaFake();
  await executarTransicao(requisicao(PERSONAS.CUSTOM_RESTRITO), res, 'vale', 'aprovado');
  assert.notEqual(res.statusCode, 403);
});

test('perfil customizado SEM freight.manage não valida entrega, mesmo sendo interno', async () => {
  const res = respostaFake();
  const respondeu = await negarSeNaoGerenciaFrete(requisicao(PERSONAS.CUSTOM_RESTRITO), res);
  assert.equal(respondeu, true);
  assert.equal(res.corpo.permission, 'freight.manage');
});

// ── §36 Super-admin preservado ──────────────────────────────────────────────────

test('super-admin passa sem depender de template atribuído', async () => {
  assert.equal(await podeGerenciarFrete(requisicao(PERSONAS.SUPERADMIN)), true);
});

test('super-admin transiciona sem permissão de tenant', async () => {
  const res = respostaFake();
  // Sem empresa no request: o caminho de super-admin resolve a empresa pelo registro.
  await executarTransicao(requisicao(PERSONAS.SUPERADMIN, { empresaId: null }), res, 'despesa', 'aprovado');
  assert.notEqual(res.statusCode, 403, 'super-admin não pode ser barrado por permissão de tenant');
});

// ── Transição desconhecida nega por construção ─────────────────────────────────

test('status fora do mapa é negado, não liberado por omissão', async () => {
  const res = respostaFake();
  await executarTransicao(requisicao(PERSONAS.ADMINISTRADOR), res, 'despesa', 'finalizado');
  assert.equal(res.statusCode, 400);
});

// ── Registry: as chaves usadas existem de verdade ──────────────────────────────

test('toda permissão exigida por este fecho existe no registry — nenhuma inventada', () => {
  const { PERMISSIONS } = require('../services/permissions/permissionRegistry');
  const existentes = new Set(PERMISSIONS.map((p) => p.key));
  const usadas = [
    'launch.approve', 'launch.reject', 'launch.cancel',
    'freight.manage', 'finance.saas.view', 'company.settings.manage', 'users.view',
  ];
  for (const chave of usadas) {
    assert.ok(existentes.has(chave), `chave ausente do registry: ${chave}`);
  }
});

test('o baseline confirma a separação que os gates assumem', () => {
  const { TEMPLATE_BASELINE_ALLOW, TEMPLATE_KEYS } = require('../services/permissions/permissionRegistry');
  const operador = new Set(TEMPLATE_BASELINE_ALLOW[TEMPLATE_KEYS.OPERADOR]);
  const admin = new Set(TEMPLATE_BASELINE_ALLOW[TEMPLATE_KEYS.ADMINISTRADOR]);

  // Se algum dia o baseline do Operador ganhar estas chaves, os gates acima deixam
  // de separar o que prometem — e este teste avisa antes de virar incidente.
  for (const chave of ['launch.approve', 'company.settings.manage', 'users.view', 'finance.saas.view']) {
    assert.equal(operador.has(chave), false, `Operador não deveria ter ${chave} no baseline`);
    assert.equal(admin.has(chave), true, `Administrador deveria ter ${chave} no baseline`);
  }
  // E o que o Operador precisa para trabalhar continua lá.
  assert.equal(operador.has('launch.create'), true);
  assert.equal(operador.has('freight.manage'), true);
});
