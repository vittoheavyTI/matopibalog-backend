// backend/services/regularizacaoService.js
// Macrofrente fluxo financeiro — I/O da FATURA DE REGULARIZAÇÃO (sandbox).
// A decisão vem inteira do domínio puro (regularizacaoDomainService). Aqui mora
// a coreografia segura contra duplicidade, ESPELHO da recorrência
// (faturaRecorrenteService): reserva-primeiro (fatura local sem asaas_id,
// ancorada no índice único de client_request_id da migration 021) e
// reconciliação por externalReference antes de criar cobrança no Asaas.
// Cobrança é sempre AVULSA PIX; NÃO cria assinatura; NÃO toca webhook.
//
// O gate hard de sandbox (bloquearSeNaoSandbox) fica na ROTA, antes de chamar
// este serviço — mesma disciplina das demais frentes de billing.

const {
  MOTIVOS_REG,
  avaliarElegibilidadeRegularizacao,
  montarPayloadFaturaRegularizacao,
} = require('./regularizacaoDomainService');
const { garantirCustomer } = require('./asaasSubscriptionService');
const { buscarPaymentPorReferencia } = require('./faturaRecorrenteService');
const { normalizarStatusAsaas } = require('./paymentDomainService');
const { podeCriarCobranca, MOTIVO_CADASTRO_INCOMPLETO } = require('../utils/cadastroAsaas');

function headersAsaas(apiKey) {
  return { access_token: apiKey, 'Content-Type': 'application/json' };
}

function erroServico(motivo, recuperavel = false) {
  const e = new Error(motivo);
  e.motivo = motivo;
  e.recuperavel = recuperavel;
  return e;
}

// Colunas da empresa: elegibilidade + metadados de suspensão + o que
// garantirCustomer precisa. Plano no join, formato do domínio.
const SELECT_EMPRESA_REGULARIZACAO =
  'id, status, trial_ends_at, suspension_reason, suspension_source, ' +
  'asaas_customer_id, asaas_subscription_id, plano_id, nome, cnpj, email_contato, telefone_contato, ' +
  'planos(id, nome, ativo, arquivado_em, preco_mensal, modelo_cobranca, preco_por_motorista, limite_motoristas)';

function planoDe(empresa) {
  const p = empresa && empresa.planos;
  return Array.isArray(p) ? (p[0] || null) : (p || null);
}

async function carregarEmpresa(supabase, empresaId) {
  const { data, error } = await supabase
    .from('empresas')
    .select(SELECT_EMPRESA_REGULARIZACAO)
    .eq('id', empresaId)
    .maybeSingle();
  if (error) throw erroServico('erro_consulta_empresa');
  return data || null;
}

// Faturas da empresa relevantes para o dedupe: as ABERTAS (qualquer origem) e as
// já criadas por este fluxo (para o retry reconciliar reserva sem asaas_id).
async function carregarFaturasEmpresa(supabase, empresaId) {
  const { data, error } = await supabase
    .from('faturas')
    .select('id, status, due_date, origem, client_request_id, asaas_id, valor, tipo_pagamento, invoice_url, bank_slip_url, periodo_referencia, pago_em, plano_nome_snapshot, modelo_cobranca_snapshot, created_at')
    .eq('empresa_id', empresaId)
    .in('status', ['pendente', 'vencido']);
  if (error) throw erroServico('erro_consulta_faturas');
  return data || [];
}

async function buscarFaturaPorClientRequestId(supabase, clientRequestId) {
  const { data, error } = await supabase
    .from('faturas')
    .select('*')
    .eq('client_request_id', clientRequestId)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw erroServico('erro_consulta_fatura');
  return data || null;
}

async function obterPixQrCode(http, config, paymentId) {
  try {
    const { data } = await http.get(
      `${config.baseURL}/payments/${paymentId}/pixQrCode`,
      { headers: headersAsaas(config.apiKey) }
    );
    return (data && data.payload) || null;
  } catch (_) {
    return null;
  }
}

async function criarPaymentAsaas({ http, config, customerId, payload, planoNome }) {
  try {
    const { data } = await http.post(
      `${config.baseURL}/payments`,
      {
        customer: customerId,
        value: payload.valor,
        description: `Regularização Matopiba Log — ${planoNome || 'plano'} — competência ${payload.periodo_referencia}`,
        dueDate: payload.due_date,
        postalService: false,
        billingType: 'PIX',
        externalReference: payload.client_request_id,
      },
      { headers: headersAsaas(config.apiKey) }
    );
    return data;
  } catch (_) {
    // Recuperável: a reserva local (sem asaas_id) fica para o retry reconciliar.
    throw erroServico('falha_criar_cobranca_asaas', true);
  }
}

async function completarFaturaComPayment({ supabase, http, config, faturaId, payment }) {
  const statusInterno = normalizarStatusAsaas(payment.status).status;
  const pixQrCode = await obterPixQrCode(http, config, payment.id);
  const patch = {
    asaas_id: payment.id,
    status: statusInterno,
    invoice_url: payment.invoiceUrl || null,
    bank_slip_url: payment.bankSlipUrl || null,
  };
  if (pixQrCode) patch.pix_qr_code = pixQrCode;

  const { data, error } = await supabase
    .from('faturas')
    .update(patch)
    .eq('id', faturaId)
    .select()
    .single();
  if (error) throw erroServico('erro_atualizar_fatura', true);
  return data;
}

async function garantirCobrancaParaReserva({ supabase, http, config, empresa, plano, fatura, payload }) {
  let payment = await buscarPaymentPorReferencia(http, config, fatura.client_request_id);
  if (!payment) {
    const { customerId } = await garantirCustomer(empresa, { config, supabase, http });
    payment = await criarPaymentAsaas({ http, config, customerId, payload, planoNome: plano && plano.nome });
  }
  return completarFaturaComPayment({ supabase, http, config, faturaId: fatura.id, payment });
}

// Gerar a fatura de regularização é a afirmação formal de que a pendência da
// suspensão é FINANCEIRA. Suspensão manual sem motivo (reason NULL) é
// normalizada para 'financial' NESTE momento — sem isso, o pagamento não
// reativaria a conta (paymentDomainService exige reason='financial').
// source é preservado; status NÃO muda aqui (só o webhook/pagamento muda).
async function normalizarSuspensaoFinanceira(supabase, empresa) {
  if (empresa.status !== 'suspenso') return;
  if (empresa.suspension_reason === 'financial') return;
  const { error } = await supabase
    .from('empresas')
    .update({ suspension_reason: 'financial' })
    .eq('id', empresa.id);
  if (error) throw erroServico('erro_normalizar_suspensao', true);
}

// Ponto de entrada. Retorna { resultado, motivo, periodo, fatura? }:
//   'gerada'        → fatura criada (ou reserva reconciliada) com cobrança;
//   'idempotente'   → regularização do mês já existia com cobrança;
//   'fatura_aberta' → já havia fatura aberta — devolvida, nada criado;
//   'pulada'        → domínio decidiu não cobrar (motivo);
//   'erro'          → falha (recuperável ou não), nenhuma segunda cobrança.
async function gerarFaturaRegularizacao({ supabase, http, config, empresaId, dataReferencia = new Date(), agora = new Date() }) {
  const empresa = await carregarEmpresa(supabase, empresaId);
  if (!empresa) return { resultado: 'erro', motivo: 'empresa_nao_encontrada', periodo: null };

  const plano = planoDe(empresa);
  const faturasAbertas = await carregarFaturasEmpresa(supabase, empresa.id);

  const decisao = avaliarElegibilidadeRegularizacao({
    empresa,
    plano,
    faturasExistentes: faturasAbertas,
    dataReferencia,
    agora,
  });

  if (decisao.resultado !== 'cobrar' && decisao.resultado !== 'fatura_aberta') {
    return { resultado: decisao.resultado === 'erro' ? 'erro' : 'pulada', motivo: decisao.motivo, periodo: decisao.periodo };
  }

  // Só chega aqui com pendência financeira confirmada pelo domínio (trial
  // vencido ou suspensão financeira/sem motivo). Normaliza ANTES de qualquer
  // Asaas para que o pagamento da fatura (nova OU a já aberta) reative a conta
  // mesmo se um passo posterior falhar e for reconciliado num retry.
  await normalizarSuspensaoFinanceira(supabase, empresa);

  if (decisao.resultado === 'fatura_aberta') {
    return { resultado: 'fatura_aberta', motivo: decisao.motivo, periodo: decisao.periodo, fatura: decisao.faturaAberta };
  }

  // PRÉ-VALIDAÇÃO DO CADASTRO ANTES DA RESERVA: sem nome+CPF/CNPJ+e-mail não
  // há como criar o customer no Asaas — e a reserva viraria fatura local órfã
  // (sem asaas_id, impagável). Fail-closed: nenhum insert, nenhuma cobrança.
  // Com asaas_customer_id existente a checagem não se aplica.
  const cadastro = podeCriarCobranca(empresa);
  if (!cadastro.ok) {
    return {
      resultado: 'pulada',
      motivo: MOTIVO_CADASTRO_INCOMPLETO,
      periodo: decisao.periodo,
      camposFaltantes: cadastro.camposFaltantes,
    };
  }

  const payload = montarPayloadFaturaRegularizacao({ empresa, plano, dataReferencia });

  // Reserva-primeiro: insere a fatura local SEM asaas_id. O índice único de
  // client_request_id (021) segura corrida/duplo clique: 23505 → recupera.
  let reserva;
  const { data: inserida, error: insErr } = await supabase
    .from('faturas')
    .insert({ ...payload, asaas_id: null })
    .select()
    .single();

  if (insErr) {
    if (insErr.code === '23505') {
      const existente = await buscarFaturaPorClientRequestId(supabase, payload.client_request_id);
      if (!existente) throw erroServico('erro_reserva_fatura', true);
      if (existente.asaas_id) {
        return { resultado: 'idempotente', motivo: 'regularizacao_ja_existe', periodo: decisao.periodo, fatura: existente };
      }
      reserva = existente;
    } else {
      throw erroServico('erro_reserva_fatura');
    }
  } else {
    reserva = inserida;
  }

  const fatura = await garantirCobrancaParaReserva({ supabase, http, config, empresa, plano, fatura: reserva, payload });

  return { resultado: 'gerada', motivo: MOTIVOS_REG.OK, periodo: decisao.periodo, fatura };
}

module.exports = {
  gerarFaturaRegularizacao,
  SELECT_EMPRESA_REGULARIZACAO,
  // exportados para teste isolado
  carregarFaturasEmpresa,
  normalizarSuspensaoFinanceira,
};
