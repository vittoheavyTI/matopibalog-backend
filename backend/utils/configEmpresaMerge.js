// backend/utils/configEmpresaMerge.js
// Merge defensivo (PURO, sem I/O) de config_empresa (empresas.config_empresa).
// Preserva as chaves existentes que não vieram no patch; ignora null/undefined
// (evita apagar por save parcial/corrida); a string vazia '' é preservada
// (remoção intencional, ex.: logomarca removida). Espelha o merge do
// `configuracoes` global. Permite salvar SÓ a logomarca sem apagar os dados da
// empresa — e vice-versa.

function mesclarConfigEmpresa(atual, patch) {
  const base = (atual && typeof atual === 'object' && !Array.isArray(atual)) ? atual : {};
  const entrada = (patch && typeof patch === 'object' && !Array.isArray(patch)) ? patch : {};
  const saida = { ...base };
  for (const [chave, valor] of Object.entries(entrada)) {
    if (valor !== null && valor !== undefined) saida[chave] = valor;
  }
  return saida;
}

module.exports = { mesclarConfigEmpresa };
