// backend/services/asaasSubscriptionService.js
// Serviço de ASSINATURA Asaas (piloto sandbox — BLOCO 3).
//
// Injeção de dependências (supabase, http, config) para ser 100% testável sem
// tocar rede/DB. NÃO loga nem retorna: apiKey, Authorization, CPF/CNPJ, e-mail,
// telefone ou a resposta bruta do Asaas. O gate de ambiente (sandbox) fica na
// rota (bloquearSeNaoSandbox), ANTES de chamar este serviço.
//
// O backend é a autoridade sobre plano, preço, ciclo, primeiro vencimento,
// conta, cliente e assinatura. O frontend nunca envia valor nem vencimento.

// Estados locais de billing (empresas.billing_status). NÃO usar 'pago'/'vencido'
// (isso pertence às cobranças/faturas).
const BILLING = {
  NAO_CONFIGURADO: 'nao_configurado',
  SEM_PLANO: 'sem_plano',
  ISENTO: 'isento',
  PENDENTE_CLIENTE: 'pendente_cliente',
  PENDENTE_ASSINATURA: 'pendente_assinatura',
  ATIVO: 'ativo',
  ERRO: 'erro',
  INATIVO: 'inativo',
};

function soDigitos(v) { return String(v == null ? '' : v).replace(/\D+/g, ''); }
function emailValido(v) { return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()); }

// Primeiro vencimento da assinatura:
//   - trial_ends_at, se for uma data FUTURA;
//   - caso contrário (ausente, inválida, hoje ou já vencida): hoje + 7 dias.
// Nunca retroativo. Cálculo em UTC a partir de uma referência única (fuso
// consistente). Exportado para teste isolado.
function calcularPrimeiroVencimento(trialEndsAt, referencia = new Date()) {
  const hojeStr = referencia.toISOString().slice(0, 10);
  if (trialEndsAt) {
    const d = new Date(trialEndsAt);
    if (!isNaN(d.getTime())) {
      const trialStr = d.toISOString().slice(0, 10);
      if (trialStr > hojeStr) return trialStr; // estritamente futuro
    }
  }
  return new Date(referencia.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function headers(apiKey) {
  return { access_token: apiKey, 'Content-Type': 'application/json' };
}

// Erro amigável a partir de falha do Asaas — sem vazar segredo/payload.
function erroAsaas(err, mensagem) {
  const status = err && err.response && err.response.status;
  const e = new Error(mensagem || 'Falha ao comunicar com o Asaas.');
  e.httpStatus = status && status >= 400 && status < 500 ? 422 : 500;
  return e;
}

function falha(httpStatus, message) {
  const e = new Error(message);
  e.httpStatus = httpStatus;
  return e;
}

function resultado(empresaId, billing_status, subscription_configured, next_due_date, created_customer, created_subscription, mensagem) {
  return {
    empresa_id: empresaId,
    billing_status,
    subscription_configured,
    next_due_date: next_due_date || null,
    created_customer: Boolean(created_customer),
    created_subscription: Boolean(created_subscription),
    mensagem,
  };
}

async function persistBilling(supabase, empresaId, patch) {
  await supabase.from('empresas').update({
    ...patch,
    billing_updated_at: new Date().toISOString(),
  }).eq('id', empresaId);
}

async function carregarEmpresa(supabase, empresaId) {
  const { data, error } = await supabase
    .from('empresas')
    .select('id, nome, cnpj, email_contato, telefone_contato, tipo, status, trial_ends_at, plano_id, asaas_customer_id, asaas_subscription_id, billing_status, next_due_date, planos(nome, preco_mensal, billing_cycle)')
    .eq('id', empresaId)
    .single();
  if (error || !data) throw falha(404, 'Conta não encontrada.');
  return data;
}

function planoDe(empresa) {
  const p = empresa.planos;
  return Array.isArray(p) ? p[0] : p;
}

function statusUtilizavel(sub) {
  return Boolean(sub) && String(sub.status || '').toUpperCase() === 'ACTIVE';
}

// Consulta assinatura por id. 404 → null (id local órfão). Outros erros → traduzido.
async function buscarAssinatura(http, config, subscriptionId) {
  try {
    const { data } = await http.get(`${config.baseURL}/subscriptions/${subscriptionId}`, { headers: headers(config.apiKey) });
    return data || null;
  } catch (err) {
    if (err && err.response && err.response.status === 404) return null;
    throw erroAsaas(err, 'Falha ao consultar assinatura no Asaas.');
  }
}

// Reconciliação: procura assinatura pela referência estável (empresa_id).
async function buscarAssinaturaPorReferencia(http, config, empresaId) {
  try {
    const { data } = await http.get(`${config.baseURL}/subscriptions`, {
      headers: headers(config.apiKey),
      params: { externalReference: empresaId },
    });
    const lista = (data && data.data) || [];
    return lista[0] || null;
  } catch (err) {
    throw erroAsaas(err, 'Falha ao buscar assinatura no Asaas.');
  }
}

// Garante o cliente Asaas: reusa asaas_customer_id se houver; senão valida o
// cadastro e cria, salvando o id IMEDIATAMENTE (sem rollback do customer externo).
async function garantirCustomer(empresa, { config, supabase, http }) {
  if (empresa.asaas_customer_id) return { customerId: empresa.asaas_customer_id, created: false };

  const nome = typeof empresa.nome === 'string' ? empresa.nome.trim() : '';
  const doc = soDigitos(empresa.cnpj);
  const email = typeof empresa.email_contato === 'string' ? empresa.email_contato.trim() : '';
  if (!nome || (doc.length !== 11 && doc.length !== 14) || !emailValido(email)) {
    await persistBilling(supabase, empresa.id, { billing_status: BILLING.PENDENTE_CLIENTE, billing_last_error: 'cadastro incompleto' });
    throw falha(400, 'Cadastro incompleto: informe nome, CPF/CNPJ e e-mail válidos em Empresas.');
  }

  const payload = { name: nome, cpfCnpj: doc, email, notificationDisabled: false };
  const tel = soDigitos(empresa.telefone_contato);
  if (tel.length === 10 || tel.length === 11) payload.phone = tel;

  let criado;
  try {
    const { data } = await http.post(`${config.baseURL}/customers`, payload, { headers: headers(config.apiKey) });
    criado = data;
  } catch (err) {
    await persistBilling(supabase, empresa.id, { billing_status: BILLING.PENDENTE_CLIENTE, billing_last_error: 'falha ao criar cliente' });
    throw erroAsaas(err, 'Não foi possível criar o cliente Asaas: cadastro inválido.');
  }
  await supabase.from('empresas').update({ asaas_customer_id: criado.id }).eq('id', empresa.id);
  return { customerId: criado.id, created: true };
}

// Garante a assinatura da conta (idempotente): resolve estado, reusa/reconcilia
// e só cria quando não há assinatura utilizável. Persiste ids e estado local.
async function garantirAssinatura({ empresaId, config, supabase, http }) {
  const empresa = await carregarEmpresa(supabase, empresaId);
  const plano = planoDe(empresa);

  // Conta sem plano → não cria assinatura, NÃO é inadimplente.
  if (!empresa.plano_id || !plano) {
    await persistBilling(supabase, empresaId, { billing_status: BILLING.SEM_PLANO, billing_last_error: null });
    return resultado(empresaId, BILLING.SEM_PLANO, false, empresa.next_due_date, false, false, 'Conta sem plano — nenhuma assinatura criada.');
  }

  // Plano gratuito / preço zero → isento, sem assinatura paga, sem suspensão.
  const preco = Number(plano.preco_mensal);
  if (!Number.isFinite(preco) || preco <= 0) {
    await persistBilling(supabase, empresaId, { billing_status: BILLING.ISENTO, billing_last_error: null });
    return resultado(empresaId, BILLING.ISENTO, false, empresa.next_due_date, false, false, 'Plano gratuito — assinatura não é necessária.');
  }

  // Já tem assinatura local → consulta e sincroniza (não recria, não reativa em silêncio).
  if (empresa.asaas_subscription_id) {
    const sub = await buscarAssinatura(http, config, empresa.asaas_subscription_id);
    if (sub) {
      if (statusUtilizavel(sub)) {
        await persistBilling(supabase, empresaId, { billing_status: BILLING.ATIVO, next_due_date: sub.nextDueDate || empresa.next_due_date, billing_last_error: null });
        return resultado(empresaId, BILLING.ATIVO, true, sub.nextDueDate || empresa.next_due_date, false, false, 'Assinatura já configurada.');
      }
      await persistBilling(supabase, empresaId, { billing_status: BILLING.INATIVO, billing_last_error: `assinatura ${String(sub.status || '').toLowerCase()}` });
      return resultado(empresaId, BILLING.INATIVO, true, sub.nextDueDate || empresa.next_due_date, false, false, 'Assinatura existente está inativa. Reative manualmente no Asaas.');
    }
    // Id local não existe no Asaas → inconsistência; tenta reconciliar por referência
    // antes de qualquer criação (nunca duplica sem reconciliar).
    const porRef = await buscarAssinaturaPorReferencia(http, config, empresaId);
    if (porRef) {
      const st = statusUtilizavel(porRef) ? BILLING.ATIVO : BILLING.INATIVO;
      await persistBilling(supabase, empresaId, { billing_status: st, next_due_date: porRef.nextDueDate || null, asaas_subscription_id: porRef.id, billing_last_error: null });
      return resultado(empresaId, st, true, porRef.nextDueDate || null, false, false, 'Assinatura reconciliada pela referência da conta.');
    }
    await persistBilling(supabase, empresaId, { billing_status: BILLING.ERRO, billing_last_error: 'assinatura local não encontrada no Asaas' });
    throw falha(409, 'A assinatura registrada não foi encontrada no Asaas. Concilie antes de criar outra.');
  }

  // Reconciliação preventiva: já existe assinatura no Asaas para esta conta?
  // (evita duplicar quando a criação anterior não salvou o id localmente)
  const existente = await buscarAssinaturaPorReferencia(http, config, empresaId);
  if (existente) {
    const st = statusUtilizavel(existente) ? BILLING.ATIVO : BILLING.INATIVO;
    await persistBilling(supabase, empresaId, { billing_status: st, next_due_date: existente.nextDueDate || null, asaas_subscription_id: existente.id, billing_last_error: null });
    return resultado(empresaId, st, true, existente.nextDueDate || null, false, false, 'Assinatura existente recuperada e vinculada.');
  }

  // Garante o cliente (reusa/cria). Cadastro incompleto lança 400 e persiste pendente_cliente.
  const { customerId, created: createdCustomer } = await garantirCustomer(empresa, { config, supabase, http });

  // Cria a assinatura. Valor, ciclo, vencimento e descrição vêm do backend.
  const nextDueDate = calcularPrimeiroVencimento(empresa.trial_ends_at);
  const payload = {
    customer: customerId,
    billingType: 'PIX',
    value: preco,
    nextDueDate,
    cycle: plano.billing_cycle || 'MONTHLY',
    description: `Assinatura Matopiba Log — ${plano.nome}`,
    externalReference: empresaId,
  };

  let sub;
  try {
    const { data } = await http.post(`${config.baseURL}/subscriptions`, payload, { headers: headers(config.apiKey) });
    sub = data;
  } catch (err) {
    await persistBilling(supabase, empresaId, { billing_status: BILLING.PENDENTE_ASSINATURA, billing_last_error: 'falha ao criar assinatura' });
    throw erroAsaas(err, 'Não foi possível criar a assinatura no Asaas.');
  }

  // Persiste o id IMEDIATAMENTE. Se o banco falhar, marca 'erro' e deixa caminho de
  // reconciliação (a próxima chamada acha por externalReference e não recria).
  const { error: persistErr } = await supabase.from('empresas').update({
    asaas_subscription_id: sub.id,
    billing_status: BILLING.ATIVO,
    next_due_date: sub.nextDueDate || nextDueDate,
    billing_last_error: null,
    billing_updated_at: new Date().toISOString(),
  }).eq('id', empresaId);

  if (persistErr) {
    try {
      await persistBilling(supabase, empresaId, { billing_status: BILLING.ERRO, billing_last_error: 'assinatura criada; falha ao salvar id' });
    } catch (_) { /* melhor esforço */ }
    throw falha(500, 'Assinatura criada, mas houve falha ao salvar. Rode novamente para reconciliar.');
  }

  return resultado(empresaId, BILLING.ATIVO, true, sub.nextDueDate || nextDueDate, createdCustomer, true, 'Assinatura sandbox configurada.');
}

// Conciliação read-only: consulta a assinatura, sincroniza estado local e conta as
// cobranças vinculadas — SEM importá-las para `faturas` (isso é o BLOCO 4).
async function conciliarAssinatura({ empresaId, config, supabase, http }) {
  const empresa = await carregarEmpresa(supabase, empresaId);

  if (!empresa.asaas_subscription_id) {
    return {
      empresa_id: empresaId,
      billing_status: empresa.billing_status || BILLING.NAO_CONFIGURADO,
      subscription_configured: false,
      next_due_date: empresa.next_due_date || null,
      subscription_payments_count: 0,
      mensagem: 'Nenhuma assinatura configurada.',
    };
  }

  const sub = await buscarAssinatura(http, config, empresa.asaas_subscription_id);
  if (!sub) {
    await persistBilling(supabase, empresaId, { billing_status: BILLING.ERRO, billing_last_error: 'assinatura não encontrada no Asaas' });
    return {
      empresa_id: empresaId,
      billing_status: BILLING.ERRO,
      subscription_configured: true,
      next_due_date: empresa.next_due_date || null,
      subscription_payments_count: 0,
      mensagem: 'Assinatura não encontrada no Asaas.',
    };
  }

  const novoStatus = statusUtilizavel(sub) ? BILLING.ATIVO : BILLING.INATIVO;
  await persistBilling(supabase, empresaId, { billing_status: novoStatus, next_due_date: sub.nextDueDate || empresa.next_due_date, billing_last_error: null });

  let count = 0;
  try {
    const { data } = await http.get(`${config.baseURL}/subscriptions/${empresa.asaas_subscription_id}/payments`, { headers: headers(config.apiKey) });
    if (data) {
      count = typeof data.totalCount === 'number'
        ? data.totalCount
        : (Array.isArray(data.data) ? data.data.length : 0);
    }
  } catch (_) { count = 0; /* contagem é best-effort */ }

  return {
    empresa_id: empresaId,
    billing_status: novoStatus,
    subscription_configured: true,
    next_due_date: sub.nextDueDate || empresa.next_due_date || null,
    subscription_payments_count: count,
    mensagem: 'Assinatura conciliada.',
  };
}

module.exports = {
  garantirAssinatura,
  conciliarAssinatura,
  calcularPrimeiroVencimento,
  BILLING_STATES: BILLING,
};
