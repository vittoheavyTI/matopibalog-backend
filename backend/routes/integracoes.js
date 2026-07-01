const express = require('express');
const router = express.Router();
const { verifyToken, isSuperAdmin } = require('../middlewares/auth');
const { z } = require('zod');

// Validação simples do corpo de /salvar (servico obrigatório + config objeto).
const salvarIntegracaoSchema = z.object({
  servico: z.string().min(1),
  config: z.record(z.string(), z.any()).default({}),
});

// --- Leitura mascarada de integrações (GET /integracoes) ---
// Campo sensível: qualquer chave que contenha (case-insensitive) um destes termos.
// Preferimos mascarar demais a vazar — melhor um campo público mascarado que um segredo exposto.
const TERMOS_SENSIVEIS = ['apikey', 'token', 'password', 'pass', 'secret', 'clientsecret', 'senha', 'key'];
function isCampoSensivel(chave) {
  const c = String(chave).toLowerCase();
  return TERMOS_SENSIVEIS.some(t => c.includes(t));
}
// Máscara: revela só os 4 últimos caracteres; valores curtos/ausentes viram '****'.
function mascararValor(valor) {
  if (typeof valor !== 'string' || valor.length <= 4) return '****';
  return '****' + valor.slice(-4);
}

router.post('/testar/asaas', verifyToken, isSuperAdmin, async (req, res) => {
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
    const asaasDesc = err.response?.data?.errors?.[0]?.description || '';
    const httpStatus = err.response?.status;
    const base = asaasDesc || 'Erro ao conectar com Asaas.';

    // Detecta erro de autenticação/ambiente e adiciona hint sem expor a chave
    const isAuthErr = httpStatus === 401 || httpStatus === 403 ||
      /api.?key|access|unauthorized|invalid/i.test(asaasDesc);
    const envLabel = environment === 'production' ? 'produção' : 'sandbox';
    const hint = isAuthErr
      ? ` Verifique se a chave pertence ao ambiente "${envLabel}" selecionado.`
      : '';

    res.status(400).json({ status: 'erro', message: base + hint });
  }
});

router.post('/testar/clicksign', verifyToken, isSuperAdmin, async (req, res) => {
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

router.post('/testar/viacep', verifyToken, isSuperAdmin, async (req, res) => {
  try {
    const axios = require('axios');
    await axios.get('https://viacep.com.br/ws/01001000/json/');
    res.json({ status: 'conectado', message: 'Conexão com ViaCEP bem-sucedida.' });
  } catch (err) {
    res.status(400).json({ status: 'erro', message: 'Erro ao conectar com ViaCEP.' });
  }
});

router.post('/testar/smtp', verifyToken, isSuperAdmin, async (req, res) => {
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

router.post('/testar/supabase', verifyToken, isSuperAdmin, async (req, res) => {
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

router.post('/salvar', verifyToken, isSuperAdmin, async (req, res) => {
  const parsed = salvarIntegracaoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Dados inválidos' });
  }
  const { servico, config } = parsed.data;
  const supabase = require('../config/supabase');

  try {
    // Read-merge-write: preserva as demais chaves de configuracoes.dados
    // (aparência, sistema, outras integrações) e evita clobber do blob id=1.
    const { data: atual, error: readError } = await supabase
      .from('configuracoes')
      .select('dados')
      .eq('id', 1)
      .single();

    // PGRST116 = linha ainda não existe → parte de {}. Outro erro = falha real.
    if (readError && readError.code !== 'PGRST116') throw readError;

    const dadosAtualizados = {
      ...(atual?.dados || {}),
      [`integracao_${servico}`]: config,
    };

    const { error } = await supabase
      .from('configuracoes')
      .upsert({
        id: 1,
        dados: dadosAtualizados,
        atualizado_em: new Date()
      });

    if (error) throw error;
    res.json({ message: 'Configuração salva com sucesso.' });
  } catch (err) {
    // Só a mensagem técnica — nunca req.body/config (evita vazar segredo).
    console.error('Erro ao salvar integração:', err.message);
    res.status(500).json({ message: 'Erro ao salvar integração' });
  }
});

// GET /integracoes — retorna SOMENTE metadados mascarados das integrações
// configuradas (nunca apiKey/token/pass em claro). Super-admin.
router.get('/', verifyToken, isSuperAdmin, async (req, res) => {
  const supabase = require('../config/supabase');
  try {
    const { data, error } = await supabase
      .from('configuracoes')
      .select('dados')
      .eq('id', 1)
      .single();

    // PGRST116 = linha inexistente → nenhuma integração configurada.
    if (error && error.code !== 'PGRST116') throw error;
    const dados = data?.dados || {};

    const integracoes = Object.keys(dados)
      .filter(k => k.startsWith('integracao_'))
      .map(k => {
        const servico = k.replace('integracao_', '');
        const config = (dados[k] && typeof dados[k] === 'object') ? dados[k] : {};
        const configPublica = {};
        const camposMascarados = {};
        for (const [chave, valor] of Object.entries(config)) {
          if (isCampoSensivel(chave)) camposMascarados[chave] = mascararValor(valor);
          else configPublica[chave] = valor;
        }
        return {
          servico,
          configurado: Object.keys(config).length > 0,
          configPublica,
          camposMascarados,
        };
      });

    res.json(integracoes);
  } catch (err) {
    // Só a mensagem técnica — nunca dados/config/segredos.
    console.error('Erro ao carregar integrações:', err.message);
    res.status(500).json({ message: 'Erro ao carregar integrações' });
  }
});

module.exports = router;
