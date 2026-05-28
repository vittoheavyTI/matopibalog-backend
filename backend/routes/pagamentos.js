const express = require('express');
const router = express.Router();
const axios = require('axios');
const supabase = require('../config/supabase');
const { verifyToken, isAdmin } = require('../middlewares/auth');

async function getAsaasConfig() {
  const { data } = await supabase
    .from('configuracoes')
    .select('dados')
    .eq('id', 1)
    .single();
  
  const integracoes = data?.dados?.['integracao_asaas'] || {};
  const apiKey = integracoes.apiKey || process.env.ASAAS_API_KEY;
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

router.post('/clientes', verifyToken, isAdmin, async (req, res) => {
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

router.post('/cobrancas', verifyToken, isAdmin, async (req, res) => {
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

router.get('/cobrancas/:empresa_id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { data } = await supabase
      .from('faturas')
      .select('*')
      .eq('empresa_id', req.params.empresa_id)
      .order('created_at', { ascending: false });

    res.json(data || []);
  } catch (err) {
    res.status(500).json({ message: 'Erro ao listar cobranças.' });
  }
});

router.get('/cobrancas/all', verifyToken, isAdmin, async (req, res) => {
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

router.post('/webhook/asaas', async (req, res) => {
  try {
    const event = req.body;

    if (!event?.payment?.id) {
      return res.status(200).json({ received: true });
    }

    const asaasId = event.payment.id;
    const statusAsaas = event.event;

    let novoStatus = 'pendente';
    if (statusAsaas === 'PAYMENT_CONFIRMED' || statusAsaas === 'PAYMENT_RECEIVED') {
      novoStatus = 'pago';
    } else if (statusAsaas === 'PAYMENT_OVERDUE') {
      novoStatus = 'vencido';
    } else if (statusAsaas === 'PAYMENT_CANCELED') {
      novoStatus = 'cancelado';
    } else if (statusAsaas === 'PAYMENT_REFUNDED') {
      novoStatus = 'estornado';
    }

    const { data: fatura } = await supabase
      .from('faturas')
      .update({ status: novoStatus, pago_em: novoStatus === 'pago' ? new Date().toISOString() : null })
      .eq('asaas_id', asaasId)
      .select('empresa_id')
      .single();

    if (novoStatus === 'pago' && fatura?.empresa_id) {
      await supabase
        .from('empresas')
        .update({ status: 'ativo' })
        .eq('id', fatura.empresa_id);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook Asaas error:', err.message);
    res.status(200).json({ received: true });
  }
});

module.exports = router;
