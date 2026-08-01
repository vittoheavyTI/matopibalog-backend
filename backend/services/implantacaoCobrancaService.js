const {
  ORIGEM_IMPLANTACAO,
  montarPayloadImplantacao,
} = require('./implantacaoDomainService');
const { deveCriarFaturaImplantacao } = require('./contratacaoComercialDomainService');
const { garantirCustomer } = require('./asaasSubscriptionService');
const { buscarPaymentPorReferencia } = require('./faturaRecorrenteService');
const { normalizarStatusAsaas } = require('./paymentDomainService');

const MSG_SANDBOX_OBRIGATORIO = 'Cobrancas reais estao desabilitadas neste ambiente. Use Asaas sandbox.';

function headersAsaas(apiKey) {
  return { access_token: apiKey, 'Content-Type': 'application/json' };
}

function erroServico(motivo, status = 500, recuperavel = false) {
  const e = new Error(motivo);
  e.motivo = motivo;
  e.status = status;
  e.recuperavel = recuperavel;
  return e;
}

function validarSandboxImplantacao(config) {
  if (!config || config.environment !== 'sandbox') {
    throw erroServico('sandbox_obrigatorio', 403, false);
  }
}

function propostaSnapshot(proposta) {
  return proposta && proposta.snapshot ? proposta.snapshot : proposta;
}

function planoSnapshotDe(proposta) {
  const s = propostaSnapshot(proposta) || {};
  return {
    id: s.plano_id || null,
    nome: s.plano_nome || s.plano_nome_snapshot || 'Plano contratado',
  };
}

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

async function carregarEmpresa(supabase, empresaId) {
  const { data, error } = await supabase
    .from('empresas')
    .select('id, status, asaas_customer_id, plano_id, nome, cnpj, email_contato, telefone_contato')
    .eq('id', empresaId)
    .maybeSingle();
  if (error) throw erroServico('erro_consulta_empresa');
  return data || null;
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

async function criarPaymentImplantacao({ http, config, customerId, valor, dueDate, clientRequestId, planoNome }) {
  try {
    const { data } = await http.post(
      `${config.baseURL}/payments`,
      {
        customer: customerId,
        value: valor,
        description: `Implantacao Matopiba Log - ${planoNome || 'plano contratado'}`,
        dueDate,
        postalService: false,
        billingType: 'PIX',
        externalReference: clientRequestId,
      },
      { headers: headersAsaas(config.apiKey) }
    );
    return data;
  } catch (_) {
    throw erroServico('falha_criar_cobranca_implantacao', 502, true);
  }
}

async function completarFaturaComPayment({ supabase, http, config, faturaId, payment }) {
  const pixQrCode = await obterPixQrCode(http, config, payment.id);
  const patch = {
    asaas_id: payment.id,
    status: normalizarStatusAsaas(payment.status).status,
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
  if (error) throw erroServico('erro_atualizar_fatura_implantacao', 500, true);
  return data;
}

async function criarReservaFaturaImplantacao({ supabase, empresa, proposta, dueDate }) {
  const snapshot = propostaSnapshot(proposta);
  const plano = planoSnapshotDe(proposta);
  const payload = montarPayloadImplantacao({
    empresa,
    plano,
    valor: Number(snapshot.valor_implantacao),
    dueDate,
  });

  const existente = await buscarFaturaPorClientRequestId(supabase, payload.client_request_id);
  if (existente) return { fatura: existente, idempotente: true, payload };

  const { data, error } = await supabase
    .from('faturas')
    .insert(payload)
    .select()
    .single();
  if (error) {
    if (error.code === '23505') {
      const corrida = await buscarFaturaPorClientRequestId(supabase, payload.client_request_id);
      if (corrida) return { fatura: corrida, idempotente: true, payload };
    }
    throw erroServico('erro_reservar_fatura_implantacao', 500, true);
  }
  return { fatura: data, idempotente: false, payload };
}

async function criarCobrancaImplantacaoPositiva({
  supabase,
  http,
  config,
  empresaId,
  empresa,
  proposta,
  dueDate = hojeISO(),
} = {}) {
  const snapshot = propostaSnapshot(proposta);
  const decisao = deveCriarFaturaImplantacao(snapshot);
  if (!decisao.criar) {
    return { resultado: 'pulada', motivo: decisao.motivo, origem: ORIGEM_IMPLANTACAO };
  }

  validarSandboxImplantacao(config);

  const empresaRow = empresa || await carregarEmpresa(supabase, empresaId);
  if (!empresaRow || !empresaRow.id) throw erroServico('empresa_ausente', 404);

  const reserva = await criarReservaFaturaImplantacao({
    supabase,
    empresa: empresaRow,
    proposta: snapshot,
    dueDate,
  });

  if (reserva.fatura.asaas_id) {
    return {
      resultado: 'idempotente',
      motivo: 'fatura_implantacao_existente',
      fatura: reserva.fatura,
      origem: ORIGEM_IMPLANTACAO,
    };
  }

  let payment = await buscarPaymentPorReferencia(http, config, reserva.fatura.client_request_id);
  if (!payment) {
    const { customerId } = await garantirCustomer(empresaRow, { config, supabase, http });
    payment = await criarPaymentImplantacao({
      http,
      config,
      customerId,
      valor: Number(snapshot.valor_implantacao),
      dueDate,
      clientRequestId: reserva.fatura.client_request_id,
      planoNome: snapshot.plano_nome,
    });
  }

  const fatura = await completarFaturaComPayment({
    supabase,
    http,
    config,
    faturaId: reserva.fatura.id,
    payment,
  });

  return {
    resultado: reserva.idempotente ? 'idempotente' : 'gerada',
    motivo: 'implantacao_positiva_autorizada',
    fatura,
    origem: ORIGEM_IMPLANTACAO,
  };
}

module.exports = {
  MSG_SANDBOX_OBRIGATORIO,
  validarSandboxImplantacao,
  criarCobrancaImplantacaoPositiva,
  criarReservaFaturaImplantacao,
};
