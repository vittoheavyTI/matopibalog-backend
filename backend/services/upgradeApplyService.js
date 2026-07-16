// backend/services/upgradeApplyService.js
// Frente #8-C (Billing v2 / Macrofrente 1) — PR 3: aplica o plano quando a
// fatura de upgrade é paga. Chamado pelo webhook (asaasWebhookService) SOMENTE
// depois que a fatura já virou 'pago' e depois da transição de empresa.status.
//
// Injeção de supabase (service_role) para ser testável sem rede/DB. NÃO cria
// fatura, NÃO chama Asaas, NÃO altera limite_motoristas (derivado do plano_id),
// NÃO mexe em assinatura. Decisão de negócio vem de decidirAplicacaoUpgrade
// (pura). Aqui só há I/O e a ordem segura de escrita.
//
// Contrato de erro: falhas TÉCNICAS (DB) lançam Error com .dbError=true, para o
// webhook acionar seu retry (marcarFalhaERetentar). Decisões de NEGÓCIO nunca
// lançam — retornam { resultado, motivo } para log/telemetria.

const { decidirAplicacaoUpgrade } = require('./upgradeDomainService');

function erroDb(mensagem) {
  const e = new Error(mensagem);
  e.dbError = true;
  return e;
}

// Resolve a solicitação vinculada à fatura paga: por fatura_id (preferencial),
// com fallback por asaas_payment_id (cobre o caso do PR 2 ter criado o payment
// mas não completado o vínculo fatura_id).
async function buscarSolicitacaoVinculada(supabase, { faturaId, asaasPaymentId }) {
  const { data: porFatura, error: e1 } = await supabase
    .from('solicitacoes_upgrade_plano')
    .select('*')
    .eq('fatura_id', faturaId)
    .maybeSingle();
  if (e1) throw erroDb('erro_consulta_solicitacao');
  if (porFatura) return porFatura;

  if (!asaasPaymentId) return null;
  const { data: porPayment, error: e2 } = await supabase
    .from('solicitacoes_upgrade_plano')
    .select('*')
    .eq('asaas_payment_id', asaasPaymentId)
    .maybeSingle();
  if (e2) throw erroDb('erro_consulta_solicitacao');
  return porPayment || null;
}

// Aplica (ou não) o upgrade após pagamento confirmado da fatura.
// Retorna:
//   { resultado: 'sem_solicitacao' }                      — fatura comum; nada a fazer
//   { resultado: 'ignorado', motivo }                     — solicitação não-pendente (idempotente)
//   { resultado: 'falhou',   motivo }                     — inconsistência terminal; marcou 'falhou'
//   { resultado: 'aplicado', motivo, planoNovoId, empresaId } — plano aplicado + solicitação paga
// Lança (dbError) apenas em falha técnica → webhook faz retry.
async function aplicarUpgradePago({ supabase, faturaId, empresaId, asaasPaymentId }) {
  const solicitacao = await buscarSolicitacaoVinculada(supabase, { faturaId, asaasPaymentId });
  if (!solicitacao) return { resultado: 'sem_solicitacao' };

  // Carrega o plano de destino (para validar ativo/arquivado).
  let planoNovo = null;
  if (solicitacao.plano_novo_id) {
    const { data, error } = await supabase
      .from('planos')
      .select('id, ativo, arquivado_em')
      .eq('id', solicitacao.plano_novo_id)
      .maybeSingle();
    if (error) throw erroDb('erro_consulta_plano');
    planoNovo = data || null;
  }

  const decisao = decidirAplicacaoUpgrade({
    solicitacao,
    fatura: { empresa_id: empresaId, status: 'pago' },
    planoNovo,
  });

  if (decisao.acao === 'ignorar') {
    return { resultado: 'ignorado', motivo: decisao.motivo };
  }

  if (decisao.acao === 'falhar') {
    // Não aplica plano. Marca 'falhou' apenas se ainda pendente (CAS). A fatura
    // permanece paga — exige tratamento manual/operacional.
    const { error } = await supabase
      .from('solicitacoes_upgrade_plano')
      .update({ status: 'falhou', atualizado_em: new Date().toISOString() })
      .eq('id', solicitacao.id)
      .eq('status', 'pendente');
    if (error) throw erroDb('erro_marcar_falhou');
    return { resultado: 'falhou', motivo: decisao.motivo };
  }

  // acao === 'aplicar'. ORDEM SEGURA: plano_id ANTES de marcar a solicitação
  // paga — assim um crash intermediário nunca "perde" a aplicação (o retry
  // reaplica idempotente enquanto a solicitação segue pendente).
  const { error: eEmpresa } = await supabase
    .from('empresas')
    .update({ plano_id: decisao.planoNovoId })
    .eq('id', empresaId);
  if (eEmpresa) throw erroDb('erro_aplicar_plano');

  const { error: eSolic } = await supabase
    .from('solicitacoes_upgrade_plano')
    .update({ status: 'pago', pago_em: new Date().toISOString(), atualizado_em: new Date().toISOString() })
    .eq('id', solicitacao.id)
    .eq('status', 'pendente');
  if (eSolic) throw erroDb('erro_marcar_pago');

  return { resultado: 'aplicado', motivo: 'ok', planoNovoId: decisao.planoNovoId, empresaId };
}

module.exports = {
  aplicarUpgradePago,
  buscarSolicitacaoVinculada,
};
