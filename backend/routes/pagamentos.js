const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const supabase = require('../config/supabase');
const { verifyToken, isAdmin, isSuperAdmin } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { resolveAsaasApiKey } = require('../utils/asaasConfig');

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
  
  return { apiKey, baseURL };
}

function asaasHeaders(apiKey) {
  return {
    'access_token': apiKey,
    'Content-Type': 'application/json',
  };
}

router.post('/clientes', verifyToken, isSuperAdmin, async (req, res) => {
  try {
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
    const { empresa_id, valor, tipo, descricao, parcelas } = req.body;
    const { apiKey, baseURL } = await getAsaasConfig();

    const { data: empresa } = await supabase
      .from('empresas')
      .select('asaas_customer_id, nome')
      .eq('id', empresa_id)
      .single();

    if (!empresa?.asaas_customer_id) {
      return res.status(400).json({ message: 'Empresa sem cliente Asaas. Crie o cliente primeiro.' });
    }

    const payload = {
      customer: empresa.asaas_customer_id,
      value: Number(valor),
      description: descricao || `Assinatura ${empresa.nome}`,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      postalService: false,
    };

    if (tipo === 'PIX') {
      payload.billingType = 'PIX';
    } else if (tipo === 'BOLETO') {
      payload.billingType = 'BOLETO';
    } else if (tipo === 'CARTAO') {
      payload.billingType = 'CREDIT_CARD';
    }

    const response = await axios.post(`${baseURL}/payments`, payload, { headers: asaasHeaders(apiKey) });

    await supabase.from('faturas').insert({
      empresa_id,
      asaas_id: response.data.id,
      valor: Number(valor),
      tipo_pagamento: tipo,
      status: response.data.status,
      invoice_url: response.data.invoiceUrl,
      pix_qr_code: response.data.pixQrCode,
      due_date: payload.dueDate,
    });

    res.json(response.data);
  } catch (err) {
    res.status(500).json({ message: 'Erro ao criar cobrança.', error: err.response?.data || err.message });
  }
});

// IMPORTANTE: rota literal /all ANTES da paramétrica /:empresa_id (senão é capturada)
router.get('/cobrancas/all', verifyToken, isSuperAdmin, async (req, res) => {
  try {
    const { data } = await supabase
      .from('faturas')
      .select('*, empresas(nome)')
      .order('created_at', { ascending: false });

    res.json(data || []);
  } catch (err) {
    res.status(500).json({ message: 'Erro ao listar todas as cobranças.' });
  }
});

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
    const { data: empresa, error } = await supabase
      .from('empresas')
      .select('status, trial_ends_at, plano_id, planos(nome, preco_mensal, limite_motoristas)')
      .eq('id', req.empresa_id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ message: 'Empresa não encontrada.' });
      }
      throw error;
    }
    if (!empresa) {
      return res.status(404).json({ message: 'Empresa não encontrada.' });
    }

    const trialExpirado = empresa.status === 'trial' && Boolean(
      empresa.trial_ends_at && new Date(empresa.trial_ends_at) < new Date()
    );

    return res.json({
      status: empresa.status,
      trial_ends_at: empresa.trial_ends_at,
      trial_expirado: trialExpirado,
      plano_id: empresa.plano_id,
      plano: empresa.planos || null,
    });
  } catch (err) {
    console.error('Erro ao carregar status do plano:', err.message);
    return res.status(500).json({ message: 'Erro ao carregar status do plano.' });
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
