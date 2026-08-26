const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const supabase = require('../config/supabase');
const { verifyToken, isSuperAdmin } = require('../middlewares/auth');
const { requirePermission } = require('../middlewares/requirePermission');
const { verificarEmpresa } = require('../middlewares/tenant');
const { resolveAsaasApiKey } = require('../utils/asaasConfig');
const { classificarResponsavelRegularizacao } = require('../utils/billingProfile');
const { garantirAssinatura, conciliarAssinatura, atualizarValorAssinatura } = require('../services/asaasSubscriptionService');
const asaasSync = require('../services/asaasSyncDomainService');
const { derivarValorEfetivoFatura } = require('../services/calculadoraComercialService');
const { sincronizarCobrancas } = require('../services/asaasInvoiceSyncService');
const { solicitarUpgrade } = require('../services/upgradeRequestService');
const { gerarFaturaRecorrenteEmLote, CAMPOS_EMPRESA } = require('../services/faturaRecorrenteService');
const {
  normalizarStatusAsaas,
  decidirAtualizacaoFatura,
  decidirTransicaoContaPorPagamento,
  decidirSuspensaoPorInadimplencia,
} = require('../services/paymentDomainService');
const { processarWebhook } = require('../services/asaasWebhookService');
const { sanitizar } = require('../services/asaasWebhookEventRepository');
const { patchSuspensaoFinanceiraAutomatica, patchLimparSuspensao } = require('../utils/suspensao');
const { gerarFaturaRegularizacao } = require('../services/regularizacaoService');
// 3A-2 — orquestração de billing (planejamento/reconciliação; sem writes Asaas aqui).
const { carregarSituacaoComercial } = require('../services/situacaoComercialService');
const { planejarBilling } = require('../services/billing/billingOrchestratorDomainService');
const { reconciliar } = require('../services/billing/billingReconcileDomainService');
const { resolvePolicy } = require('../services/billing/billingPolicyConfig');
const { montarLinhaBilling } = require('../services/billing/billingAdminViewDomainService');
const { emitirEventoBilling } = require('../services/billing/billingTriggers');
const { processarOutbox } = require('../services/billing/billingOutboxWorker');
const { contarPorStatus } = require('../services/billing/billingOutboxRepository');

// Comparação em tempo constante (hash de tamanho fixo evita vazar comprimento)
function safeEqual(a, b) {
  const ah = crypto.createHash('sha256').update(String(a)).digest();
  const bh = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ah, bh);
}

async function getAsaasConfig() {
  const { data } = await supabase
    .from('configuracoes')
    .select('dados')
    .eq('id', 1)
    .single();
  
  const integracoes = data?.dados?.['integracao_asaas'] || {};
  // Descriptografa a apiKey armazenada (criptografia em repouso do PR #211) antes
  // de usá-la como access_token. Valor legado em texto puro passa direto; valor
  // enc:v1 sem chave lança e impede o envio de ciphertext ao Asaas.
  const apiKey = resolveAsaasApiKey(integracoes);
  const environment = integracoes.environment || 'sandbox';
  const baseURL = environment === 'production'
    ? 'https://api.asaas.com/v3'
    : 'https://sandbox.asaas.com/api/v3';

  return { apiKey, baseURL, environment };
}

// Mensagem única da trava de sandbox.
const MSG_SANDBOX_OBRIGATORIO = 'Cobranças reais estão desabilitadas neste ambiente. Use Asaas sandbox.';

// Lê SOMENTE o ambiente configurado do Asaas (sem resolver a apiKey), para a
// trava poder bloquear ANTES de qualquer chamada externa ou leitura de segredo.
async function ambienteAsaas() {
  const { data } = await supabase
    .from('configuracoes')
    .select('dados')
    .eq('id', 1)
    .single();
  return data?.dados?.['integracao_asaas']?.environment || 'sandbox';
}

// Trava HARD de sandbox (defense-in-depth — não confia só na UI). Se o ambiente
// não for 'sandbox', responde 403 e NÃO chama o Asaas nem toca em dados.
// Retorna true quando bloqueou (o handler deve dar `return` em seguida).
async function bloquearSeNaoSandbox(res) {
  if ((await ambienteAsaas()) !== 'sandbox') {
    res.status(403).json({ message: MSG_SANDBOX_OBRIGATORIO });
    return true;
  }
  return false;
}

function asaasHeaders(apiKey) {
  return {
    'access_token': apiKey,
    'Content-Type': 'application/json',
  };
}

// Remove tudo que não é dígito (tira máscara de CPF/CNPJ/telefone).
function apenasDigitos(v) {
  return String(v == null ? '' : v).replace(/\D+/g, '');
}

// Validação simples de e-mail (suficiente para barrar valores obviamente inválidos).
function emailValido(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

// Mascara e-mail para log (nunca logar o valor completo). Ex.: "j***@gmail.com".
function mascararEmail(v) {
  if (typeof v !== 'string' || !v.includes('@')) return v ? 'presente' : 'ausente';
  const [usuario, dominio] = v.split('@');
  return `${usuario.slice(0, 1)}***@${dominio}`;
}

// PIX QR (best-effort). O Asaas NÃO devolve o QR na criação do payment: o
// copia-e-cola vem em GET /payments/:id/pixQrCode. Guardamos o `payload`
// (texto compacto), não a imagem base64. Falha aqui não invalida a cobrança:
// a fatura fica com o invoice_url e o QR pode ser obtido depois na conciliação.
async function obterPixQrCode(baseURL, apiKey, paymentId) {
  try {
    const { data } = await axios.get(
      `${baseURL}/payments/${paymentId}/pixQrCode`,
      { headers: asaasHeaders(apiKey) }
    );
    return data?.payload || null;
  } catch (_) {
    return null;
  }
}

router.post('/clientes', verifyToken, isSuperAdmin, async (req, res) => {
  try {
    if (await bloquearSeNaoSandbox(res)) return;
    const { empresa_id, nome, cpfCnpj, email, telefone } = req.body;

    // Validação/normalização ANTES de chamar o Asaas: evita o erro genérico e
    // aponta exatamente qual campo do cadastro está faltando/ inválido.
    const nomeLimpo = typeof nome === 'string' ? nome.trim() : '';
    if (!nomeLimpo) {
      return res.status(400).json({ message: 'Informe o nome da conta antes de criar o cliente Asaas.' });
    }
    // CPF/CNPJ: sem máscara, exatamente 11 (CPF) ou 14 (CNPJ) dígitos. Serve para
    // empresa e autônomo (o documento vive na coluna `cnpj` em ambos os tipos).
    const doc = apenasDigitos(cpfCnpj);
    if (doc.length !== 11 && doc.length !== 14) {
      return res.status(400).json({ message: 'Informe um CPF ou CNPJ válido no cadastro da conta.' });
    }
    const emailLimpo = typeof email === 'string' ? email.trim() : '';
    if (!emailValido(emailLimpo)) {
      return res.status(400).json({ message: 'Informe um e-mail válido no cadastro da conta.' });
    }
    // Telefone é opcional: só envia se tiver 10 ou 11 dígitos; caso contrário, omite.
    const tel = apenasDigitos(telefone);
    const telefoneEnvio = tel.length === 10 || tel.length === 11 ? tel : undefined;

    const { apiKey, baseURL } = await getAsaasConfig();

    const payloadAsaas = {
      name: nomeLimpo,
      cpfCnpj: doc,
      email: emailLimpo,
      notificationDisabled: false,
    };
    if (telefoneEnvio) payloadAsaas.phone = telefoneEnvio;

    const response = await axios.post(`${baseURL}/customers`, payloadAsaas, { headers: asaasHeaders(apiKey) });

    await supabase.from('empresas').update({
      asaas_customer_id: response.data.id,
    }).eq('id', empresa_id);

    res.json({ customer_id: response.data.id });
  } catch (err) {
    // Extrai com segurança a descrição do Asaas (nunca loga/retorna payload, API key ou headers).
    const asaasStatus = err.response?.status;
    const asaasErros = err.response?.data?.errors;
    const asaasDesc = Array.isArray(asaasErros) && asaasErros[0]?.description ? asaasErros[0].description : '';

    // Log seguro: status + presença/tamanho dos campos, com documento e e-mail mascarados.
    console.error('[pagamentos/clientes] Falha ao criar cliente Asaas', {
      status: asaasStatus || 'sem-status',
      nomePresente: Boolean(req.body?.nome),
      cpfCnpjDigitos: apenasDigitos(req.body?.cpfCnpj).length,
      email: mascararEmail(req.body?.email),
      telefoneDigitos: apenasDigitos(req.body?.telefone).length,
      asaas: asaasDesc || err.message,
    });

    // Mapeia erros conhecidos do Asaas para PT. 4xx do Asaas → 422 (cadastro inválido);
    // 5xx/rede → 500. NUNCA devolve API key, headers ou payload com dados pessoais.
    const httpOut = asaasStatus && asaasStatus >= 400 && asaasStatus < 500 ? 422 : 500;
    let mensagem = 'Não foi possível criar o cliente Asaas: cadastro incompleto ou inválido.';
    if (/cpf|cnpj/i.test(asaasDesc)) {
      mensagem = 'O CPF/CNPJ informado não foi aceito pelo Asaas. Revise o cadastro da conta.';
    } else if (/e-?mail/i.test(asaasDesc)) {
      mensagem = 'O e-mail informado não foi aceito pelo Asaas.';
    }
    return res.status(httpOut).json({ message: mensagem });
  }
});

router.post('/cobrancas', verifyToken, isSuperAdmin, async (req, res) => {
  try {
    // GATE de sandbox ANTES de tudo: em produção nada é lido, criado ou cobrado.
    if (await bloquearSeNaoSandbox(res)) return;

    const { empresa_id, valor, tipo, descricao, due_date } = req.body;

    // Idempotência: chave enviada pelo cliente ou gerada aqui. Duas requisições
    // com o mesmo client_request_id NÃO criam duas cobranças (ver migration 021).
    const clientRequestId =
      (req.body.client_request_id && String(req.body.client_request_id).trim()) ||
      crypto.randomUUID();

    // Pré-checagem: se já existe fatura para esta chave, devolve-a sem chamar o
    // Asaas. O índice único parcial é a garantia real (trata corrida abaixo).
    const { data: existente, error: existErr } = await supabase
      .from('faturas')
      .select('*')
      .eq('client_request_id', clientRequestId)
      .maybeSingle();
    if (existErr && existErr.code !== 'PGRST116') throw existErr;
    if (existente) {
      return res.status(200).json({ ...existente, idempotente: true });
    }

    const { apiKey, baseURL } = await getAsaasConfig();

    const { data: empresa } = await supabase
      .from('empresas')
      .select('asaas_customer_id, nome')
      .eq('id', empresa_id)
      .single();

    if (!empresa?.asaas_customer_id) {
      return res.status(400).json({ message: 'Empresa sem cliente Asaas. Crie o cliente primeiro.' });
    }

    // Vencimento: aceita due_date (YYYY-MM-DD) do cliente; senão, hoje + 7 dias.
    const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(due_date || ''))
      ? due_date
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const payload = {
      customer: empresa.asaas_customer_id,
      value: Number(valor),
      description: descricao || `Assinatura ${empresa.nome}`,
      dueDate,
      postalService: false,
      // Rastreio no Asaas: espelha nossa chave de idempotência.
      externalReference: clientRequestId,
    };

    if (tipo === 'PIX') {
      payload.billingType = 'PIX';
    } else if (tipo === 'BOLETO') {
      payload.billingType = 'BOLETO';
    } else if (tipo === 'CARTAO') {
      payload.billingType = 'CREDIT_CARD';
    }

    const response = await axios.post(`${baseURL}/payments`, payload, { headers: asaasHeaders(apiKey) });

    // Normaliza o status do Asaas (ex.: 'PENDING') para o vocabulário da tabela.
    const statusInterno = normalizarStatusAsaas(response.data.status).status;

    // PIX: busca o copia-e-cola em chamada dedicada (best-effort).
    const pixQrCode = tipo === 'PIX'
      ? await obterPixQrCode(baseURL, apiKey, response.data.id)
      : null;

    const novaFatura = {
      empresa_id,
      asaas_id: response.data.id,
      valor: Number(valor),
      tipo_pagamento: tipo,
      status: statusInterno,
      invoice_url: response.data.invoiceUrl,
      pix_qr_code: pixQrCode,
      due_date: dueDate,
      client_request_id: clientRequestId,
    };

    const { data: fatura, error: insertErr } = await supabase
      .from('faturas')
      .insert(novaFatura)
      .select()
      .single();

    if (insertErr) {
      // Corrida: outra requisição com a mesma chave já inseriu (23505 = unique).
      // Devolve a fatura existente para manter idempotência.
      if (insertErr.code === '23505') {
        const { data: jaExiste } = await supabase
          .from('faturas')
          .select('*')
          .eq('client_request_id', clientRequestId)
          .maybeSingle();
        if (jaExiste) return res.status(200).json({ ...jaExiste, idempotente: true });
      }
      throw insertErr;
    }

    res.status(201).json(fatura);
  } catch (err) {
    res.status(500).json({ message: 'Erro ao criar cobrança.', error: err.response?.data || err.message });
  }
});

// IMPORTANTE: rota literal /all ANTES da paramétrica /:empresa_id (senão é capturada)
router.get('/cobrancas/all', verifyToken, isSuperAdmin, async (req, res) => {
  try {
    const { data } = await supabase
      .from('faturas')
      .select('*, empresas(nome, tipo, status, plano_id, planos(nome))')
      .order('created_at', { ascending: false });

    res.json(data || []);
  } catch (err) {
    res.status(500).json({ message: 'Erro ao listar todas as cobranças.' });
  }
});

// Contatos de suporte para o caminho de regularização, com fallback: as chaves
// dedicadas (email_suporte/whatsapp_suporte/telefone_suporte, aba Sistema) têm
// precedência; na ausência, reusa os contatos públicos da aparência do login
// (contactEmail/contactPhone), que já são configurados na prática. Nunca devolve
// string vazia — campo sem valor útil sai como null para o app decidir.
function montarContatosSuporte(dados) {
  const d = dados || {};
  const limpar = (v) => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s || null;
  };
  return {
    suporte_email: limpar(d.email_suporte) || limpar(d.contactEmail),
    suporte_whatsapp: limpar(d.whatsapp_suporte),
    suporte_telefone: limpar(d.telefone_suporte) || limpar(d.contactPhone),
  };
}

async function carregarPlanoStatus(empresaId, user) {
  const [empresaResult, adminsResult, configResult] = await Promise.all([
    supabase
      .from('empresas')
      .select('status, tipo, trial_ends_at, plano_id, planos(nome, preco_mensal, limite_motoristas)')
      .eq('id', empresaId)
      .single(),
    supabase
      .from('usuarios')
      .select('id', { count: 'exact', head: true })
      .eq('empresa_id', empresaId)
      .eq('tipo', 'admin')
      .eq('status', 'ativo'),
    supabase
      .from('configuracoes')
      .select('dados')
      .eq('id', 1)
      .maybeSingle(),
  ]);

  if (empresaResult.error || !empresaResult.data) {
    const error = empresaResult.error || new Error('Empresa não encontrada.');
    throw error;
  }
  if (adminsResult.error) throw adminsResult.error;

  const empresa = empresaResult.data;
  const trialExpirado = empresa.status === 'trial' && Boolean(
    empresa.trial_ends_at && new Date(empresa.trial_ends_at) < new Date()
  );
  const temAdminAtivo = (adminsResult.count || 0) > 0;
  const responsavel = classificarResponsavelRegularizacao({
    role: user.role,
    empresaTipo: empresa.tipo,
    temAdminAtivo,
  });

  return {
    status: empresa.status,
    empresa_tipo: empresa.tipo,
    trial_ends_at: empresa.trial_ends_at,
    trial_expirado: trialExpirado,
    plano_id: empresa.plano_id,
    plano: empresa.planos || null,
    regularizacao: {
      responsavel,
      ...montarContatosSuporte(configResult.data?.dados),
    },
  };
}

// Estado read-only do plano da empresa escopada pelo token.
// Admin comum sempre usa a própria empresa; super-admin precisa selecionar
// explicitamente uma empresa via ?empresa_id= (tratado por verificarEmpresa).
// RBV9-INV-110: era `isAdmin`, que hoje não distingue ninguém — todo usuário interno
// carrega a classe legada. Estado comercial da empresa (plano, inadimplência) é
// `finance.saas.view`, que no baseline pertence a Administrador e Financeiro.
router.get('/plano-status', verifyToken, verificarEmpresa, requirePermission('finance.saas.view'), async (req, res) => {
  if (!req.empresa_id) {
    const message = req.user.is_super_admin === true
      ? 'Selecione uma empresa para consultar o status do plano.'
      : 'Empresa não identificada.';
    return res.status(400).json({ message });
  }

  try {
    return res.json(await carregarPlanoStatus(req.empresa_id, req.user));
  } catch (err) {
    console.error('Erro ao carregar status do plano:', err.message);
    return res.status(500).json({ message: 'Erro ao carregar status do plano.' });
  }
});

// Status mínimo para o app. Não expõe faturas, IDs Asaas nem dados de pagamento:
// informa somente o estado da própria empresa e quem deve conduzir a regularização.
router.get('/me/plano-status', verifyToken, verificarEmpresa, async (req, res) => {
  if (!req.empresa_id) {
    return res.status(400).json({ message: 'Empresa não identificada.' });
  }
  try {
    return res.json(await carregarPlanoStatus(req.empresa_id, req.user));
  } catch (err) {
    console.error('Erro ao carregar status de regularização:', err.message);
    return res.status(err.code === 'PGRST116' ? 404 : 500).json({ message: 'Erro ao carregar status de regularização.' });
  }
});

// ─── MINHAS FATURAS NO APP (autônomo) — read-only ────────────────────────────
// Lista as faturas da PRÓPRIA empresa (escopo do token via verificarEmpresa),
// para o app do motorista autônomo. SEM isAdmin: o app é motorista-only, e o
// autônomo é o dono do próprio negócio. Restrito a empresa.tipo='autonomo' — um
// motorista VINCULADO não deve ver o billing da transportadora (dado do dono).
//
// Read-only e defensivo por design:
//   * nenhuma escrita (sem INSERT/UPDATE/DELETE), nenhuma chamada ao Asaas,
//     nenhuma sincronização — o app só LÊ; a conciliação continua via webhook;
//   * whitelist de colunas no próprio SELECT: NUNCA retorna asaas_id,
//     pix_qr_code, client_request_id, plano_id nem a composição de preço
//     (preco_unitario/quantidade_snapshot) — só o que a tela precisa;
//   * isolamento tenant por empresa_id do token: faturas de outra empresa não
//     aparecem, e o ?empresa_id= só teria efeito para super-admin (que não usa
//     o app).
// O QR Pix continua sob demanda em GET /pagamentos/faturas/:id/pix (já isolado
// por tenant), reutilizável pelo app depois.
router.get('/me/faturas', verifyToken, verificarEmpresa, async (req, res) => {
  try {
    if (!req.empresa_id) {
      return res.status(400).json({ message: 'Empresa não identificada.' });
    }

    // Gate de tipo: faturas no app são só para autônomo.
    const { data: empresa, error: empErr } = await supabase
      .from('empresas')
      .select('id, tipo')
      .eq('id', req.empresa_id)
      .single();
    if (empErr || !empresa) {
      return res.status(404).json({ message: 'Empresa não encontrada.' });
    }
    if (empresa.tipo !== 'autonomo') {
      return res.status(403).json({ message: 'Faturas disponíveis apenas para autônomos no app.' });
    }

    // Whitelist explícita de colunas (o SELECT é a fronteira: nada fora daqui vaza).
    const { data, error } = await supabase
      .from('faturas')
      .select(
        'id, valor, tipo_pagamento, status, due_date, pago_em, invoice_url, ' +
        'bank_slip_url, periodo_referencia, origem, plano_nome_snapshot, ' +
        'modelo_cobranca_snapshot, created_at'
      )
      .eq('empresa_id', req.empresa_id)
      .order('due_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) {
      return res.status(500).json({ message: 'Erro ao carregar faturas.' });
    }
    return res.json(data || []);
  } catch (err) {
    console.error('[pagamentos/me/faturas] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao carregar faturas.' });
  }
});

// ─── FATURA DE REGULARIZAÇÃO (macrofrente fluxo financeiro) ──────────────────
// Gera (idempotente) a fatura que destrava a conta com pendência financeira e
// SEM fatura aberta: trial vencido ou suspensão financeira/sem motivo. Se já há
// fatura aberta, devolve-a sem criar nada. Gate hard de sandbox ANTES de tudo.
// A coreografia anti-duplicidade (reserva-primeiro + client_request_id
// determinístico + reconciliação por externalReference) vive no serviço.

// Whitelist de colunas devolvidas ao APP (mesma fronteira do GET /me/faturas):
// nunca vaza asaas_id, pix_qr_code, client_request_id, plano_id nem composição
// de preço. O QR Pix continua sob demanda em GET /faturas/:id/pix.
const CAMPOS_FATURA_APP = [
  'id', 'valor', 'tipo_pagamento', 'status', 'due_date', 'pago_em',
  'invoice_url', 'bank_slip_url', 'periodo_referencia', 'origem',
  'plano_nome_snapshot', 'modelo_cobranca_snapshot', 'created_at',
];
function projetarFaturaApp(fatura) {
  if (!fatura) return null;
  const out = {};
  for (const c of CAMPOS_FATURA_APP) out[c] = fatura[c] !== undefined ? fatura[c] : null;
  return out;
}

// Mensagens amigáveis por motivo de "pulada" (o app exibe direto).
const MENSAGENS_REGULARIZACAO = {
  cadastro_incompleto: 'Complete seu cadastro (nome, CPF/CNPJ e e-mail) para gerar a fatura. Fale com o suporte se precisar de ajuda.',
  trial_ainda_ativo: 'Seu período de teste ainda está ativo — nada a regularizar.',
  suspensao_nao_financeira: 'Esta conta não pode ser regularizada por pagamento. Fale com o suporte.',
  estado_sem_pendencia_financeira: 'Sua conta não tem pendência financeira no momento.',
  plano_invalido: 'Seu plano atual não permite gerar cobrança. Fale com o suporte.',
  plano_gratuito: 'Seu plano atual não gera cobrança. Fale com o suporte.',
};

async function executarRegularizacao(req, res, empresaId) {
  const { apiKey, baseURL } = await getAsaasConfig();
  const r = await gerarFaturaRegularizacao({
    supabase,
    http: axios,
    config: { apiKey, baseURL },
    empresaId,
  });

  if (r.resultado === 'gerada') {
    return res.status(201).json({ resultado: 'gerada', fatura: projetarFaturaApp(r.fatura) });
  }
  if (r.resultado === 'idempotente' || r.resultado === 'fatura_aberta') {
    return res.status(200).json({ resultado: r.resultado, fatura: projetarFaturaApp(r.fatura) });
  }
  if (r.resultado === 'pulada') {
    return res.status(422).json({
      resultado: 'pulada',
      motivo: r.motivo,
      message: MENSAGENS_REGULARIZACAO[r.motivo] || 'Não foi possível gerar a fatura de regularização.',
    });
  }
  // erro
  console.error('[pagamentos/regularizacao] Falha', { motivo: r.motivo || 'desconhecido' });
  return res.status(500).json({ message: 'Erro ao gerar fatura de regularização.' });
}

// APP (autônomo): a própria empresa do token. Sem isAdmin — o autônomo é
// motorista dono do negócio (mesmo gate de tipo do GET /me/faturas).
router.post('/me/regularizacao', verifyToken, verificarEmpresa, async (req, res) => {
  try {
    if (await bloquearSeNaoSandbox(res)) return;
    if (!req.empresa_id) {
      return res.status(400).json({ message: 'Empresa não identificada.' });
    }
    const { data: empresa, error: empErr } = await supabase
      .from('empresas')
      .select('id, tipo')
      .eq('id', req.empresa_id)
      .single();
    if (empErr || !empresa) {
      return res.status(404).json({ message: 'Empresa não encontrada.' });
    }
    if (empresa.tipo !== 'autonomo') {
      return res.status(403).json({ message: 'Regularização pelo app disponível apenas para autônomos.' });
    }
    return await executarRegularizacao(req, res, req.empresa_id);
  } catch (err) {
    console.error('[pagamentos/me/regularizacao] Falha', { motivo: err.motivo || err.message || 'desconhecido' });
    return res.status(500).json({ message: 'Erro ao gerar fatura de regularização.' });
  }
});

// SUPER-ADMIN: qualquer empresa (painel).
router.post('/regularizacao/:empresa_id', verifyToken, isSuperAdmin, async (req, res) => {
  try {
    if (await bloquearSeNaoSandbox(res)) return;
    return await executarRegularizacao(req, res, req.params.empresa_id);
  } catch (err) {
    console.error('[pagamentos/regularizacao/:empresa_id] Falha', { motivo: err.motivo || err.message || 'desconhecido' });
    return res.status(500).json({ message: 'Erro ao gerar fatura de regularização.' });
  }
});

router.get('/cobrancas/:empresa_id', verifyToken, verificarEmpresa, requirePermission('finance.saas.view'), async (req, res) => {
  try {
    // Admin comum: IGNORA o :empresa_id da URL e usa SEMPRE a própria empresa.
    // Super-admin: pode consultar qualquer empresa via :empresa_id.
    const empresaAlvo = req.user.is_super_admin === true
      ? req.params.empresa_id
      : req.empresa_id;

    const { data } = await supabase
      .from('faturas')
      .select('*')
      .eq('empresa_id', empresaAlvo)
      .order('created_at', { ascending: false });

    res.json(data || []);
  } catch (err) {
    res.status(500).json({ message: 'Erro ao listar cobranças.' });
  }
});

// Conciliação manual (super-admin): consulta a cobrança no Asaas e sincroniza a
// fatura sem depender do webhook. Não cria cobrança nova.
router.post('/cobrancas/:id/conciliar', verifyToken, isSuperAdmin, async (req, res) => {
  try {
    // GATE de sandbox: em produção não consulta o Asaas nem toca em fatura/empresa.
    if (await bloquearSeNaoSandbox(res)) return;

    const { data: fatura, error: fetchErr } = await supabase
      .from('faturas')
      .select('id, empresa_id, asaas_id, status, pago_em, due_date, invoice_url, bank_slip_url')
      .eq('id', req.params.id)
      .single();

    if (fetchErr || !fatura) {
      return res.status(404).json({ message: 'Fatura não encontrada.' });
    }
    if (!fatura.asaas_id) {
      return res.status(400).json({ message: 'Fatura sem cobrança Asaas vinculada.' });
    }

    const { apiKey, baseURL } = await getAsaasConfig();
    const { data: payment } = await axios.get(
      `${baseURL}/payments/${fatura.asaas_id}`,
      { headers: asaasHeaders(apiKey) }
    );

    const normalizado = normalizarStatusAsaas(payment?.status, fatura.status);
    if (!normalizado.conhecido) {
      return res.json(fatura);
    }

    const decisaoFatura = decidirAtualizacaoFatura({
      statusAtual: fatura.status,
      statusNovo: normalizado.status,
      pagoEmAtual: fatura.pago_em,
    });
    if (decisaoFatura.ignorar) return res.json(fatura);

    const { data: atualizada, error: updErr } = await supabase
      .from('faturas')
      .update(decisaoFatura.update)
      .eq('id', fatura.id)
      .select()
      .single();
    if (updErr) throw updErr;

    if (fatura.empresa_id) {
      const { data: empresa, error: empresaErr } = await supabase
        .from('empresas')
        .select('id, status, trial_ends_at, suspension_reason, suspension_source')
        .eq('id', fatura.empresa_id)
        .single();
      if (empresaErr) throw empresaErr;

      if (decisaoFatura.statusFinal === 'pago') {
        // Mesmos metadados que o webhook: sem reason/source a decisão trataria
        // toda suspensão como 'motivo desconhecido' e nunca reativaria.
        const decisaoConta = decidirTransicaoContaPorPagamento(empresa?.status, 'pago', {
          suspensionReason: empresa?.suspension_reason,
          suspensionSource: empresa?.suspension_source,
        });
        if (decisaoConta.deveAtualizar) {
          const upd = { status: decisaoConta.novoStatus };
          if (decisaoConta.deveLimparSuspensao) Object.assign(upd, patchLimparSuspensao());
          await supabase.from('empresas').update(upd).eq('id', fatura.empresa_id);
        }
      } else if (decisaoFatura.statusFinal === 'vencido') {
        const decisaoSuspensao = decidirSuspensaoPorInadimplencia({
          empresa,
          fatura: { ...fatura, status: decisaoFatura.statusFinal },
        });
        if (decisaoSuspensao.deveSuspender) {
          await supabase.from('empresas').update(patchSuspensaoFinanceiraAutomatica()).eq('id', fatura.empresa_id);
        }
      }
    }

    return res.json(atualizada);
  } catch (err) {
    console.error('Erro ao conciliar cobrança:', err.message);
    return res.status(500).json({ message: 'Erro ao conciliar cobrança.', error: err.response?.data || err.message });
  }
});

// ─── ASSINATURAS (piloto sandbox) ────────────────────────────────────────────
// Garante cliente + assinatura da conta e devolve o estado atual. Super-admin.
// Gate hard de sandbox ANTES de qualquer segredo/chamada. A criação da assinatura
// já gera a 1ª cobrança no Asaas — NÃO chamar o endpoint de cobrança avulsa aqui.
router.post('/assinaturas/:empresa_id/garantir', verifyToken, isSuperAdmin, async (req, res) => {
  try {
    if (await bloquearSeNaoSandbox(res)) return;
    const { apiKey, baseURL } = await getAsaasConfig();
    const resultado = await garantirAssinatura({
      empresaId: req.params.empresa_id,
      config: { apiKey, baseURL },
      supabase,
      http: axios,
    });
    return res.json(resultado);
  } catch (err) {
    const httpStatus = err.httpStatus || 500;
    // Log seguro: só operação + status + empresa_id (UUID, não é PII). Sem apiKey/payload.
    console.error('[pagamentos/assinaturas/garantir] Falha', { empresa_id: req.params.empresa_id, status: httpStatus });
    return res.status(httpStatus).json({ message: err.message || 'Erro ao configurar assinatura.' });
  }
});

// Conciliação read-only: sincroniza estado local e conta cobranças vinculadas.
// NÃO importa cobranças para `faturas` (isso é o BLOCO 4). Super-admin + gate sandbox.
router.post('/assinaturas/:empresa_id/conciliar', verifyToken, isSuperAdmin, async (req, res) => {
  try {
    if (await bloquearSeNaoSandbox(res)) return;
    const { apiKey, baseURL } = await getAsaasConfig();
    const resultado = await conciliarAssinatura({
      empresaId: req.params.empresa_id,
      config: { apiKey, baseURL },
      supabase,
      http: axios,
    });
    return res.json(resultado);
  } catch (err) {
    const httpStatus = err.httpStatus || 500;
    console.error('[pagamentos/assinaturas/conciliar] Falha', { empresa_id: req.params.empresa_id, status: httpStatus });
    return res.status(httpStatus).json({ message: err.message || 'Erro ao conciliar assinatura.' });
  }
});

// ─── SINCRONIZAÇÃO DE COBRANÇAS DA ASSINATURA (BLOCO 4) ──────────────────────
// Importa as cobranças já geradas pela assinatura Asaas para a tabela local.
// Super-admin (qualquer empresa) + administrador da própria conta.
// Gate sandbox hard (fail-closed em produção).

// Super-admin: sincroniza cobranças de uma conta específica.
router.post('/assinaturas/:empresa_id/sincronizar-cobrancas', verifyToken, isSuperAdmin, async (req, res) => {
  try {
    if (await bloquearSeNaoSandbox(res)) return;
    const { apiKey, baseURL } = await getAsaasConfig();
    const resultado = await sincronizarCobrancas({
      empresaId: req.params.empresa_id,
      config: { apiKey, baseURL },
      supabase,
      http: axios,
    });
    res.json(resultado);
  } catch (err) {
    const httpStatus = err.httpStatus || 500;
    console.error('[pagamentos/sincronizar] Falha', { empresa_id: req.params.empresa_id, status: httpStatus });
    res.status(httpStatus).json({ message: err.message || 'Erro ao sincronizar cobranças.' });
  }
});

// Administrador da própria conta: sincroniza suas cobranças.
router.post('/minhas-faturas/sincronizar', verifyToken, verificarEmpresa, requirePermission('finance.saas.view'), async (req, res) => {
  try {
    if (await bloquearSeNaoSandbox(res)) return;
    if (!req.empresa_id) {
      return res.status(400).json({ message: 'Empresa não identificada.' });
    }
    const { apiKey, baseURL } = await getAsaasConfig();
    const resultado = await sincronizarCobrancas({
      empresaId: req.empresa_id,
      config: { apiKey, baseURL },
      supabase,
      http: axios,
    });
    res.json(resultado);
  } catch (err) {
    const httpStatus = err.httpStatus || 500;
    console.error('[pagamentos/minhas-faturas/sincronizar] Falha', { status: httpStatus });
    res.status(httpStatus).json({ message: err.message || 'Erro ao sincronizar cobranças.' });
  }
});

// ─── SOLICITAÇÃO DE UPGRADE DE PLANO (Frente #8-C / PR 2) ─────────────────────
// Admin comum da empresa solicita a troca para um plano superior. Cria a
// solicitação pendente + a cobrança avulsa (sandbox) + a fatura local, SEM
// aplicar o plano (isso é o webhook, PR 3). Gate sandbox hard antes de tudo.
// Toda a coreografia idempotente vive em upgradeRequestService (testável).
// RBV9-INV-110: solicitar upgrade cria solicitação + cobrança + fatura — compromete a
// empresa financeiramente. `isAdmin` deixava qualquer usuário interno fazer isso. A
// autoridade é `company.settings.manage`, que no baseline só o Administrador tem.
router.post('/upgrade/solicitar', verifyToken, verificarEmpresa, requirePermission('company.settings.manage'), async (req, res) => {
  try {
    if (await bloquearSeNaoSandbox(res)) return;
    if (!req.empresa_id) {
      return res.status(400).json({ message: 'Empresa não identificada.' });
    }
    const { apiKey, baseURL } = await getAsaasConfig();
    const { httpStatus, resultado } = await solicitarUpgrade({
      empresaId: req.empresa_id,
      planoNovoId: req.body?.plano_novo_id,
      criadoPor: req.user?.uid || null,
      clientRequestId: req.body?.client_request_id,
      config: { apiKey, baseURL },
      supabase,
      http: axios,
    });
    return res.status(httpStatus).json(resultado);
  } catch (err) {
    const httpStatus = err.httpStatus || 500;
    const body = err.body || { message: err.message || 'Erro ao solicitar upgrade.' };
    if (httpStatus >= 500) {
      console.error('[pagamentos/upgrade/solicitar] Falha', { status: httpStatus });
    }
    return res.status(httpStatus).json(body);
  }
});

// ─── PIX SOB DEMANDA (BLOCO 4) ────────────────────────────────────────────────
// Recupera o QR Code Pix de uma fatura consultando o Asaas SOB DEMANDA.
// NÃO persiste imagem, payload, Base64 ou expiração no banco.
// Retorna contrato explícito: { encoded_image, payload, expiration_date }.
router.get('/faturas/:id/pix', verifyToken, async (req, res) => {
  try {
    const { data: fatura, error: fetchErr } = await supabase
      .from('faturas')
      .select('id, empresa_id, asaas_id, tipo_pagamento')
      .eq('id', req.params.id)
      .single();

    if (fetchErr || !fatura) {
      return res.status(404).json({ message: 'Fatura não encontrada.' });
    }

    // Tenant isolation: super-admin vê qualquer empresa; admin comum só a própria.
    if (!req.user?.is_super_admin) {
      const { data: usuario } = await supabase
        .from('usuarios')
        .select('empresa_id')
        .eq('id', req.user.uid)
        .maybeSingle();
      if (!usuario || usuario.empresa_id !== fatura.empresa_id) {
        return res.status(403).json({ message: 'Acesso negado.' });
      }
    }

    if (!fatura.asaas_id) {
      return res.status(400).json({ message: 'Fatura sem cobrança Asaas vinculada.' });
    }

    // Apenas PIX e BOLETO (boleto pode ter Pix vinculado) têm QR Code disponível
    if (fatura.tipo_pagamento !== 'PIX' && fatura.tipo_pagamento !== 'BOLETO') {
      return res.status(400).json({ message: 'Esta cobrança não suporta Pix.' });
    }

    // Gate sandbox
    if (await bloquearSeNaoSandbox(res)) return;

    const { apiKey, baseURL } = await getAsaasConfig();

    // Consulta o Asaas para obter o QR Code completo (payload + imagem base64 + expiração)
    try {
      const { data: pixData } = await axios.get(
        `${baseURL}/payments/${fatura.asaas_id}/pixQrCode`,
        { headers: asaasHeaders(apiKey) }
      );

      // Asaas sandbox retorna: { payload, encodedImage, expirationDate }
      // encodedImage = base64 PNG do QR Code (sem prefixo data:image)
      // payload = copia e cola (EMV)
      // expirationDate = ISO string

      const encodedImage = pixData?.encodedImage || null;
      const payload = pixData?.payload || null;
      const expirationDate = pixData?.expirationDate || null;

      // Retorna contrato sanitizado e explícito — NÃO persiste nada
      return res.json({
        encoded_image: encodedImage,
        payload,
        expiration_date: expirationDate,
      });
    } catch (asaasErr) {
      console.error('[pix sob demanda] Erro ao consultar Asaas:', asaasErr.message);
      return res.status(502).json({ message: 'Erro ao consultar Pix no Asaas.' });
    }
  } catch (err) {
    res.status(500).json({ message: 'Erro ao consultar Pix.' });
  }
});

// ─── 3A-2: BILLING AUTOMÁTICO — visão e contingência (super-admin) ────────────
// Endpoints READ/PLAN: NÃO fazem write no Asaas (execução real é o Gate 3A-2
// sandbox). Servem para observar o estado e planejar/reconciliar de forma segura.

// Visão administrativa do billing de UMA empresa (§36).
router.get('/billing/overview/:empresa_id', verifyToken, isSuperAdmin, async (req, res) => {
  const empresaId = req.params.empresa_id;
  try {
    const { data: empresa, error } = await supabase
      .from('empresas')
      .select('id, nome, status, plano_id, trial_ends_at, asaas_customer_id, asaas_subscription_id, billing_status, next_due_date, billing_updated_at, planos(nome)')
      .eq('id', empresaId)
      .maybeSingle();
    if (error) throw error;
    if (!empresa) return res.status(404).json({ message: 'Empresa nao encontrada.' });

    const [{ data: faturas }, situacao, { data: webhook }] = await Promise.all([
      supabase.from('faturas').select('status, valor, vencimento, created_at').eq('empresa_id', empresaId).order('created_at', { ascending: false }).limit(12),
      carregarSituacaoComercial(supabase, empresaId),
      supabase.from('asaas_webhook_events').select('event_type, status, processed_at').eq('empresa_id', empresaId).order('processed_at', { ascending: false }).limit(1).maybeSingle().then((r) => r).catch(() => ({ data: null })),
    ]);

    const policy = resolvePolicy();
    const linha = montarLinhaBilling({
      empresa,
      plano: empresa.planos || null,
      faturas: faturas || [],
      situacao,
      ultimoWebhook: webhook || null,
      gracaDias: policy.grace_period_days,
    });
    return res.json({ overview: linha, policy });
  } catch (err) {
    console.error('[pagamentos/billing/overview] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao carregar overview de billing.' });
  }
});

// Plano de billing para a empresa (dry-run do orquestrador; sem writes) (§24/§37).
router.post('/billing/ensure-plan/:empresa_id', verifyToken, isSuperAdmin, async (req, res) => {
  const empresaId = req.params.empresa_id;
  try {
    const { data: empresa, error } = await supabase
      .from('empresas')
      .select('id, asaas_customer_id, asaas_subscription_id, implantacao_cobrada, next_due_date, trial_ends_at')
      .eq('id', empresaId)
      .maybeSingle();
    if (error) throw error;
    if (!empresa) return res.status(404).json({ message: 'Empresa nao encontrada.' });

    const situacao = await carregarSituacaoComercial(supabase, empresaId);
    const { data: proposta } = await supabase
      .from('propostas_comerciais')
      .select('snapshot, valor_mensal, valor_implantacao')
      .eq('empresa_id', empresaId)
      .order('criado_em', { ascending: false })
      .limit(1)
      .maybeSingle();
    const snapshot = proposta?.snapshot || { valor_mensal: proposta?.valor_mensal, valor_implantacao: proposta?.valor_implantacao } || {};

    const policy = resolvePolicy(req.body?.policy || {});
    const plano = planejarBilling({ situacao, empresaBilling: empresa, snapshot, addOns: [], policy });
    return res.json({ plano, policy, executado: false, nota: 'dry-run: execução real é o Gate 3A-2 (sandbox).' });
  } catch (err) {
    console.error('[pagamentos/billing/ensure-plan] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao planejar billing.' });
  }
});

// Reconciliação (divergências) — dry, sem reparar automaticamente aqui (§23).
router.post('/billing/reconciliar-plan/:empresa_id', verifyToken, isSuperAdmin, async (req, res) => {
  const empresaId = req.params.empresa_id;
  try {
    const { data: empresa, error } = await supabase
      .from('empresas')
      .select('id, asaas_customer_id, asaas_subscription_id')
      .eq('id', empresaId)
      .maybeSingle();
    if (error) throw error;
    if (!empresa) return res.status(404).json({ message: 'Empresa nao encontrada.' });

    const { data: faturas } = await supabase
      .from('faturas')
      .select('asaas_payment_id, status')
      .eq('empresa_id', empresaId);

    // Estado remoto é fornecido pelo chamador (contingência) ou vazio: sem chamada
    // externa aqui. Em sandbox/gate, o remoto vem do provider.
    const remoto = req.body?.remoto || { customer: null, subscription: null, charges: [] };
    const local = {
      asaas_customer_id: empresa.asaas_customer_id || null,
      asaas_subscription_id: empresa.asaas_subscription_id || null,
      faturas: faturas || [],
    };
    const resultado = reconciliar({ local, remoto });
    return res.json({ reconciliacao: resultado, executado: false });
  } catch (err) {
    console.error('[pagamentos/billing/reconciliar-plan] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao reconciliar billing.' });
  }
});

// Worker do outbox (job/contingência) — MESMA engine da automação (§14).
// Provider por política: fake por padrão; sandbox só com prova de ambiente +
// credencial; produção fail-closed. NÃO executa Asaas produção.
router.post('/billing/processar-outbox', verifyToken, isSuperAdmin, async (req, res) => {
  try {
    const limite = Math.min(50, Math.max(1, Number(req.body?.limite) || 10));
    const resumo = await processarOutbox({ supabase, limite });
    return res.json({ resumo });
  } catch (err) {
    console.error('[pagamentos/billing/processar-outbox] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao processar outbox.' });
  }
});

// Contagem de jobs do outbox (observabilidade do painel).
router.get('/billing/jobs', verifyToken, isSuperAdmin, async (req, res) => {
  try {
    const empresaId = req.query.empresa_id || null;
    const r = await contarPorStatus(supabase, empresaId);
    if (r.code !== 'ok') return res.json({ contagem: { pending: 0, processing: 0, processed: 0, failed: 0, dead: 0 }, indisponivel: true });
    return res.json({ contagem: r.contagem });
  } catch (err) {
    console.error('[pagamentos/billing/jobs] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao contar jobs.' });
  }
});

router.post('/webhook/asaas', async (req, res) => {
  try {
    // 1. Autenticação: token fixo no header 'asaas-access-token'.
    // Fail-closed: sem env var configurada OU header ausente/diferente → 401.
    const expected = process.env.ASAAS_WEBHOOK_TOKEN;
    const received = req.headers['asaas-access-token'];
    if (!expected || !received || !safeEqual(received, expected)) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // 2. Delegar processamento ao serviço (validação, persistência idempotente,
    //    resolução interna da fatura/empresa, transições financeiras seguras).
    const resultado = await processarWebhook({
      supabase,
      body: req.body,
    });

    // 3A-2: enfileira um evento de reconciliação de billing (fail-open, idempotente
    // por competência do dia). O worker do outbox reconcilia o estado; NÃO chamamos
    // Asaas aqui. Nunca derruba a resposta do webhook.
    try {
      const empId = resultado?.resultado?.empresa_id || null;
      if (empId) {
        const hoje = new Date().toISOString().slice(0, 10);
        await emitirEventoBilling(supabase, { empresaId: empId, tipo: 'webhook', competencia: hoje });
      }
    } catch { /* fail-open: reconcile periódico recupera */ }

    return res.status(resultado.httpStatus).json(resultado.resultado);
  } catch (err) {
    // Erro não tratado no serviço: 500 para retry do Asaas.
    console.error('Webhook Asaas error:', sanitizar(err.message));
    return res.status(500).json({ message: 'Erro ao processar webhook.' });
  }
});

// ─── GERAÇÃO DE FATURA RECORRENTE (Frente #5 / PR 3 — sandbox) ────────────────
// Aciona MANUALMENTE a geração de fatura recorrente mensal (cobrança avulsa PIX)
// através do faturaRecorrenteService. NÃO é job/cron: acionamento explícito por
// super-admin. Gate hard de sandbox ANTES de config/serviço/rede. A coreografia
// idempotente (reserva-primeiro + reconciliação) e a decisão de elegibilidade
// vivem no serviço/domínio, testados à parte.
//
//   body: { empresa_id?, data_referencia? (YYYY-MM-DD), dry_run?, limite? }
//   - dry_run=true: apenas AVALIA (sem Asaas, sem insert, sem customer);
//   - empresa_id: processa só aquela empresa;
//   - sem empresa_id: lote conservador de empresas ativas SEM assinatura Asaas.
const LIMITE_LOTE_PADRAO = 20;
const LIMITE_LOTE_MAX = 100;

router.post('/faturas-recorrentes/gerar', verifyToken, isSuperAdmin, async (req, res) => {
  try {
    // GATE de sandbox ANTES de qualquer config/serviço/rede.
    if (await bloquearSeNaoSandbox(res)) return;

    const empresaId = (req.body && req.body.empresa_id) || null;
    const dataReferencia =
      (req.body && /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.data_referencia || '')))
        ? req.body.data_referencia
        : new Date().toISOString().slice(0, 10);
    const dryRun = req.body && req.body.dry_run === true;

    let limite = Number(req.body && req.body.limite);
    if (!Number.isInteger(limite) || limite <= 0) limite = LIMITE_LOTE_PADRAO;
    if (limite > LIMITE_LOTE_MAX) limite = LIMITE_LOTE_MAX;

    const selectEmpresa =
      `${CAMPOS_EMPRESA}, planos(id, nome, ativo, arquivado_em, preco_mensal, modelo_cobranca, preco_por_motorista, limite_motoristas)`;

    let empresas;
    if (empresaId) {
      const { data, error } = await supabase
        .from('empresas')
        .select(selectEmpresa)
        .eq('id', empresaId)
        .maybeSingle();
      if (error) return res.status(500).json({ message: 'Erro ao carregar empresa.' });
      if (!data) return res.status(404).json({ message: 'Empresa não encontrada.' });
      empresas = [data];
    } else {
      // Lote conservador: só ativas e SEM assinatura Asaas (evita duplicidade com
      // a cobrança recorrente da própria assinatura). O recorte fino de
      // elegibilidade (plano, gratuito, recorrente já existente) fica no serviço.
      const { data, error } = await supabase
        .from('empresas')
        .select(selectEmpresa)
        .eq('status', 'ativo')
        .is('asaas_subscription_id', null)
        .limit(limite);
      if (error) return res.status(500).json({ message: 'Erro ao listar empresas.' });
      empresas = data || [];
    }

    // dry_run não resolve a apiKey (não há chamada externa); só o modo real precisa.
    let config = {};
    if (!dryRun) {
      const { apiKey, baseURL } = await getAsaasConfig();
      config = { apiKey, baseURL };
    }

    const resumo = await gerarFaturaRecorrenteEmLote({
      supabase,
      http: axios,
      config,
      empresas,
      dataReferencia,
      dryRun,
    });
    return res.json(resumo);
  } catch (err) {
    // Log seguro: sem apiKey/payload/PII.
    console.error('[pagamentos/faturas-recorrentes/gerar] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao gerar faturas recorrentes.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SYNC AUTOMÁTICO ASAAS (SANDBOX) — mega-frente comercial, FASE 4 (wiring)
//
// Matopiba é a fonte da verdade do valor; o Asaas é processador. O sync ajusta o
// VALOR FUTURO da assinatura por empresa (forward-only). Decisão pura em
// asaasSyncDomainService; a chamada ao Asaas em asaasSubscriptionService. Todo o
// processamento é SANDBOX-GATED (bloquearSeNaoSandbox) — nunca production. As
// tabelas (migration 042) podem não existir ainda → tratamos como 503.
// ═══════════════════════════════════════════════════════════════════════════

function tabelaSyncAusente(error) {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  return /relation .* does not exist|could not find the table|does not exist/i.test(error.message || '');
}

// GET /pagamentos/asaas-sync/estado — observabilidade da fila de sync.
router.get('/asaas-sync/estado', verifyToken, isSuperAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('asaas_sync_estado')
    .select('*')
    .order('atualizado_em', { ascending: false })
    .limit(500);
  if (error) {
    if (tabelaSyncAusente(error)) return res.status(503).json({ message: 'Sync Asaas ainda não provisionado (migration 042 pendente).' });
    return res.status(500).json({ message: 'Erro ao ler estado de sync.' });
  }
  const linhas = data || [];
  const contadores = {
    pendente: linhas.filter((l) => l.status === 'pendente').length,
    sincronizado: linhas.filter((l) => l.status === 'sincronizado').length,
    erro: linhas.filter((l) => l.status === 'erro').length,
  };
  res.json({ contadores, estado: linhas });
});

// POST /pagamentos/asaas-sync/marcar — marca as empresas de um plano como
// pendentes de sync (ex.: após reprecificar o plano). Body: { plano_id, motivo }.
router.post('/asaas-sync/marcar', verifyToken, isSuperAdmin, async (req, res) => {
  const plano_id = req.body && req.body.plano_id;
  const motivo = (req.body && req.body.motivo) || 'plano_editado';
  if (!plano_id) return res.status(400).json({ message: 'Informe o plano_id.' });

  const { data: empresas, error: empErr } = await supabase
    .from('empresas')
    .select('id, plano_id, status, arquivada_em, asaas_subscription_id')
    .eq('plano_id', plano_id);
  if (empErr) return res.status(500).json({ message: 'Erro ao carregar empresas do plano.' });

  const afetadas = asaasSync.empresasAfetadasPorPlano({ empresas: empresas || [], planoId: plano_id });
  if (afetadas.length === 0) return res.json({ marcadas: 0, empresas: [] });

  // Valor-alvo = preço atual do plano (autoridade do backend). Preenche a fila.
  const { data: planoRow } = await supabase.from('planos').select('preco_mensal').eq('id', plano_id).maybeSingle();
  const valorAlvo = planoRow && planoRow.preco_mensal != null ? Number(planoRow.preco_mensal) : null;

  const subById = new Map((empresas || []).map((e) => [e.id, e.asaas_subscription_id || null]));
  const linhas = afetadas.map((id) =>
    asaasSync.montarEstadoPendente({ empresaId: id, motivo, valorAlvo, asaasSubscriptionId: subById.get(id) }));
  const { error: upErr } = await supabase.from('asaas_sync_estado').upsert(linhas, { onConflict: 'empresa_id' });
  if (upErr) {
    if (tabelaSyncAusente(upErr)) return res.status(503).json({ message: 'Sync Asaas ainda não provisionado (migration 042 pendente).' });
    return res.status(500).json({ message: 'Erro ao marcar empresas para sync.' });
  }
  res.json({ marcadas: afetadas.length, empresas: afetadas });
});

// POST /pagamentos/asaas-sync/processar — processa a fila pendente (SANDBOX).
// Para cada empresa: decide (avaliarSync) e cria/atualiza a assinatura sandbox,
// registrando estado + auditoria. Idempotente; forward-only; nunca toca fatura.
router.post('/asaas-sync/processar', verifyToken, isSuperAdmin, async (req, res) => {
  if (await bloquearSeNaoSandbox(res)) return;

  const limite = Math.min(Number(req.body && req.body.limite) || 25, 100);
  const { data: fila, error: filaErr } = await supabase
    .from('asaas_sync_estado')
    .select('empresa_id, tentativas')
    .eq('status', 'pendente')
    .limit(limite);
  if (filaErr) {
    if (tabelaSyncAusente(filaErr)) return res.status(503).json({ message: 'Sync Asaas ainda não provisionado (migration 042 pendente).' });
    return res.status(500).json({ message: 'Erro ao ler fila de sync.' });
  }
  if (!fila || fila.length === 0) return res.json({ processadas: 0, sincronizadas: 0, puladas: 0, erros: 0 });

  const config = await getAsaasConfig();
  const resumo = { processadas: 0, sincronizadas: 0, puladas: 0, erros: 0, detalhes: [] };

  for (const item of fila) {
    resumo.processadas += 1;
    const empresaId = item.empresa_id;
    let empresa = null;
    try {
      // `*` no empresa é deploy-safe p/ quantidade_contratada (044); o join de
      // planos traz os campos comerciais (038 já aplicada).
      const { data: e } = await supabase
        .from('empresas')
        .select('*, planos(id, preco_mensal, requer_negociacao, capacidade_inclusa, preco_motorista_extra)')
        .eq('id', empresaId)
        .single();
      empresa = e;
    } catch (_) { empresa = null; }

    const plano = empresa && (Array.isArray(empresa.planos) ? empresa.planos[0] : empresa.planos);
    const cadastroCompleto = Boolean(empresa && empresa.cnpj);
    // valor-alvo = valor EFETIVO (base + extras) pela quantidade contratada; sem
    // quantidade / não acomoda → null → avaliarSync cai para plano.preco_mensal.
    const { valorEfetivo } = derivarValorEfetivoFatura({ plano, quantidade_contratada: empresa && empresa.quantidade_contratada });
    const decisao = asaasSync.avaliarSync({ empresa: empresa || { id: empresaId, status: null }, plano, valorExplicito: valorEfetivo, cadastroCompleto });

    let ok = false; let erro = null; let valorAntes = null; let valorDepois = decisao.valorAlvo; let subId = empresa && empresa.asaas_subscription_id;
    try {
      if (decisao.acao === asaasSync.ACAO.CRIAR) {
        await garantirAssinatura({ empresaId, config, supabase, http: axios });
        ok = true;
        // Re-lê o id da assinatura recém-criada (garantirAssinatura o salva em
        // empresas) para gravar no snapshot da fila/auditoria.
        try {
          const { data: eNova } = await supabase.from('empresas').select('asaas_subscription_id').eq('id', empresaId).single();
          if (eNova && eNova.asaas_subscription_id) subId = eNova.asaas_subscription_id;
        } catch (_) { /* snapshot do id é best-effort */ }
      } else if (decisao.acao === asaasSync.ACAO.ATUALIZAR_VALOR) {
        const r = await atualizarValorAssinatura({ empresaId, valorAlvo: decisao.valorAlvo, config, supabase, http: axios });
        if (r.needsCreate) {
          await garantirAssinatura({ empresaId, config, supabase, http: axios });
          try { const { data: eNova } = await supabase.from('empresas').select('asaas_subscription_id').eq('id', empresaId).single(); if (eNova && eNova.asaas_subscription_id) subId = eNova.asaas_subscription_id; } catch (_) { /* best-effort */ }
        }
        valorAntes = r.valor_antes; subId = r.asaas_subscription_id || subId; ok = true;
      } else if (decisao.acao === asaasSync.ACAO.PULAR) {
        ok = true; valorDepois = null;
        resumo.puladas += 1;
      } else {
        erro = decisao.motivo; ok = false;
      }
    } catch (err) {
      ok = false; erro = (err && (err.message || err.motivo)) || 'falha no sync';
    }

    // Auditoria (append) + estado (upsert). Best-effort: falha aqui não derruba o lote.
    try {
      await supabase.from('asaas_sync_tentativas').insert(asaasSync.montarTentativa({
        empresaId, acao: decisao.acao, valorAntes, valorDepois,
        resultado: decisao.acao === asaasSync.ACAO.PULAR ? 'pulado' : (ok ? 'ok' : 'erro'),
        erro, asaasSubscriptionId: subId,
      }));
      await supabase.from('asaas_sync_estado').upsert(
        asaasSync.montarEstadoResultado({ empresaId, ok, valorAlvo: decisao.valorAlvo, erro, asaasSubscriptionId: subId, tentativasAtual: item.tentativas }),
        { onConflict: 'empresa_id' });
    } catch (_) { /* melhor esforço */ }

    if (decisao.acao !== asaasSync.ACAO.PULAR) { if (ok) resumo.sincronizadas += 1; else resumo.erros += 1; }
    resumo.detalhes.push({ empresa_id: empresaId, acao: decisao.acao, ok, erro });
  }

  res.json(resumo);
});

module.exports = router;
