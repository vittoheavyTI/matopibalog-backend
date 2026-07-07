const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const supabase = require('../config/supabase');
const { verifyToken, isAdmin, isSuperAdmin } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { resolveAsaasApiKey } = require('../utils/asaasConfig');
const { normalizarStatusAsaas } = require('../utils/asaasStatus');
const { classificarResponsavelRegularizacao } = require('../utils/billingProfile');

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
    const { apiKey, baseURL } = await getAsaasConfig();

    const response = await axios.post(`${baseURL}/customers`, {
      name: nome,
      cpfCnpj,
      email,
      phone: telefone,
      notificationDisabled: false,
    }, { headers: asaasHeaders(apiKey) });

    await supabase.from('empresas').update({
      asaas_customer_id: response.data.id,
    }).eq('id', empresa_id);

    res.json({ customer_id: response.data.id });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao criar cliente Asaas.', error: err.response?.data || err.message });
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
    const statusInterno = normalizarStatusAsaas(response.data.status);

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
      .select('id, empresa_id, asaas_id, status, pago_em')
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

    const novoStatus = normalizarStatusAsaas(payment?.status);

    // Preserva pago_em: só grava na primeira vez que a fatura vira 'pago'.
    const updatePayload = { status: novoStatus };
    if (novoStatus === 'pago' && !fatura.pago_em) {
      updatePayload.pago_em = new Date().toISOString();
    }

    const { data: atualizada, error: updErr } = await supabase
      .from('faturas')
      .update(updatePayload)
      .eq('id', fatura.id)
      .select()
      .single();
    if (updErr) throw updErr;

    // Efeitos na empresa (espelham o webhook): pago → ativo; vencido → suspenso.
    // Cancelado/estornado NÃO rebaixam o acesso automaticamente — cortar acesso
    // por cancelamento/estorno é decisão manual do super-admin (evita cortar por
    // estorno parcial ou engano).
    if (fatura.empresa_id) {
      if (novoStatus === 'pago') {
        await supabase.from('empresas').update({ status: 'ativo' }).eq('id', fatura.empresa_id);
      } else if (novoStatus === 'vencido') {
        await supabase.from('empresas').update({ status: 'suspenso' }).eq('id', fatura.empresa_id);
      }
    }

    return res.json(atualizada);
  } catch (err) {
    console.error('Erro ao conciliar cobrança:', err.message);
    return res.status(500).json({ message: 'Erro ao conciliar cobrança.', error: err.response?.data || err.message });
  }
});

router.post('/webhook/asaas', async (req, res) => {
  try {
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

    // Mapeia o evento para o status interno. Evento desconhecido → null
    // (ignorado adiante, sem tocar na fatura — antes virava 'pendente').
    let novoStatus = null;
    if (eventType === 'PAYMENT_CONFIRMED' || eventType === 'PAYMENT_RECEIVED') {
      novoStatus = 'pago';
    } else if (eventType === 'PAYMENT_OVERDUE') {
      novoStatus = 'vencido';
    } else if (eventType === 'PAYMENT_CANCELED') {
      novoStatus = 'cancelado';
    } else if (eventType === 'PAYMENT_REFUNDED') {
      novoStatus = 'estornado';
    }

    if (novoStatus === null) {
      return res.status(200).json({ received: true, ignored: true });
    }

    // Busca a fatura atual ANTES de alterar, para idempotência e ordem de eventos.
    const { data: fatura, error: fetchError } = await supabase
      .from('faturas')
      .select('id, empresa_id, status, pago_em')
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

    // Ordem de eventos: fatura já paga NÃO pode ser rebaixada para vencido/cancelado
    // por evento fora de ordem (ex.: OVERDUE chegando após CONFIRMED). Estorno é
    // transição legítima e segue (comportamento preservado).
    if (fatura.status === 'pago' && (novoStatus === 'vencido' || novoStatus === 'cancelado')) {
      return res.status(200).json({ received: true, ignored: true });
    }

    // Monta o update preservando pago_em (W1): só preenche na primeira confirmação;
    // nunca sobrescreve em replay e nunca zera em eventos não-pago.
    const updatePayload = { status: novoStatus };
    if (novoStatus === 'pago' && !fatura.pago_em) {
      updatePayload.pago_em = new Date().toISOString();
    }

    const { error: updateError } = await supabase
      .from('faturas')
      .update(updatePayload)
      .eq('id', fatura.id);

    if (updateError) throw updateError;

    // Efeitos na empresa (mantidos): pago → ativo; vencido → suspenso.
    if (novoStatus === 'pago' && fatura.empresa_id) {
      await supabase
        .from('empresas')
        .update({ status: 'ativo' })
        .eq('id', fatura.empresa_id);
    }

    if (novoStatus === 'vencido' && fatura.empresa_id) {
      await supabase
        .from('empresas')
        .update({ status: 'suspenso' })
        .eq('id', fatura.empresa_id);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    // Retorno honesto (W4): erro interno real → 500 para o Asaas reenviar.
    console.error('Webhook Asaas error:', err.message);
    return res.status(500).json({ message: 'Erro ao processar webhook.' });
  }
});

module.exports = router;
