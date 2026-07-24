// backend/services/empresaArquivamentoService.js
// Mega-frente de higiene operacional: regras PURAS de arquivamento de empresas.
// Sem I/O — recebe dados prontos e devolve decisão/patch/filtro, no mesmo estilo
// testável de planoAdminService e planoPrecoService. As rotas/jobs orquestram.
//
// FILTRAGEM EM NÍVEL DE APLICAÇÃO (decisão de arquitetura — deploy-safe):
// os leitores (listagem, jobs, billing-health) filtram arquivadas AQUI, sobre os
// objetos já lidos, em vez de no `WHERE` do banco. Assim o código pode ser
// mergeado ANTES de a coluna `arquivada_em` existir em produção: onde a coluna
// não existe, `empresa.arquivada_em` é `undefined`, `isArquivada` devolve false, e
// tudo se comporta como hoje. Quando a coluna passa a existir e alguma conta é
// arquivada, o filtro começa a valer — sem nenhuma janela de query quebrada.

// Uma empresa está arquivada se tem carimbo de arquivamento. undefined (coluna
// ainda inexistente) e null (coluna existe, conta não arquivada) → NÃO arquivada.
function isArquivada(empresa) {
  return Boolean(empresa && empresa.arquivada_em != null);
}

// Filtra uma lista removendo as arquivadas, a menos que includeArchived seja true.
// includeArchived é privilégio de leitura do super-admin (a rota decide quando).
function aplicarFiltroArquivamento(empresas, { includeArchived = false } = {}) {
  if (!Array.isArray(empresas)) return [];
  if (includeArchived) return empresas;
  return empresas.filter((e) => !isArquivada(e));
}

// Só as arquivadas (para telas/relatórios de "Arquivadas" e para o informativo do
// billing-health).
function apenasArquivadas(empresas) {
  if (!Array.isArray(empresas)) return [];
  return empresas.filter((e) => isArquivada(e));
}

// Monta o patch de arquivar/desarquivar a partir do corpo do PUT. A autoria
// (arquivada_por) vem SEMPRE do token (actorUid), nunca do body. Espelha
// planoAdminService.montarPatchArquivamento.
//   arquivar === true  → arquiva: arquivada_em=agora, arquivada_por=actor, motivo;
//   arquivar === false → desarquiva: zera arquivada_em/por/motivo;
//   arquivar ausente   → {} (nada a fazer nessa dimensão).
// NÃO mexe em `status` — arquivar é ortogonal a suspensão (ver migration 036).
function montarPatchArquivamentoEmpresa(body, actorUid) {
  if (!body || body.arquivar === undefined) return {};
  if (body.arquivar === true) {
    return {
      arquivada_em: new Date().toISOString(),
      arquivada_por: actorUid || null,
      arquivada_motivo: body.motivo != null && String(body.motivo).trim() !== ''
        ? String(body.motivo).trim()
        : null,
    };
  }
  return { arquivada_em: null, arquivada_por: null, arquivada_motivo: null };
}

// Resumo para o informativo do billing-health: quantas arquivadas e quantas delas
// carregam fatura paga (não deveria arquivar cliente pagante sem querer — é sinal,
// não bloqueio). `empresaIdsComFaturaPaga` é um Set montado pela rota.
function resumirArquivadas(empresas, empresaIdsComFaturaPaga) {
  const arquivadas = apenasArquivadas(empresas);
  const comPagas = empresaIdsComFaturaPaga instanceof Set
    ? arquivadas.filter((e) => empresaIdsComFaturaPaga.has(e.id))
    : [];
  return {
    arquivadas_total: arquivadas.length,
    arquivadas_com_fatura_paga: comPagas.length,
    detalhe_arquivadas_com_fatura_paga: comPagas.map((e) => ({ id: e.id, nome: e.nome })),
  };
}

module.exports = {
  isArquivada,
  aplicarFiltroArquivamento,
  apenasArquivadas,
  montarPatchArquivamentoEmpresa,
  resumirArquivadas,
};
