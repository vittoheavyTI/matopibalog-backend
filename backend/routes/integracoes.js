const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middlewares/auth');

router.post('/testar/asaas', verifyToken, isAdmin, async (req, res) => {
  try {
    const { apiKey, environment } = req.body;
    const axios = require('axios');
    const baseURL = environment === 'production'
      ? 'https://api.asaas.com/v3'
      : 'https://sandbox.asaas.com/api/v3';

    await axios.get(`${baseURL}/customers`, {
      headers: { 'access_token': apiKey },
      params: { limit: 1 }
    });

    res.json({ status: 'conectado', message: 'Conexão com Asaas bem-sucedida.' });
  } catch (err) {
    res.status(400).json({ status: 'erro', message: err.response?.data?.errors?.[0]?.description || 'Erro ao conectar com Asaas.' });
  }
});

router.post('/testar/clicksign', verifyToken, isAdmin, async (req, res) => {
  try {
    const { token, environment } = req.body;
    const axios = require('axios');
    const baseURL = environment === 'production'
      ? 'https://api.clicksign.com/api/v1'
      : 'https://sandbox.clicksign.com/api/v1';

    await axios.get(`${baseURL}/documents`, {
      headers: { 'Authorization': `Bearer ${token}` },
      params: { limit: 1 }
    });

    res.json({ status: 'conectado', message: 'Conexão com Clicksign bem-sucedida.' });
  } catch (err) {
    res.status(400).json({ status: 'erro', message: err.response?.data?.errors?.[0] || 'Erro ao conectar com Clicksign.' });
  }
});

router.post('/testar/viacep', verifyToken, isAdmin, async (req, res) => {
  try {
    const axios = require('axios');
    await axios.get('https://viacep.com.br/ws/01001000/json/');
    res.json({ status: 'conectado', message: 'Conexão com ViaCEP bem-sucedida.' });
  } catch (err) {
    res.status(400).json({ status: 'erro', message: 'Erro ao conectar com ViaCEP.' });
  }
});

router.post('/testar/smtp', verifyToken, isAdmin, async (req, res) => {
  try {
    const { host, port, user, pass } = req.body;
    const nodemailer = require('nodemailer');

    const transporter = nodemailer.createTransport({
      host, port: Number(port), secure: Number(port) === 465,
      auth: { user, pass }
    });

    await transporter.verify();
    res.json({ status: 'conectado', message: 'Conexão SMTP bem-sucedida.' });
  } catch (err) {
    res.status(400).json({ status: 'erro', message: err.message });
  }
});

router.post('/testar/supabase', verifyToken, isAdmin, async (req, res) => {
  try {
    const supabase = require('../config/supabase');
    const { data } = await supabase.from('usuarios').select('id').limit(1);
    if (data !== null) {
      res.json({ status: 'conectado', message: 'Conexão com Supabase OK.' });
    } else {
      res.status(400).json({ status: 'erro', message: 'Erro ao conectar com Supabase.' });
    }
  } catch (err) {
    res.status(400).json({ status: 'erro', message: err.message });
  }
});

router.post('/salvar', verifyToken, isAdmin, async (req, res) => {
  try {
    const { servico, config } = req.body;
    const supabase = require('../config/supabase');

    const { error } = await supabase
      .from('configuracoes')
      .upsert({
        id: 1,
        dados: { [`integracao_${servico}`]: config },
        atualizado_em: new Date()
      });

    if (error) throw error;
    res.json({ message: 'Configuração salva com sucesso.' });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao salvar configuração.' });
  }
});

module.exports = router;
