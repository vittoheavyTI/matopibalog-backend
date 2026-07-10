const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const supabase = require('../config/supabase');
const { verifyToken, isAdmin, isSuperAdmin } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { resolveAsaasApiKey } = require('../utils/asaasConfig');
const { classificarResponsavelRegularizacao } = require('../utils/billingProfile');
const { garantirAssinatura, conciliarAssinatura } = require('../services/asaasSubscriptionService');
const { sincronizarCobrancas } = require('../services/asaasInvoiceSyncService');
const {
  normalizarStatusAsaas,
  normalizarEventoAsaas,
  decidirAtualizacaoFatura,
  decidirTransicaoContaPorPagamento,
  decidirSuspensaoPorInadimplencia,
} = require('../services/paymentDomainService');

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
      suporte_email: configResult.data?.dados?.email_suporte || null,
    },
  };
}

// Estado read-only do plano da empresa escopada pelo token.
// Admin comum sempre usa a própria empresa; super-admin precisa selecionar
// explicitamente uma empresa via ?empresa_id= (tratado por verificarEmpresa).
router.get('/plano-status', verifyToken, isAdmin, verificarEmpresa, async (req, res) => {
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

router.get('/cobrancas/:empresa_id', verifyToken, isAdmin, verificarEmpresa, async (req, res) => {
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
        .select('id, status, trial_ends_at')
        .eq('id', fatura.empresa_id)
        .single();
      if (empresaErr) throw empresaErr;

      if (decisaoFatura.statusFinal === 'pago') {
        const decisaoConta = decidirTransicaoContaPorPagamento(empresa?.status, 'pago');
        if (decisaoConta.deveAtualizar) {
          await supabase.from('empresas').update({ status: decisaoConta.novoStatus }).eq('id', fatura.empresa_id);
        }
      } else if (decisaoFatura.statusFinal === 'vencido') {
        const decisaoSuspensao = decidirSuspensaoPorInadimplencia({
          empresa,
          fatura: { ...fatura, status: decisaoFatura.statusFinal },
        });
        if (decisaoSuspensao.deveSuspender) {
          await supabase.from('empresas').update({ status: decisaoSuspensao.novoStatus }).eq('id', fatura.empresa_id);
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
router.post('/minhas-faturas/sincronizar', verifyToken, isAdmin, verificarEmpresa, async (req, res) => {
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

router.post('/webhook/asaas', async (req, res) => {
  try {
    // Bloco B envolverá este endpoint com persistência idempotente da migration 024.
    // Portão de autenticação: o Asaas envia um token fixo no header
    // 'asaas-access-token' em toda requisição. Comparar com o segredo nosso.
    // Fail-closed: sem env var configurada OU header ausente/diferente → 401.
    const expected = process.env.ASAAS_WEBHOOK_TOKEN;
    const received = req.headers['asaas-access-token'];
    if (!expected || !received || !safeEqual(received, expected)) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // Validação mínima de payload (sem logar o corpo). Malformado → 400.
    const body = req.body;
    const eventType = body?.event;
    const payment = body?.payment;
    if (typeof eventType !== 'string' || !payment || typeof payment.id !== 'string') {
      return res.status(400).json({ message: 'Payload inválido.' });
    }
    const asaasId = payment.id;

    // Busca a fatura atual ANTES de alterar, para idempotência e ordem de eventos.
    const { data: fatura, error: fetchError } = await supabase
      .from('faturas')
      .select('id, empresa_id, status, pago_em, due_date, invoice_url, bank_slip_url')
      .eq('asaas_id', asaasId)
      .single();

    if (fetchError) {
      // PGRST116 = nenhuma linha: cobrança não é nossa → ignora com 200.
      // Qualquer outro erro é falha real de banco → propaga p/ o catch (retry Asaas).
      if (fetchError.code === 'PGRST116') {
        return res.status(200).json({ received: true, ignored: true });
      }
      throw fetchError;
    }
    if (!fatura) {
      return res.status(200).json({ received: true, ignored: true });
    }

    const normalizado = normalizarEventoAsaas(eventType, fatura.status);
    if (!normalizado.conhecido) {
      return res.status(200).json({ received: true, ignored: true });
    }

    const decisaoFatura = decidirAtualizacaoFatura({
      statusAtual: fatura.status,
      statusNovo: normalizado.status,
      pagoEmAtual: fatura.pago_em,
    });
    if (decisaoFatura.ignorar) {
      return res.status(200).json({ received: true, ignored: true });
    }

    const { error: updateError } = await supabase
      .from('faturas')
      .update(decisaoFatura.update)
      .eq('id', fatura.id);

    if (updateError) throw updateError;

    if (fatura.empresa_id) {
      const { data: empresa, error: empresaErr } = await supabase
        .from('empresas')
        .select('id, status, trial_ends_at')
        .eq('id', fatura.empresa_id)
        .single();
      if (empresaErr) throw empresaErr;

      if (decisaoFatura.statusFinal === 'pago') {
        const decisaoConta = decidirTransicaoContaPorPagamento(empresa?.status, 'pago');
        if (decisaoConta.deveAtualizar) {
          await supabase
            .from('empresas')
            .update({ status: decisaoConta.novoStatus })
            .eq('id', fatura.empresa_id);
        }
      } else if (decisaoFatura.statusFinal === 'vencido') {
        const decisaoSuspensao = decidirSuspensaoPorInadimplencia({
          empresa,
          fatura: { ...fatura, status: decisaoFatura.statusFinal },
        });
        if (decisaoSuspensao.deveSuspender) {
          await supabase
            .from('empresas')
            .update({ status: decisaoSuspensao.novoStatus })
            .eq('id', fatura.empresa_id);
        }
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    // Retorno honesto (W4): erro interno real → 500 para o Asaas reenviar.
    console.error('Webhook Asaas error:', err.message);
    return res.status(500).json({ message: 'Erro ao processar webhook.' });
  }
});

module.exports = router;
