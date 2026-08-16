const test = require('node:test');
const assert = require('node:assert/strict');

const {
  permissaoUsuario,
  PERMISSOES_PORTAL,
  carregarPortalGovernanca,
} = require('../services/portalGovernanceService');

function queryResult(data, error = null) {
  return {
    select() { return this; },
    eq() { return this; },
    in() { return this; },
    maybeSingle: async () => ({ data, error }),
  };
}

function supabaseMock({ usuario, empresa, funcionalidades = [], planoFuncs = [], empresaFuncs = [] }) {
  return {
    from(tabela) {
      if (tabela === 'usuarios') return queryResult(usuario);
      if (tabela === 'empresas') return queryResult(empresa);
      if (tabela === 'funcionalidades') return { select() { return this; }, in: async () => ({ data: funcionalidades, error: null }) };
      if (tabela === 'plano_funcionalidades') return { select() { return this; }, eq() { return this; }, in: async () => ({ data: planoFuncs, error: null }) };
      if (tabela === 'empresa_funcionalidades') return { select() { return this; }, eq() { return this; }, in: async () => ({ data: empresaFuncs, error: null }) };
      return queryResult(null, { code: '42P01', message: 'missing' });
    },
  };
}

test('permissões: admin legado gerencia empresa e estrutura, mas usuários só com permissão explícita', () => {
  const usuario = { tipo: 'admin', permissoes: { configuracoes: true, usuarios: false } };
  assert.equal(permissaoUsuario(usuario, PERMISSOES_PORTAL.empresa), true);
  assert.equal(permissaoUsuario(usuario, PERMISSOES_PORTAL.estrutura_operacional), true);
  assert.equal(permissaoUsuario(usuario, PERMISSOES_PORTAL.usuarios), false);
});

test('portal governance resolve Estrutura via plano e ERP via adicional ativo', async () => {
  const estrutura = { id: 'f-estrutura', codigo: 'estrutura_operacional', ativo: true, status_ciclo_vida: 'disponivel' };
  const erp = { id: 'f-erp', codigo: 'integracoes_erp', ativo: true, status_ciclo_vida: 'disponivel' };
  const sso = { id: 'f-sso', codigo: 'acesso_corporativo_sso', ativo: true, status_ciclo_vida: 'disponivel' };
  const r = await carregarPortalGovernanca(supabaseMock({
    usuario: { id: 'u1', tipo: 'admin', empresa_id: 'e1', permissoes: { configuracoes: true } },
    empresa: { id: 'e1', plano_id: 'p1', config_empresa: {} },
    funcionalidades: [estrutura, erp, sso],
    planoFuncs: [
      { plano_id: 'p1', funcionalidade_id: 'f-estrutura', disponibilidade: 'incluida' },
      { plano_id: 'p1', funcionalidade_id: 'f-erp', disponibilidade: 'opcional_paga' },
      { plano_id: 'p1', funcionalidade_id: 'f-sso', disponibilidade: 'sob_negociacao' },
    ],
    empresaFuncs: [{ empresa_id: 'e1', funcionalidade_id: 'f-erp', status: 'ativa', origem: 'adicional' }],
  }), { empresaId: 'e1', usuarioId: 'u1', user: { role: 'admin' } });

  assert.equal(r.entitlements.estrutura_operacional.permitido, true);
  assert.equal(r.entitlements.estrutura_operacional.origem, 'plano');
  assert.equal(r.entitlements.integracoes_erp.permitido, true);
  assert.equal(r.entitlements.integracoes_erp.origem, 'adicional');
  assert.equal(r.entitlements.acesso_corporativo_sso.permitido, false);
  assert.equal(r.entitlements.acesso_corporativo_sso.motivo, 'sob_negociacao');
});

test('status técnico em_breve nega acesso mesmo com direito comercial incluído (ERP/SSO não implementados)', async () => {
  // Reflete a matriz da migration 069: ERP/SSO têm status_ciclo_vida='em_breve'.
  // Mesmo que o plano os marque como "incluida", o conector técnico não existe:
  // o acesso REAL é negado (nao_implementada) e nada é declarado "disponível".
  const erp = { id: 'f-erp', codigo: 'integracoes_erp', ativo: true, status_ciclo_vida: 'em_breve' };
  const sso = { id: 'f-sso', codigo: 'acesso_corporativo_sso', ativo: true, status_ciclo_vida: 'em_breve' };
  const estrutura = { id: 'f-estrutura', codigo: 'estrutura_operacional', ativo: true, status_ciclo_vida: 'disponivel' };
  const r = await carregarPortalGovernanca(supabaseMock({
    usuario: { id: 'u1', tipo: 'admin', empresa_id: 'e1', permissoes: { configuracoes: true } },
    empresa: { id: 'e1', plano_id: 'p1', config_empresa: {} },
    funcionalidades: [estrutura, erp, sso],
    planoFuncs: [
      { plano_id: 'p1', funcionalidade_id: 'f-erp', disponibilidade: 'incluida' },
      { plano_id: 'p1', funcionalidade_id: 'f-sso', disponibilidade: 'incluida' },
    ],
    empresaFuncs: [],
  }), { empresaId: 'e1', usuarioId: 'u1', user: { role: 'admin' } });

  assert.equal(r.entitlements.integracoes_erp.permitido, false);
  assert.equal(r.entitlements.integracoes_erp.motivo, 'nao_implementada');
  assert.equal(r.entitlements.acesso_corporativo_sso.permitido, false);
  assert.equal(r.entitlements.acesso_corporativo_sso.motivo, 'nao_implementada');
  // Uso técnico negado, mas o DIREITO COMERCIAL do plano continua visível para a UI
  // decidir aba/copy (incluída no plano, "em preparação"), sem implicar conexão.
  assert.equal(r.entitlements.integracoes_erp.disponibilidade_comercial, 'incluida');
  assert.equal(r.entitlements.acesso_corporativo_sso.disponibilidade_comercial, 'incluida');
});

test('disponibilidade_comercial reflete plano/override e indisponivel esconde a aba', async () => {
  const erp = { id: 'f-erp', codigo: 'integracoes_erp', ativo: true, status_ciclo_vida: 'em_breve' };
  const sso = { id: 'f-sso', codigo: 'acesso_corporativo_sso', ativo: true, status_ciclo_vida: 'em_breve' };
  const estrutura = { id: 'f-estrutura', codigo: 'estrutura_operacional', ativo: true, status_ciclo_vida: 'disponivel' };
  const r = await carregarPortalGovernanca(supabaseMock({
    usuario: { id: 'u1', tipo: 'admin', empresa_id: 'e1', permissoes: { configuracoes: true } },
    empresa: { id: 'e1', plano_id: 'p1', config_empresa: {} },
    funcionalidades: [estrutura, erp, sso],
    planoFuncs: [
      { plano_id: 'p1', funcionalidade_id: 'f-erp', disponibilidade: 'opcional_paga' },
      // SSO sem vínculo de plano → indisponivel (Start/Essencial): esconder aba.
    ],
    empresaFuncs: [],
  }), { empresaId: 'e1', usuarioId: 'u1', user: { role: 'admin' } });

  assert.equal(r.entitlements.integracoes_erp.disponibilidade_comercial, 'opcional_paga');
  assert.equal(r.entitlements.acesso_corporativo_sso.disponibilidade_comercial, 'indisponivel');
});
