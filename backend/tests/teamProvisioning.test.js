'use strict';

// Team / User Provisioning V1 — provas da autoridade de provisionamento.
//
// O que estes testes protegem não é o código, é a empresa: que ela consiga montar
// a equipe sem transformar todo mundo em administrador, e que separar "ler perfil
// para atribuir" de "editar o que o perfil significa" não tenha aberto uma porta
// de escalação de privilégio.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// Stub do resolver: os testes de contenção precisam controlar o efetivo do ator,
// não exercitar o resolver (que tem cobertura própria).
let efetivoDoAtorStub = {};
const resolverPath = require.resolve('../services/permissions/permissionResolver');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (parent && /assignableTemplates/.test(parent.filename || '') && request === './permissionResolver') {
    return {
      ...originalLoad.call(this, request, parent, isMain),
      loadEffectivePermissions: async () => efetivoDoAtorStub,
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
delete require.cache[require.resolve('../services/permissions/assignableTemplates')];
delete require.cache[resolverPath];
const {
  listarPerfisAtribuiveis, autorizarAtribuicao, NAO_ATRIBUIVEIS_NA_EQUIPE,
} = require('../services/permissions/assignableTemplates');

const EMPRESA = 'emp-1';

// Perfis da empresa, como estariam no banco após a migration 072.
const TEMPLATES = [
  { id: 'tpl-admin', stable_key: 'administrador', display_name: 'Administrador', descricao: null, is_system_baseline: true, editable: true },
  { id: 'tpl-gerente', stable_key: 'gerente_frota', display_name: 'Gerente de Frota', descricao: null, is_system_baseline: true, editable: true },
  { id: 'tpl-operador', stable_key: 'operador', display_name: 'Operador', descricao: null, is_system_baseline: true, editable: true },
  { id: 'tpl-financeiro', stable_key: 'financeiro', display_name: 'Financeiro', descricao: null, is_system_baseline: true, editable: true },
  { id: 'tpl-motorista', stable_key: 'motorista', display_name: 'Motorista', descricao: null, is_system_baseline: true, editable: true },
  { id: 'tpl-embarcador', stable_key: 'embarcador', display_name: 'Embarcador', descricao: null, is_system_baseline: true, editable: true },
];

const PERMISSOES = {
  'tpl-admin': ['users.view', 'users.manage', 'permissions.manage', 'freight.manage', 'drivers.manage', 'finance.operational.view', 'fleet.view'],
  'tpl-gerente': ['freight.manage', 'drivers.manage', 'fleet.view'],
  'tpl-operador': ['freight.manage'],
  'tpl-financeiro': ['finance.operational.view', 'reports.financial.view'],
  'tpl-motorista': [],
  'tpl-embarcador': [],
};

function supabaseFake({ templates = TEMPLATES } = {}) {
  return {
    from(tabela) {
      if (tabela === 'permission_templates') {
        const estado = { id: null, empresaId: null };
        const api = {
          select() { return api; },
          eq(coluna, valor) {
            if (coluna === 'empresa_id') estado.empresaId = valor;
            if (coluna === 'id') estado.id = valor;
            return api;
          },
          order() {
            const itens = templates.filter((t) => estado.empresaId === null || estado.empresaId === EMPRESA);
            return Promise.resolve({ data: itens, error: null });
          },
          maybeSingle() {
            if (estado.empresaId !== EMPRESA) return Promise.resolve({ data: null, error: null });
            const achado = templates.find((t) => t.id === estado.id) || null;
            return Promise.resolve({ data: achado ? { ...achado, empresa_id: EMPRESA } : null, error: null });
          },
        };
        return api;
      }
      if (tabela === 'permission_template_permissions') {
        const estado = { templateId: null };
        const api = {
          select() { return api; },
          eq(_c, valor) { estado.templateId = valor; return api; },
          then(resolve) {
            const keys = PERMISSOES[estado.templateId] || [];
            return Promise.resolve({ data: keys.map((k) => ({ permission_key: k, allowed: true })), error: null }).then(resolve);
          },
        };
        return api;
      }
      throw new Error('tabela inesperada: ' + tabela);
    },
  };
}

function efetivo(chaves) {
  const mapa = {};
  for (const k of chaves) mapa[k] = true;
  return mapa;
}

// ---------------------------------------------------------------------------

test('provisionamento: administrador enxerga os perfis internos da empresa', async () => {
  efetivoDoAtorStub = efetivo(PERMISSOES['tpl-admin']);
  const { itens } = await listarPerfisAtribuiveis(supabaseFake(), {
    actor: { uid: 'u-admin', empresa_id: EMPRESA },
    empresaId: EMPRESA,
  });
  const chaves = itens.map((i) => i.stable_key);

  // O ponto do USR-001: não é só "Administrador".
  assert.ok(chaves.includes('administrador'));
  assert.ok(chaves.includes('gerente_frota'));
  assert.ok(chaves.includes('operador'));
  assert.ok(chaves.length >= 3, `esperava mais de um perfil, veio: ${chaves.join(', ')}`);
});

test('provisionamento: motorista e embarcador não são perfis de equipe interna', async () => {
  efetivoDoAtorStub = efetivo(PERMISSOES['tpl-admin']);
  const { itens } = await listarPerfisAtribuiveis(supabaseFake(), {
    actor: { uid: 'u-admin', empresa_id: EMPRESA },
    empresaId: EMPRESA,
  });
  const chaves = itens.map((i) => i.stable_key);
  assert.ok(!chaves.includes('motorista'), 'motorista tem fluxo próprio');
  assert.ok(!chaves.includes('embarcador'), 'embarcador é identidade externa do portal');
  assert.ok(NAO_ATRIBUIVEIS_NA_EQUIPE.has('motorista'));
});

test('escalação: gerente com users.manage NÃO enxerga o perfil Administrador', async () => {
  // O gerente tem users.manage delegado, mas não tem permissions.manage nem
  // finance — logo não pode conceder um perfil que os inclua.
  efetivoDoAtorStub = efetivo([...PERMISSOES['tpl-gerente'], 'users.manage', 'users.view']);
  const { itens } = await listarPerfisAtribuiveis(supabaseFake(), {
    actor: { uid: 'u-gerente', empresa_id: EMPRESA },
    empresaId: EMPRESA,
  });
  const chaves = itens.map((i) => i.stable_key);

  assert.ok(!chaves.includes('administrador'), 'gerente não pode criar administrador');
  assert.ok(!chaves.includes('financeiro'), 'gerente não tem financeiro para delegar');
  assert.ok(chaves.includes('operador'), 'mas pode criar operador, que é subconjunto');
});

test('escalação: a negativa vale na GRAVAÇÃO, não só na listagem', async () => {
  // Frontend filtrado não é segurança: o id do template pode ser forjado.
  efetivoDoAtorStub = efetivo([...PERMISSOES['tpl-gerente'], 'users.manage']);
  const r = await autorizarAtribuicao(supabaseFake(), {
    actor: { uid: 'u-gerente', empresa_id: EMPRESA },
    empresaId: EMPRESA,
    templateId: 'tpl-admin',
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.match(r.message, /mais acesso do que o seu/i);
});

test('delegação legítima: administrador pode criar outro administrador', async () => {
  efetivoDoAtorStub = efetivo(PERMISSOES['tpl-admin']);
  const r = await autorizarAtribuicao(supabaseFake(), {
    actor: { uid: 'u-admin', empresa_id: EMPRESA },
    empresaId: EMPRESA,
    templateId: 'tpl-admin',
  });
  assert.equal(r.ok, true, 'não pode impedir delegação legítima de administração');
  assert.equal(r.template.stable_key, 'administrador');
});

test('tenant: template de outra empresa é tratado como inexistente', async () => {
  efetivoDoAtorStub = efetivo(PERMISSOES['tpl-admin']);
  const r = await autorizarAtribuicao(supabaseFake(), {
    actor: { uid: 'u-admin', empresa_id: EMPRESA },
    empresaId: 'outra-empresa',
    templateId: 'tpl-admin',
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404, 'não confirma existência de template fora da fronteira');
});

test('perfil obrigatório: criar sem escolher perfil é recusado', async () => {
  efetivoDoAtorStub = efetivo(PERMISSOES['tpl-admin']);
  const r = await autorizarAtribuicao(supabaseFake(), {
    actor: { uid: 'u-admin', empresa_id: EMPRESA },
    empresaId: EMPRESA,
    templateId: null,
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('motorista não é atribuível pelo fluxo de equipe, e a mensagem diz o caminho', async () => {
  efetivoDoAtorStub = efetivo(PERMISSOES['tpl-admin']);
  const r = await autorizarAtribuicao(supabaseFake(), {
    actor: { uid: 'u-admin', empresa_id: EMPRESA },
    empresaId: EMPRESA,
    templateId: 'tpl-motorista',
  });
  assert.equal(r.ok, false);
  assert.match(r.message, /tela de Motoristas/i);
});

test('super-admin não passa pela contenção, mas segue preso à empresa-alvo', async () => {
  efetivoDoAtorStub = {}; // sem nenhuma permissão efetiva calculada
  const r = await autorizarAtribuicao(supabaseFake(), {
    actor: { uid: 'u-super', is_super_admin: true },
    empresaId: EMPRESA,
    templateId: 'tpl-admin',
  });
  assert.equal(r.ok, true);

  const fora = await autorizarAtribuicao(supabaseFake(), {
    actor: { uid: 'u-super', is_super_admin: true },
    empresaId: 'empresa-inexistente',
    templateId: 'tpl-admin',
  });
  assert.equal(fora.ok, false, 'nem super-admin atribui template de empresa que não é a alvo');
});

test('resumo de capacidades é linguagem de negócio, sem chave de permissão', async () => {
  efetivoDoAtorStub = efetivo(PERMISSOES['tpl-admin']);
  const { itens } = await listarPerfisAtribuiveis(supabaseFake(), {
    actor: { uid: 'u-admin', empresa_id: EMPRESA },
    empresaId: EMPRESA,
  });
  const admin = itens.find((i) => i.stable_key === 'administrador');
  assert.ok(admin.resumo.length > 0, 'perfil precisa explicar o que a pessoa poderá fazer');
  for (const linha of admin.resumo) {
    assert.ok(!/\./.test(linha.replace(/\.$/, '')) || !/[a-z]+\.[a-z]+/.test(linha),
      `resumo não deve conter chave técnica: ${linha}`);
  }
});
