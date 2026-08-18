// Núcleo (testável, sem I/O) do one-shot de COBRANÇA AVULSA Asaas production.
//
// Contexto (frente Pagamento/Aquisição real — F2A): o orquestrador nativo sempre
// cria SUBSCRIPTION recorrente. Para o primeiro pagamento real controlado o Jordão
// decidiu por uma COBRANÇA AVULSA one-shot (PIX, R$1,00, 1 única empresa piloto).
// Este módulo concentra o parsing de argumentos, as validações fail-closed e a
// orquestração da escrita — SEM tocar rede/banco diretamente (deps injetadas).
//
// SEGURANÇA (fail-closed, por padrão inerte):
//   - dry-run é o DEFAULT: sem `--execute` + confirmações, NADA é chamado no provider;
//   - a escrita real herda TODAS as travas do billingProductionGate (provider
//     production + production_enabled + outbox_enabled + allowlist + secret + operação
//     elegível) e AINDA exige allowlist com exatamente 1 empresa = o alvo;
//   - cria customer idempotente (externalReference = empresa.id) + UMA cobrança PIX
//     avulsa (externalReference canônico determinístico). NUNCA cria subscription;
//   - commit incerto (5xx/timeout/429) → aborta com instrução de reconciliação
//     (nunca dispara uma segunda cobrança automaticamente);
//   - `PRODUCTION_ASAAS_WRITES` NÃO é usado: não é controle real (o gate não a lê).

const {
  avaliarBillingProductionGate,
  resumoBillingProductionGate,
  parseAllowlist,
} = require('./billingProductionGate');
const {
  canonicalCustomerReference,
  canonicalImplantationChargeReference,
  isAsaasCommitUncertainError,
} = require('./asaasProviderSafety');

const VALOR_PADRAO_CENTAVOS = 100; // R$1,00 — valor simbólico de homologação (decisão do Jordão)
const OPERACAO = 'charge';
const DESCRICAO_PADRAO = 'Matopiba Log - cobranca de homologacao (one-shot)';
const VENCIMENTO_DIAS_PADRAO = 3;

// ---------- utilitários puros ----------

function centavosParaReais(centavos) {
  return Math.round(Number(centavos)) / 100;
}

function ehUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim());
}

// Vencimento (YYYY-MM-DD) a partir de `agora` + dias (para o PIX avulso).
function calcularVencimentoIso(agora, dias) {
  const base = agora instanceof Date ? agora.getTime() : Date.now();
  const d = new Date(base + Number(dias) * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

// Sanitiza qualquer string antes de logar: nunca deixa vazar apiKey/token/URL.
function sanitizar(v) {
  if (v == null) return null;
  return String(v)
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/access_token['":\s]+[^"',\s}]+/gi, 'access_token [redacted]')
    .replace(/\$?aact_[A-Za-z0-9_$-]+/g, '[redacted_api_key]')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .slice(0, 500);
}

// Só dígitos (para cpfCnpj — o Asaas rejeita valores com máscara .-/).
function soDigitos(v) {
  return String(v || '').replace(/\D/g, '');
}

// Extrai apenas o essencial (não-sensível) do erro Asaas 4xx: status HTTP +
// errors[].code/description. NUNCA inclui headers/token/apiKey/payload bruto.
function sanitizarErroAsaas(err) {
  const status = err?.response?.status ?? err?.httpStatus ?? err?.status ?? null;
  const data = err?.response?.data;
  let errors = null;
  if (data && Array.isArray(data.errors)) {
    errors = data.errors.slice(0, 10).map((e) => ({
      code: sanitizar(e?.code),
      description: sanitizar(e?.description),
    }));
  }
  return { http_status: typeof status === 'number' ? status : null, errors };
}

// Parsing de flags no formato --chave=valor / --flag. Não lança.
function parseArgs(argv = []) {
  const raw = new Map();
  for (const token of argv) {
    if (typeof token !== 'string' || !token.startsWith('--')) continue;
    const semTraco = token.slice(2);
    const idx = semTraco.indexOf('=');
    if (idx === -1) raw.set(semTraco, 'true');
    else raw.set(semTraco.slice(0, idx), semTraco.slice(idx + 1));
  }
  const valorCentavosRaw = raw.get('valor-centavos');
  const vencimentoDiasRaw = raw.get('vencimento-dias');
  return {
    execute: raw.get('execute') === 'true',
    confirmProductionOneShot: raw.get('confirm-production-one-shot') === 'true',
    empresaId: raw.has('empresa-id') ? String(raw.get('empresa-id')).trim() : null,
    empresaNomeEsperado: raw.has('empresa-nome-esperado') ? String(raw.get('empresa-nome-esperado')).trim() : null,
    valorCentavos: valorCentavosRaw != null ? Number(valorCentavosRaw) : VALOR_PADRAO_CENTAVOS,
    valorCentavosInformado: valorCentavosRaw != null,
    descricao: raw.has('descricao') ? String(raw.get('descricao')).slice(0, 240) : DESCRICAO_PADRAO,
    vencimentoDias: vencimentoDiasRaw != null ? Number(vencimentoDiasRaw) : VENCIMENTO_DIAS_PADRAO,
    permitirCustomerExistente: raw.get('permitir-customer-existente') === 'true',
    confirmValor: raw.get('confirm-valor') === 'true',
    reconcile: raw.get('reconcile') === 'true',
  };
}

// ---------- validações fail-closed ----------

// Reúne erros (bloqueiam escrita) e avisos. `empresa` pode ser null (não encontrada).
// `outboxPendentes` é opcional (null = não verificado).
function coletarValidacoes({ env = {}, args, empresa, gate, outboxPendentes = null }) {
  const erros = [];
  const avisos = [];
  const allowlist = parseAllowlist(env.BILLING_PRODUCTION_ALLOWLIST);

  // 1. Confirmações explícitas de execução.
  if (!args.empresaId) erros.push('empresa_id_ausente');
  else if (!ehUuid(args.empresaId)) erros.push('empresa_id_invalido');
  if (!args.confirmProductionOneShot) erros.push('falta_confirm_production_one_shot');

  // 2. Estado de ambiente/flags esperado (gate ACTIVE p/ escrita).
  const providerMode = String(env.BILLING_PROVIDER_MODE || '').trim().toLowerCase();
  if (providerMode !== 'asaas_production') erros.push('provider_mode_nao_production');
  if (String(env.BILLING_PRODUCTION_ENABLED || '').trim().toLowerCase() !== 'true') erros.push('production_nao_habilitado');
  if (String(env.BILLING_OUTBOX_ENABLED || '').trim().toLowerCase() !== 'true') erros.push('outbox_nao_habilitado');
  if (!env.ASAAS_API_KEY) erros.push('asaas_api_key_ausente');
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  if (nodeEnv && nodeEnv !== 'production') avisos.push(`node_env_inesperado:${nodeEnv}`);

  // 3. Allowlist: EXATAMENTE 1 empresa = o alvo (mais estrito que o gate).
  if (allowlist.length === 0) erros.push('allowlist_vazia');
  if (allowlist.length > 1) erros.push('allowlist_com_mais_de_uma_empresa');
  if (args.empresaId && allowlist.length >= 1 && !allowlist.includes(String(args.empresaId))) {
    erros.push('empresa_fora_da_allowlist');
  }

  // 4. Gate cumulativo do domínio.
  if (!gate || gate.allowed !== true) erros.push('gate_bloqueado');
  if (gate && !gate.checks?.operation_eligible) erros.push('operacao_nao_elegivel');

  // 5. Empresa: existe, com dados mínimos e sem artefato production conflitante.
  if (!empresa) {
    erros.push('empresa_nao_encontrada');
  } else {
    if (!empresa.email_contato) erros.push('empresa_sem_email');
    if (!empresa.cnpj) {
      erros.push('empresa_sem_cnpj');
    } else if (![11, 14].includes(soDigitos(empresa.cnpj).length)) {
      // cpfCnpj é normalizado para dígitos antes do POST; se não sobrar um
      // CPF(11)/CNPJ(14) válido em tamanho, aborta ANTES de chamar o Asaas.
      erros.push('cpfcnpj_invalido_apos_normalizacao');
    }
    if (args.empresaNomeEsperado
        && String(empresa.nome || '').trim().toLowerCase() !== args.empresaNomeEsperado.toLowerCase()) {
      erros.push('nome_empresa_diverge_do_esperado');
    }
    if (empresa.asaas_customer_id && !args.permitirCustomerExistente) {
      erros.push('empresa_com_asaas_customer_existente');
    }
    if (empresa.asaas_subscription_id) avisos.push('empresa_ja_tem_subscription');
  }

  // 6. Valor: positivo; diferente do padrão exige --confirm-valor.
  if (!(Number.isFinite(args.valorCentavos) && args.valorCentavos > 0)) erros.push('valor_invalido');
  if (Number.isFinite(args.valorCentavos) && args.valorCentavos !== VALOR_PADRAO_CENTAVOS && !args.confirmValor) {
    erros.push('valor_diferente_do_padrao_sem_confirmacao');
  }

  // 7. Outbox (opcional): se consultado, deve estar vazio.
  if (outboxPendentes != null && Number(outboxPendentes) > 0) erros.push('outbox_nao_vazia');

  return { erros, avisos, allowlist_size: allowlist.length };
}

// Monta o "plano de execução" (o que SERIA feito) — usado tanto no dry-run quanto
// como evidência antes da escrita real.
function montarPlano({ args, agora }) {
  const empresaId = args.empresaId;
  return {
    empresa_id: empresaId,
    operacao: OPERACAO,
    metodo: 'PIX',
    tipo: 'cobranca_avulsa_one_shot',
    cria_subscription: false,
    valor_centavos: args.valorCentavos,
    valor_reais: empresaId ? centavosParaReais(args.valorCentavos) : null,
    descricao: args.descricao,
    vencimento: calcularVencimentoIso(agora, args.vencimentoDias),
    external_reference_customer: canonicalCustomerReference(empresaId),
    external_reference_charge: canonicalImplantationChargeReference(empresaId),
  };
}

// ---------- orquestração ----------

// deps: {
//   carregarEmpresa: async (empresaId) => empresa|null   (read-only)
//   criarProvider:   ({ empresaId, env }) => provider     (herda o gate)
//   contarOutboxPendentes?: async () => number            (opcional)
//   agora?: Date
//   log?:  (obj) => void
// }
async function executarOneShotCharge({ argv = [], env = process.env, deps = {} } = {}) {
  const agora = deps.agora instanceof Date ? deps.agora : new Date();
  const log = typeof deps.log === 'function' ? deps.log : () => {};
  const args = parseArgs(argv);

  // --------- RECONCILE (read-only): só GET no Asaas, nunca escreve ---------
  if (args.reconcile) {
    return executarReconcile({ args, env, deps, log });
  }

  const gate = avaliarBillingProductionGate({ empresaId: args.empresaId, operation: OPERACAO, env });
  const resumoGate = resumoBillingProductionGate(env); // só booleans/contagens (sem segredo)

  let empresa = null;
  if (args.empresaId && typeof deps.carregarEmpresa === 'function') {
    empresa = await deps.carregarEmpresa(args.empresaId);
  }

  let outboxPendentes = null;
  if (typeof deps.contarOutboxPendentes === 'function') {
    try { outboxPendentes = await deps.contarOutboxPendentes(); } catch { outboxPendentes = null; }
  }

  const { erros, avisos, allowlist_size } = coletarValidacoes({ env, args, empresa, gate, outboxPendentes });
  const plano = montarPlano({ args, agora });

  const abortCriteria = [
    'allowlist com mais de uma empresa',
    'empresa fora da allowlist / não encontrada / sem email / sem cnpj',
    'gate não-ACTIVE (provider/production/outbox/secret/allowlist)',
    'valor != 100 centavos sem --confirm-valor',
    'commit incerto ou 5xx/timeout/429 no Asaas',
    'empresa já possui asaas_customer_id (sem --permitir-customer-existente)',
  ];

  // --------- DRY-RUN (default): não chama provider, não escreve ---------
  if (!args.execute) {
    const relatorio = {
      modo: 'dry-run',
      execucao_real: false,
      gate: resumoGate,
      gate_permite_escrita: gate.allowed === true,
      gate_failures: gate.failures,
      allowlist_size,
      empresa: empresa
        ? { id: args.empresaId, nome: sanitizar(empresa.nome), tem_email: !!empresa.email_contato, tem_cnpj: !!empresa.cnpj, asaas_customer_id_presente: !!empresa.asaas_customer_id }
        : (args.empresaId ? { id: args.empresaId, encontrada: false } : null),
      plano,
      validacoes_que_bloqueariam: erros,
      avisos,
      abort_criteria: abortCriteria,
      observacao: 'DRY-RUN: nenhuma chamada ao Asaas, nenhum customer/cobranca/subscription criado.',
    };
    log(relatorio);
    return relatorio;
  }

  // --------- EXECUÇÃO REAL: fail-closed antes de qualquer escrita ---------
  if (erros.length > 0) {
    const relatorio = { modo: 'execute', execucao_real: false, abortado: true, motivos: erros, avisos, gate: resumoGate, plano };
    log(relatorio);
    const e = new Error(`ONE_SHOT_ABORTADO: ${erros.join(',')}`);
    e.code = 'ONE_SHOT_ABORTADO';
    e.motivos = erros;
    throw e;
  }

  if (typeof deps.criarProvider !== 'function') {
    const e = new Error('ONE_SHOT_SEM_PROVIDER: deps.criarProvider ausente.');
    e.code = 'ONE_SHOT_SEM_PROVIDER';
    throw e;
  }

  const provider = deps.criarProvider({ empresaId: args.empresaId, env }); // selecionarProvider → re-checa o gate
  const evidencias = { modo: 'execute', execucao_real: true, empresa_id: args.empresaId, plano };
  let etapaAtual = 'unknown';

  try {
    // 1. Customer idempotente (find-or-create por externalReference = empresa.id).
    //    cpfCnpj vai SOMENTE dígitos (Asaas rejeita máscara).
    etapaAtual = 'createCustomer';
    const customer = await provider.createCustomer({
      empresa: {
        id: args.empresaId,
        nome: empresa.nome,
        cnpj: soDigitos(empresa.cnpj),
        email_contato: empresa.email_contato,
      },
    });
    evidencias.customer_id = customer && customer.id ? customer.id : null;
    evidencias.customer_reconciliado = !!(customer && customer.reconciled);

    // 2. UMA cobrança PIX avulsa (nunca subscription).
    etapaAtual = 'createCharge';
    const charge = await provider.createCharge({
      customerId: evidencias.customer_id,
      value: centavosParaReais(args.valorCentavos),
      dueDate: plano.vencimento,
      description: args.descricao,
      externalReference: plano.external_reference_charge,
    });
    evidencias.charge_id = charge && charge.id ? charge.id : null;
    evidencias.charge_status = charge ? (charge.status || null) : null;
    evidencias.charge_value = charge ? (charge.value ?? null) : null;
    evidencias.charge_reconciliado = !!(charge && charge.reconciled);
    evidencias.subscription_created = false;
    evidencias.ok = true;
    log(evidencias);
    return evidencias;
  } catch (err) {
    const incerto = isAsaasCommitUncertainError(err);
    const detalhe = sanitizarErroAsaas(err); // { http_status, errors } — sem segredo
    const relatorio = {
      modo: 'execute',
      execucao_real: true,
      ok: false,
      abortado: true,
      commit_incerto: incerto,
      http_status: detalhe.http_status,
      failed_step: etapaAtual, // createCustomer | createCharge | unknown
      asaas_error_sanitized: { errors: detalhe.errors },
      instrucao_reconciliacao: incerto
        ? `Reconciliar manualmente por externalReference=${plano.external_reference_charge} no painel Asaas ANTES de re-executar. NÃO disparar segunda cobrança automaticamente.`
        : null,
      erro: sanitizar(err && err.message),
      plano,
    };
    log(relatorio);
    const e = new Error(incerto ? 'ONE_SHOT_COMMIT_INCERTO' : 'ONE_SHOT_FALHA');
    e.code = incerto ? 'ONE_SHOT_COMMIT_INCERTO' : 'ONE_SHOT_FALHA';
    e.cause = err;
    throw e;
  }
}

// ---------- reconcile (read-only) ----------
//
// Só GET no Asaas: busca customer por externalReference=empresa.id e charge por
// externalReference canônico. NUNCA cria/edita nada. Não exige --execute, nem
// BILLING_OUTBOX_ENABLED=true, nem gate ACTIVE — mas exige allowlist EXATAMENTE 1
// = o alvo (fail-closed) e o segredo presente (senão devolve fallback seguro para
// o Jordão rodar via Railway).
//
// deps.reconciliarAsaas: async ({ empresaId, chargeRef, env }) =>
//   { secret_present, customer:{id}|null, charge:{id,status,value,billingType}|null }
async function executarReconcile({ args, env = {}, deps = {}, log = () => {} }) {
  const allowlist = parseAllowlist(env.BILLING_PRODUCTION_ALLOWLIST);
  const chargeRef = canonicalImplantationChargeReference(args.empresaId);

  const base = {
    modo: 'reconcile',
    execucao_real: false,
    read_only: true,
    ASAAS_SUBSCRIPTION_FOUND: false,
    external_reference_customer: canonicalCustomerReference(args.empresaId),
    external_reference_charge: chargeRef,
  };

  // Fail-closed de escopo (mesmo sendo read-only, só reconcilia o alvo único).
  const erros = [];
  if (!args.empresaId) erros.push('empresa_id_ausente');
  else if (!ehUuid(args.empresaId)) erros.push('empresa_id_invalido');
  if (allowlist.length !== 1) erros.push('allowlist_precisa_ter_exatamente_1');
  if (args.empresaId && allowlist.length >= 1 && !allowlist.includes(String(args.empresaId))) {
    erros.push('empresa_fora_da_allowlist');
  }
  if (erros.length > 0) {
    const r = { ...base, RECONCILE_RESULT: 'BLOQUEADO_ESCOPO', motivos: erros };
    log(r);
    return r;
  }

  // Sem segredo no ambiente (ex.: shell local do Claude) → fallback seguro.
  if (!env.ASAAS_API_KEY || typeof deps.reconciliarAsaas !== 'function') {
    const r = {
      ...base,
      RECONCILE_RESULT: 'NEEDS_OWNER_RAILWAY_RUN',
      secret_present: !!env.ASAAS_API_KEY,
      ASAAS_CUSTOMER_FOUND: null,
      ASAAS_CUSTOMER_ID: null,
      ASAAS_CHARGE_FOUND: null,
      ASAAS_CHARGE_ID: null,
      ASAAS_CHARGE_STATUS: null,
      ASAAS_CHARGE_VALUE: null,
      ASAAS_CHARGE_BILLING_TYPE: null,
      observacao: 'Reconcile precisa do ASAAS_API_KEY no ambiente. Rodar via `railway run` (read-only, sem --execute).',
    };
    log(r);
    return r;
  }

  let res;
  try {
    res = await deps.reconciliarAsaas({ empresaId: args.empresaId, chargeRef, env });
  } catch (err) {
    const detalhe = sanitizarErroAsaas(err);
    const r = { ...base, RECONCILE_RESULT: 'ERRO_CONSULTA', http_status: detalhe.http_status, erro: sanitizar(err && err.message) };
    log(r);
    return r;
  }

  if (!res || res.secret_present === false) {
    const r = { ...base, RECONCILE_RESULT: 'NEEDS_OWNER_RAILWAY_RUN', secret_present: false };
    log(r);
    return r;
  }

  const custFound = !!(res.customer && res.customer.id);
  const chgFound = !!(res.charge && res.charge.id);
  const resultado = chgFound
    ? 'CHARGE_FOUND_DO_NOT_REPEAT'
    : (custFound ? 'CUSTOMER_ONLY_NO_CHARGE' : 'NO_CUSTOMER_NO_CHARGE');

  const r = {
    ...base,
    RECONCILE_RESULT: resultado,
    secret_present: true,
    ASAAS_CUSTOMER_FOUND: custFound,
    ASAAS_CUSTOMER_ID: custFound ? res.customer.id : null,
    ASAAS_CHARGE_FOUND: chgFound,
    ASAAS_CHARGE_ID: chgFound ? res.charge.id : null,
    ASAAS_CHARGE_STATUS: chgFound ? (res.charge.status || null) : null,
    ASAAS_CHARGE_VALUE: chgFound ? (res.charge.value ?? null) : null,
    ASAAS_CHARGE_BILLING_TYPE: chgFound ? (res.charge.billingType || null) : null,
  };
  log(r);
  return r;
}

module.exports = {
  VALOR_PADRAO_CENTAVOS,
  OPERACAO,
  DESCRICAO_PADRAO,
  VENCIMENTO_DIAS_PADRAO,
  centavosParaReais,
  ehUuid,
  calcularVencimentoIso,
  sanitizar,
  soDigitos,
  sanitizarErroAsaas,
  parseArgs,
  coletarValidacoes,
  montarPlano,
  executarReconcile,
  executarOneShotCharge,
};
