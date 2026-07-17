// backend/services/upgradeRequestService.js
// Frente #8-C (Billing v2 / Macrofrente 1) — PR 2: orquestração da SOLICITAÇÃO
// de upgrade + criação de cobrança avulsa (sandbox) + fatura local.
//
// Injeção de dependências (supabase, http, config) para ser testável sem tocar
// rede/DB — mesmo estilo de asaasSubscriptionService. NÃO aplica plano (isso é o
// PR 3, via webhook); NÃO altera empresas.plano_id; NÃO mexe em limite de
// motoristas, assinatura recorrente ou webhook. O gate de sandbox
// (bloquearSeNaoSandbox) fica na rota, ANTES de chamar este serviço.
//
// Regras de domínio vêm de upgradeDomainService (puro). Aqui só há I/O e a
// coreografia idempotente: solicitação pendente → cobrança Asaas → fatura →
// vínculo. Falhas retornam erro com httpStatus + body amigável (a rota mapeia).

const { randomUUID } = require('crypto');
const {
  avaliarElegibilidadeUpgrade,
  deveReutilizarSolicitacaoPendente,
  montarPayloadSolicitacao,
} = require('./upgradeDomainService');
const { normalizarStatusAsaas } = require('./paymentDomainService');
const { garantirCustomer } = require('./asaasSubscriptionService');
const { plano_idValido } = require('../utils/plano');

// MVP: apenas PIX (decisão de produto).
const TIPO_PAGAMENTO = 'PIX';

// Erro com contrato HTTP: httpStatus + body (JSON amigável ao frontend).
function erroHttp(httpStatus, body) {
  const corpo = typeof body === 'string' ? { message: body } : body;
  const e = new Error(corpo.message || 'Erro ao solicitar upgrade.');
  e.httpStatus = httpStatus;
  e.body = corpo;
  return e;
}

function headersAsaas(apiKey) {
  return { access_token: apiKey, 'Content-Type': 'application/json' };
}

// PIX copia-e-cola (best-effort, igual POST /cobrancas): o Asaas não devolve o
// QR na criação. Falha aqui não invalida a cobrança.
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

function planoDe(empresa) {
  const p = empresa.planos;
  return Array.isArray(p) ? (p[0] || null) : (p || null);
}

async function carregarFatura(supabase, faturaId) {
  if (!faturaId) return null;
  const { data } = await supabase.from('faturas').select('*').eq('id', faturaId).maybeSingle();
  return data || null;
}

// Vencimento: hoje + 7 dias (mesmo padrão de POST /cobrancas).
function dueDatePadrao(referencia = new Date()) {
  return new Date(referencia.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Snapshot da composição do preço, CONGELADO no momento da cobrança (migration
// 030). Puro: só transforma o plano em colunas. Não decide valor — `valor` é e
// continua sendo preco_mensal.
//
// Por que congelar: editar o plano depois NÃO reescreve estas colunas. Sem elas,
// responder "por que esta fatura foi R$ 1.000,00?" exigiria reconstruir a conta a
// partir do plano de HOJE — que pode ter outro preço, outra quantidade, ou nem
// existir mais.
//
// Em plano fixo, unitário e quantidade ficam NULL: não houve conta, o valor foi
// digitado. NULL aqui significa "não se aplica", não "esqueceram de preencher".
function montarSnapshotFatura(planoNovo) {
  const p = planoNovo || {};
  const porMotorista = p.modelo_cobranca === 'por_motorista';
  return {
    plano_id: p.id || null,
    plano_nome_snapshot: p.nome != null ? String(p.nome) : null,
    modelo_cobranca_snapshot: porMotorista ? 'por_motorista' : 'fixo',
    preco_unitario_snapshot:
      porMotorista && p.preco_por_motorista != null ? Number(p.preco_por_motorista) : null,
    quantidade_snapshot:
      porMotorista && p.limite_motoristas != null ? Number(p.limite_motoristas) : null,
  };
}

function montarResultado(solicitacao, fatura, idempotente) {
  return {
    solicitacao_id: solicitacao.id,
    status: solicitacao.status || 'pendente',
    fatura: fatura
      ? {
          id: fatura.id,
          valor: Number(fatura.valor),
          tipo_pagamento: fatura.tipo_pagamento,
          status: fatura.status,
          invoice_url: fatura.invoice_url || null,
          pix_qr_code: fatura.pix_qr_code || null,
          due_date: fatura.due_date || null,
        }
      : null,
    redirect: '/minhas-faturas',
    idempotente: Boolean(idempotente),
  };
}

// Cria a cobrança no Asaas (avulsa, sandbox) + a fatura local, e vincula à
// solicitação. Idempotente por faturas.client_request_id. Reaproveita a fatura
// existente em caso de corrida (23505). Retorna a fatura.
async function criarCobrancaEFatura({ solicitacao, empresa, planoNovo, clientRequestId, config, supabase, http }) {
  const valor = Number(planoNovo.preco_mensal);
  const dueDate = dueDatePadrao();

  // 1. Garante o cliente Asaas (reusa/cria). Cadastro incompleto → erro 400 do
  //    próprio garantirCustomer (tem httpStatus).
  let customerId = empresa.asaas_customer_id;
  if (!customerId) {
    const resCustomer = await garantirCustomer(empresa, { config, supabase, http });
    customerId = resCustomer.customerId;
  }

  // 2. Cria o payment no Asaas (PIX). externalReference = solicitacao.id.
  let payment;
  try {
    const { data } = await http.post(
      `${config.baseURL}/payments`,
      {
        customer: customerId,
        value: valor,
        description: `Upgrade de plano — ${planoNovo.nome}`,
        dueDate,
        postalService: false,
        billingType: 'PIX',
        externalReference: solicitacao.id,
      },
      { headers: headersAsaas(config.apiKey) }
    );
    payment = data;
  } catch (_) {
    throw erroHttp(502, 'Não foi possível criar a cobrança no Asaas. Tente novamente em instantes.');
  }

  // 3. Vincula o asaas_payment_id à solicitação IMEDIATAMENTE (chave de fallback
  //    para o webhook do PR 3, caso o vínculo da fatura não complete).
  await supabase
    .from('solicitacoes_upgrade_plano')
    .update({ asaas_payment_id: payment.id, atualizado_em: new Date().toISOString() })
    .eq('id', solicitacao.id);

  // 4. Insere a fatura local (idempotente por client_request_id).
  const statusInterno = normalizarStatusAsaas(payment.status).status;
  const pixQrCode = await obterPixQrCode(http, config, payment.id);
  const novaFatura = {
    empresa_id: empresa.id,
    asaas_id: payment.id,
    valor,
    tipo_pagamento: TIPO_PAGAMENTO,
    status: statusInterno,
    invoice_url: payment.invoiceUrl,
    pix_qr_code: pixQrCode,
    due_date: dueDate,
    client_request_id: clientRequestId,
    // Rastreabilidade (migration 030). Este é o único caminho de fatura cujo
    // valor DERIVA de um plano — por isso é o único que recebe snapshot. A
    // cobrança avulsa manual (valor vem do req.body) e a importação do Asaas
    // (valor vem do payment.value) não derivam de precificação: gravar snapshot
    // nelas seria inventar uma proveniência que não existe.
    ...montarSnapshotFatura(planoNovo),
  };

  let fatura;
  const { data: inserida, error: insErr } = await supabase
    .from('faturas')
    .insert(novaFatura)
    .select()
    .single();
  if (insErr) {
    if (insErr.code === '23505') {
      const { data: jaExiste } = await supabase
        .from('faturas')
        .select('*')
        .eq('client_request_id', clientRequestId)
        .maybeSingle();
      if (!jaExiste) throw erroHttp(500, 'Erro ao registrar a fatura de upgrade.');
      fatura = jaExiste;
    } else {
      throw erroHttp(500, 'Erro ao registrar a fatura de upgrade.');
    }
  } else {
    fatura = inserida;
  }

  // 5. Vincula fatura_id (+ reforça asaas_payment_id) na solicitação.
  await supabase
    .from('solicitacoes_upgrade_plano')
    .update({ fatura_id: fatura.id, asaas_payment_id: payment.id, atualizado_em: new Date().toISOString() })
    .eq('id', solicitacao.id);

  return fatura;
}

// Ponto de entrada. Retorna { httpStatus, resultado } em sucesso/idempotência.
// Lança erroHttp (httpStatus + body) em falhas de validação/negócio/Asaas.
async function solicitarUpgrade({
  empresaId,
  planoNovoId,
  criadoPor = null,
  clientRequestId,
  config,
  supabase,
  http,
}) {
  if (!empresaId) throw erroHttp(400, 'Empresa não identificada.');
  if (!plano_idValido(planoNovoId)) {
    throw erroHttp(400, { planoInvalido: true, message: 'Plano selecionado inválido.' });
  }
  const crid = (clientRequestId && String(clientRequestId).trim()) || randomUUID();

  // 1. Empresa + plano atual (join) + dados para o cliente Asaas.
  const { data: empresa, error: empErr } = await supabase
    .from('empresas')
    .select('id, status, plano_id, asaas_customer_id, nome, cnpj, email_contato, telefone_contato, planos(id, nome, preco_mensal)')
    .eq('id', empresaId)
    .single();
  if (empErr || !empresa) throw erroHttp(404, 'Empresa não encontrada.');
  const planoAtual = planoDe(empresa);

  // 2. Plano novo (destino). Os três campos de composição são lidos só para o
  //    SNAPSHOT da fatura (migration 030) — o valor cobrado continua vindo de
  //    preco_mensal, que o backend já derivou ao salvar o plano.
  const { data: planoNovo, error: pnErr } = await supabase
    .from('planos')
    .select('id, nome, preco_mensal, ativo, modelo_cobranca, preco_por_motorista, limite_motoristas')
    .eq('id', planoNovoId)
    .maybeSingle();
  if (pnErr) throw erroHttp(500, 'Erro ao carregar o plano selecionado.');

  // 3. Elegibilidade (domínio puro). Regularização → 409; plano inválido → 422.
  const eleg = avaliarElegibilidadeUpgrade({
    empresa: { id: empresa.id, status: empresa.status },
    planoAtual,
    planoNovo,
  });
  if (!eleg.elegivel) {
    const httpStatus = eleg.erro.regularizacaoNecessaria ? 409 : 422;
    throw erroHttp(httpStatus, eleg.erro);
  }

  // 4. Solicitação pendente existente?
  const { data: pendentes, error: pendErr } = await supabase
    .from('solicitacoes_upgrade_plano')
    .select('*')
    .eq('empresa_id', empresaId)
    .eq('status', 'pendente');
  if (pendErr) throw erroHttp(500, 'Erro ao consultar solicitações de upgrade.');

  const decisao = deveReutilizarSolicitacaoPendente({
    solicitacaoPendente: (pendentes && pendentes[0]) || null,
    planoNovoId,
  });

  if (decisao.bloquear) {
    throw erroHttp(409, {
      upgradePendente: true,
      redirect: '/minhas-faturas',
      message: 'Você já tem uma solicitação de upgrade pendente. Conclua ou regularize antes de solicitar outra.',
    });
  }

  let solicitacao;
  if (decisao.reutilizar) {
    solicitacao = decisao.solicitacao;
    // Já tem fatura → idempotente (200). Sem fatura (falha anterior) → recupera
    // criando a cobrança abaixo, reusando a MESMA solicitação.
    if (solicitacao.fatura_id) {
      const fatura = await carregarFatura(supabase, solicitacao.fatura_id);
      return { httpStatus: 200, resultado: montarResultado(solicitacao, fatura, true) };
    }
  } else {
    // 5. Cria a solicitação pendente.
    const payload = montarPayloadSolicitacao({ empresa, planoAtual, planoNovo, criadoPor, clientRequestId: crid });
    const { data: nova, error: solErr } = await supabase
      .from('solicitacoes_upgrade_plano')
      .insert(payload)
      .select()
      .single();
    if (solErr) {
      // Corrida: já existe pendente (empresa,plano) ou client_request_id.
      if (solErr.code === '23505') {
        const { data: existente } = await supabase
          .from('solicitacoes_upgrade_plano')
          .select('*')
          .eq('empresa_id', empresaId)
          .eq('plano_novo_id', planoNovoId)
          .eq('status', 'pendente')
          .maybeSingle();
        if (!existente) throw erroHttp(409, 'Já existe uma solicitação de upgrade em processamento.');
        solicitacao = existente;
        if (existente.fatura_id) {
          const fatura = await carregarFatura(supabase, existente.fatura_id);
          return { httpStatus: 200, resultado: montarResultado(existente, fatura, true) };
        }
      } else {
        throw erroHttp(500, 'Erro ao criar a solicitação de upgrade.');
      }
    } else {
      solicitacao = nova;
    }
  }

  // 6. Cria a cobrança avulsa + fatura e vincula (idempotente por client_request_id).
  const fatura = await criarCobrancaEFatura({
    solicitacao,
    empresa,
    planoNovo,
    clientRequestId: crid,
    config,
    supabase,
    http,
  });

  const solicitacaoFinal = { ...solicitacao, fatura_id: fatura.id };
  return { httpStatus: 201, resultado: montarResultado(solicitacaoFinal, fatura, false) };
}

module.exports = {
  solicitarUpgrade,
  // exportados para teste isolado
  criarCobrancaEFatura,
  dueDatePadrao,
  montarResultado,
  montarSnapshotFatura,
};
