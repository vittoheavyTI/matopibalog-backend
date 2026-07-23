// Compatibilidade PURA entre o tipo da empresa e a categoria do plano.
// Espelha, no backend, a mesma regra que o painel (PainelEmpresas.tsx) e o
// cadastro self-service (authController) já aplicam na seleção — mas como TRAVA
// de servidor: um curl, um estado legado ou um painel desatualizado não podem
// mais colocar um autônomo num plano de empresa (ou vice-versa).
//
// Regra (categoria do plano → quem pode usar):
//   'ambos'    → qualquer empresa;
//   'autonomo' → somente empresa.tipo === 'autonomo';
//   'empresa'  → somente empresa.tipo !== 'autonomo' (transportadora/fazenda).
// Categoria ausente/desconhecida conta como 'ambos' (compatível) — mesma
// tolerância do painel, que trata categoria nula como 'ambos'.

const CATEGORIAS_PLANO = ['empresa', 'autonomo', 'ambos'];

function categoriaCompativelComTipo(tipoEmpresa, categoriaPlano) {
  const cat = CATEGORIAS_PLANO.includes(categoriaPlano) ? categoriaPlano : 'ambos';
  const ehAutonomo = tipoEmpresa === 'autonomo';
  if (cat === 'ambos') return true;
  if (cat === 'autonomo') return ehAutonomo;
  return !ehAutonomo; // 'empresa'
}

function mensagemIncompatibilidade(tipoEmpresa) {
  return tipoEmpresa === 'autonomo'
    ? 'Este plano é destinado a empresas. Selecione um plano para autônomo.'
    : 'Este plano é destinado a autônomos. Selecione um plano para empresa.';
}

module.exports = { CATEGORIAS_PLANO, categoriaCompativelComTipo, mensagemIncompatibilidade };
