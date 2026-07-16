// backend/services/upgradeDomainService.js
// Frente #8-C (Billing v2 / Macrofrente 1) — regras PURAS de domínio do upgrade
// de plano. PR 1 (fundação). Sem I/O: não toca banco, não fala com o Asaas, não
// cria fatura, não aplica plano. Apenas DECIDE elegibilidade e MONTA payloads/
// snapshots — no mesmo estilo testável de paymentDomainService/planoLimiteService.
//
// Decisões de produto fechadas (Macrofrente 1):
//   * cobrança avulsa primeiro, sandbox apenas, sem assinatura recorrente agora;
//   * trial e ativo podem solicitar; o plano só muda após pagamento (PR 3);
//   * suspenso/expirado/bloqueado regularizam antes (nunca furam pendência);
//   * anti-downgrade: plano novo precisa custar MAIS que o atual;
//   * empresa sem plano atual pode escolher qualquer plano ativo pago;
//   * fatura/solicitação pendente não duplica (reaproveita mesmo plano; bloqueia
//     quando há upgrade pendente de outro plano).

// Estados que PODEM solicitar upgrade. Qualquer outro (suspenso, expirado,
// bloqueado, cancelado, desconhecido) cai em regularização — fail-closed.
const STATUS_ELEGIVEL = new Set(['trial', 'ativo']);

// Destino único de regularização (decisão de produto).
const REDIRECT_REGULARIZACAO = '/minhas-faturas';

// Payload amigável quando a conta precisa regularizar antes de qualquer upgrade.
function montarErroRegularizacao(status) {
  return {
    regularizacaoNecessaria: true,
    redirect: REDIRECT_REGULARIZACAO,
    status: status || null,
    message: 'Sua conta possui pendências. Regularize suas faturas antes de solicitar um upgrade.',
  };
}

// Payload amigável quando o plano escolhido é inválido para upgrade
// (inexistente, inativo, sem preço pago, igual ao atual ou não-superior).
function montarErroPlanoInvalido(message) {
  return {
    planoInvalido: true,
    message: message || 'Não foi possível solicitar o upgrade com o plano selecionado.',
  };
}

// Extrai o preço numérico do plano (ou NaN se ausente/ inválido).
function precoDe(plano) {
  return Number(plano && plano.preco_mensal);
}

// Decide se a empresa pode solicitar o upgrade para `planoNovo`.
// Retorna { elegivel, motivo, erro }. `erro` é null quando elegível; caso
// contrário é um payload amigável (regularização OU plano inválido).
//
// Parâmetros:
//   empresa    → { id, status }
//   planoAtual → { id, preco_mensal } | null   (null = empresa sem plano)
//   planoNovo  → { id, nome, preco_mensal, ativo }
function avaliarElegibilidadeUpgrade({ empresa, planoAtual, planoNovo }) {
  if (!empresa || !empresa.id) {
    return { elegivel: false, motivo: 'empresa_ausente', erro: montarErroPlanoInvalido('Empresa não identificada.') };
  }

  const status = empresa.status || null;

  // 1. Estado da conta: só trial/ativo seguem; o resto regulariza primeiro.
  if (!STATUS_ELEGIVEL.has(status)) {
    return { elegivel: false, motivo: `status_${status || 'desconhecido'}`, erro: montarErroRegularizacao(status) };
  }

  // 2. Plano novo precisa existir.
  if (!planoNovo || !planoNovo.id) {
    return { elegivel: false, motivo: 'plano_novo_ausente', erro: montarErroPlanoInvalido('Plano selecionado inválido.') };
  }

  // 3. Plano novo precisa estar ativo.
  if (planoNovo.ativo === false) {
    return { elegivel: false, motivo: 'plano_novo_inativo', erro: montarErroPlanoInvalido('Este plano não está disponível no momento.') };
  }

  // 4. Plano novo precisa ser um plano PAGO (preço > 0).
  const precoNovo = precoDe(planoNovo);
  if (!Number.isFinite(precoNovo) || precoNovo <= 0) {
    return { elegivel: false, motivo: 'plano_novo_sem_preco', erro: montarErroPlanoInvalido('O plano selecionado não é um plano pago válido.') };
  }

  const temPlanoAtual = Boolean(planoAtual && planoAtual.id);

  // 5. Plano novo não pode ser o mesmo do atual.
  if (temPlanoAtual && planoAtual.id === planoNovo.id) {
    return { elegivel: false, motivo: 'plano_igual_atual', erro: montarErroPlanoInvalido('Você já está neste plano.') };
  }

  // 6. Anti-downgrade: com plano atual, o novo precisa custar MAIS.
  //    Sem plano atual, qualquer plano ativo pago já é aceito (passos 2–4).
  if (temPlanoAtual) {
    const precoAtual = precoDe(planoAtual);
    if (!Number.isFinite(precoAtual)) {
      return { elegivel: false, motivo: 'plano_atual_sem_preco', erro: montarErroPlanoInvalido('Não foi possível comparar os planos. Tente novamente.') };
    }
    if (precoNovo <= precoAtual) {
      return { elegivel: false, motivo: 'nao_e_upgrade', erro: montarErroPlanoInvalido('O plano escolhido não é um upgrade. Selecione um plano superior ao seu plano atual.') };
    }
  }

  return { elegivel: true, motivo: 'ok', erro: null };
}

// Snapshot de auditoria (faturas não guardam plano). Congela valor e nome do
// plano novo no momento da solicitação.
function montarSnapshotUpgrade({ planoNovo }) {
  return {
    valor_snapshot: precoDe(planoNovo),
    plano_nome_snapshot: planoNovo && planoNovo.nome != null ? String(planoNovo.nome) : null,
  };
}

// Dado o eventual registro pendente da empresa, decide o que fazer:
//   * sem pendente            → { reutilizar:false, bloquear:false } (pode criar)
//   * pendente do MESMO plano → { reutilizar:true,  bloquear:false } (reaproveita)
//   * pendente de OUTRO plano → { reutilizar:false, bloquear:true }  (há upgrade
//     pendente; direcionar à regularização, não duplicar cobrança)
function deveReutilizarSolicitacaoPendente({ solicitacaoPendente, planoNovoId }) {
  if (!solicitacaoPendente || solicitacaoPendente.status !== 'pendente') {
    return { reutilizar: false, bloquear: false, motivo: 'sem_pendente' };
  }
  if (solicitacaoPendente.plano_novo_id === planoNovoId) {
    return { reutilizar: true, bloquear: false, motivo: 'mesmo_plano_pendente', solicitacao: solicitacaoPendente };
  }
  return { reutilizar: false, bloquear: true, motivo: 'outro_upgrade_pendente' };
}

// Monta a LINHA a inserir em solicitacoes_upgrade_plano. NÃO cria nada — só o
// objeto. fatura_id/asaas_payment_id ficam para o endpoint (PR 2) preencher
// após criar a cobrança. criado_em/atualizado_em usam DEFAULT do banco.
function montarPayloadSolicitacao({ empresa, planoAtual, planoNovo, criadoPor = null, clientRequestId = null }) {
  const snapshot = montarSnapshotUpgrade({ planoNovo });
  return {
    empresa_id: empresa.id,
    plano_atual_id: planoAtual && planoAtual.id ? planoAtual.id : null,
    plano_novo_id: planoNovo.id,
    status: 'pendente',
    valor_snapshot: snapshot.valor_snapshot,
    plano_nome_snapshot: snapshot.plano_nome_snapshot,
    client_request_id: clientRequestId || null,
    criado_por: criadoPor || null,
  };
}

module.exports = {
  STATUS_ELEGIVEL,
  REDIRECT_REGULARIZACAO,
  avaliarElegibilidadeUpgrade,
  montarSnapshotUpgrade,
  montarErroRegularizacao,
  montarErroPlanoInvalido,
  deveReutilizarSolicitacaoPendente,
  montarPayloadSolicitacao,
};
