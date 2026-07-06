function classificarResponsavelRegularizacao({ role, empresaTipo, temAdminAtivo }) {
  if (role === 'admin') return 'painel';
  if (role !== 'motorista') return 'suporte';
  if (empresaTipo !== 'autonomo') return 'admin_empresa';
  if (temAdminAtivo) return 'admin_autonomo';
  return 'autonomo';
}

module.exports = { classificarResponsavelRegularizacao };
