const express = require('express');
const router = express.Router();
const { verifyToken, isSuperAdmin } = require('../middlewares/auth');
const cryptoHelper = require('../utils/integrationsCrypto');
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

// --- Visibilidade de integrações na tela (Fase 3A) ---
// Só estas podem ser ocultadas/reexibidas (opcionais, sem fluxo crítico consumindo-as).
const INTEGRACOES_REMOVIVEIS = new Set(['clicksign', 'smtp']);
// Protegidas: asaas = provedor de pagamento atual; viacep/supabase = nativas do sistema.
const INTEGRACOES_PROTEGIDAS = new Set(['asaas', 'viacep', 'supabase']);

// Normaliza o :servico da rota: minúsculas, sem espaços, só [a-z0-9_-] (evita path traversal).
function normalizarServico(servico) {
  const s = String(servico || '').trim().toLowerCase();
  return /^[a-z0-9_-]+$/.test(s) ? s : null;
}

// --- Catálogo de integrações personalizadas (Fase 3C) ---
// Serviços conhecidos do sistema (têm handler de teste próprio e/ou automação).
const SERVICOS_PADRAO = new Set(['asaas', 'clicksign', 'viacep', 'smtp', 'supabase']);
// Nomes internos usados como caminhos de rota — não podem virar slug de custom.
const NOMES_INTERNOS_RESERVADOS = new Set(['estado', 'catalogo', 'customizadas', 'salvar', 'testar', 'ocultar', 'exibir']);
// Um slug é reservado se for um serviço padrão OU um nome interno de rota.
function isServicoReservado(servico) {
  return SERVICOS_PADRAO.has(servico) || NOMES_INTERNOS_RESERVADOS.has(servico);
}

const CATEGORIAS_PERMITIDAS = ['pagamento', 'assinatura', 'consulta', 'email', 'banco', 'outro'];
const TIPOS_CAMPO_PERMITIDOS = ['text', 'password', 'select'];
const MAX_CUSTOMIZADAS = 20;
const MAX_CAMPOS = 10;

// Definição de UM campo — só metadados (chave/label/tipo[/options]). NUNCA valor/segredo.
// Zod descarta chaves desconhecidas (não .passthrough()), então um eventual "valor" é removido.
const campoCustomizadoSchema = z.object({
  chave: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(60),
  tipo: z.enum(TIPOS_CAMPO_PERMITIDOS),
  options: z.array(z.object({
    value: z.string().max(60),
    label: z.string().max(60),
  })).max(20).optional(),
});

// Corpo de POST /customizadas.
const criarCustomizadaSchema = z.object({
  servico: z.string().trim().min(1).max(40),
  nome: z.string().trim().min(1).max(60),
  categoria: z.enum(CATEGORIAS_PERMITIDAS).default('outro'),
  descricao: z.string().trim().max(200).optional().default(''),
  campos: z.array(campoCustomizadoSchema).max(MAX_CAMPOS).default([]),
});

// Sanitiza uma entrada do catálogo para saída/persistência: só metadados/definição de
// campos, nunca valores de credenciais. Blinda contra qualquer chave inesperada no blob.
function sanitizarCustomizada(item) {
  if (!item || typeof item !== 'object' || typeof item.servico !== 'string') return null;
  const campos = Array.isArray(item.campos) ? item.campos
    .filter(c => c && typeof c === 'object')
    .map(c => {
      const campo = {
        chave: String(c.chave || ''),
        label: String(c.label || ''),
        tipo: TIPOS_CAMPO_PERMITIDOS.includes(c.tipo) ? c.tipo : 'text',
      };
      if (campo.tipo === 'select' && Array.isArray(c.options)) {
        campo.options = c.options
          .filter(o => o && typeof o === 'object')
          .map(o => ({ value: String(o.value ?? ''), label: String(o.label ?? '') }));
      }
      return campo;
    }) : [];
  return {
    servico: item.servico,
    nome: String(item.nome || ''),
    categoria: CATEGORIAS_PERMITIDAS.includes(item.categoria) ? item.categoria : 'outro',
    descricao: String(item.descricao || ''),
    campos,
    criado_em: item.criado_em || null,
  };
}

// A tabela configuracoes exige empresa_id NOT NULL. A configuração é GLOBAL (todos os
// reads usam id=1); ao gravar, preservamos o empresa_id dono da linha e, se ela ainda
// não existir, usamos a empresa do super-admin autenticado — espelhando
// configController.update. Nunca grava empresa_id nulo; marca a etapa da falha no erro
// (empresa_id/upsert) para diagnóstico no log, sem expor segredos.
async function upsertConfigGlobal(supabase, req, novosDados, empresaIdAtual) {
  let empresaId = empresaIdAtual;
  if (!empresaId) {
    const { data: usuario } = await supabase
      .from('usuarios').select('empresa_id').eq('id', req.user.uid).single();
    empresaId = usuario?.empresa_id || null;
  }
  if (!empresaId) {
    const erro = new Error('Nao foi possivel determinar empresa_id para salvar configuracoes.');
    erro.etapa = 'empresa_id';
    throw erro;
  }
  const { error } = await supabase
    .from('configuracoes')
    .upsert({ id: 1, dados: novosDados, atualizado_em: new Date(), empresa_id: empresaId });
  if (error) { error.etapa = 'upsert'; throw error; }
}

// Read-merge-write de configuracoes.dados.integracoes_ocultas, preservando as demais chaves.
async function atualizarOcultas(supabase, req, mutar) {
  const { data: atual, error: readError } = await supabase
    .from('configuracoes').select('dados, empresa_id').eq('id', 1).single();
  // PGRST116 = linha inexistente → parte de {}. Outro erro = falha real.
  if (readError && readError.code !== 'PGRST116') throw readError;
  const dados = atual?.dados || {};
  const ocultasAtuais = Array.isArray(dados.integracoes_ocultas) ? dados.integracoes_ocultas : [];
  const novaLista = mutar(ocultasAtuais);
  await upsertConfigGlobal(supabase, req, { ...dados, integracoes_ocultas: novaLista }, atual?.empresa_id);
  return novaLista;
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
  const servicoNorm = normalizarServico(servico);
  if (!servicoNorm) {
    return res.status(400).json({ message: 'Integração inválida.' });
  }
  const supabase = require('../config/supabase');

  try {
    // Read-merge-write: preserva as demais chaves de configuracoes.dados
    // (aparência, sistema, outras integrações) e evita clobber do blob id=1.
    const { data: atual, error: readError } = await supabase
      .from('configuracoes')
      .select('dados, empresa_id')
      .eq('id', 1)
      .single();

    // PGRST116 = linha ainda não existe → parte de {}. Outro erro = falha real.
    if (readError && readError.code !== 'PGRST116') throw readError;

    const dadosAtuais = atual?.dados || {};

    // Allowlist: só salva config de serviço padrão conhecido OU customizada já cadastrada.
    // Fecha o buraco de aceitar slug arbitrário (que criaria integracao_<qualquer-coisa>).
    const customizadas = Array.isArray(dadosAtuais.integracoes_customizadas) ? dadosAtuais.integracoes_customizadas : [];
    const ehPadrao = SERVICOS_PADRAO.has(servicoNorm);
    const ehCustomCadastrada = customizadas.some(c => c && c.servico === servicoNorm);
    if (!ehPadrao && !ehCustomCadastrada) {
      return res.status(400).json({ message: 'Integração não cadastrada.' });
    }

    // Criptografia em repouso: cifra os campos sensíveis (apiKey/token/senha/etc.)
    // antes de persistir; campos não sensíveis permanecem em claro. Se a criptografia
    // falhar (ex.: INTEGRATIONS_SECRET_KEY ausente), aborta com 500 genérico — nunca
    // grava o segredo em texto puro por engano.
    let configCriptografado;
    try {
      configCriptografado = {};
      for (const [chave, valor] of Object.entries(config)) {
        const sensivel = isCampoSensivel(chave);
        configCriptografado[chave] = cryptoHelper.maybeEncryptIntegrationField(chave, valor, sensivel);
      }
    } catch (cryptoErr) {
      // Só a mensagem técnica (sem valor/chave/segredo).
      console.error('Falha ao criptografar credenciais de integração:', cryptoErr.message);
      return res.status(500).json({ message: 'Erro ao salvar integração' });
    }

    const dadosAtualizados = {
      ...dadosAtuais,
      [`integracao_${servicoNorm}`]: configCriptografado,
    };

    await upsertConfigGlobal(supabase, req, dadosAtualizados, atual?.empresa_id);
    res.json({ message: 'Configuração salva com sucesso.' });
  } catch (err) {
    // Só a mensagem técnica + etapa (empresa_id/upsert) — nunca req.body/config (evita vazar segredo).
    console.error(`Erro ao salvar integração (etapa: ${err?.etapa || 'desconhecida'}):`, err.message);
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
          if (isCampoSensivel(chave)) {
            // Descriptografa antes de mascarar (valor legado em claro passa direto).
            // Se a descriptografia falhar (ex.: chave ausente), mascara genérico:
            // nunca vaza o segredo nem derruba o GET inteiro.
            let valorTratado;
            try {
              valorTratado = cryptoHelper.maybeDecryptIntegrationField(chave, valor, true);
            } catch (_) {
              valorTratado = null;
            }
            camposMascarados[chave] = mascararValor(valorTratado);
          } else {
            configPublica[chave] = valor;
          }
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

// GET /integracoes/estado — lista de serviços ocultos da tela (super-admin). Sem segredos.
router.get('/estado', verifyToken, isSuperAdmin, async (req, res) => {
  const supabase = require('../config/supabase');
  try {
    const { data, error } = await supabase
      .from('configuracoes').select('dados').eq('id', 1).single();
    if (error && error.code !== 'PGRST116') throw error;
    const ocultas = Array.isArray(data?.dados?.integracoes_ocultas) ? data.dados.integracoes_ocultas : [];
    res.json({ ocultas });
  } catch (err) {
    console.error('Erro ao carregar estado de integrações:', err.message);
    res.status(500).json({ message: 'Erro ao carregar estado de integrações' });
  }
});

// PATCH /integracoes/:servico/ocultar — remove da tela uma integração opcional conhecida.
router.patch('/:servico/ocultar', verifyToken, isSuperAdmin, async (req, res) => {
  const servico = normalizarServico(req.params.servico);
  if (!servico) return res.status(400).json({ message: 'Integração inválida.' });
  if (INTEGRACOES_PROTEGIDAS.has(servico)) {
    return res.status(403).json({ message: 'Esta integração não pode ser removida por ser nativa ou crítica do sistema.' });
  }
  if (!INTEGRACOES_REMOVIVEIS.has(servico)) {
    return res.status(400).json({ message: 'Integração não permitida para remoção.' });
  }
  const supabase = require('../config/supabase');
  try {
    // Apenas oculta da tela — NÃO apaga integracao_<servico> nem credenciais.
    await atualizarOcultas(supabase, req, (ocultas) =>
      ocultas.includes(servico) ? ocultas : [...ocultas, servico]);
    res.json({ message: 'Integração removida da tela com sucesso', servico });
  } catch (err) {
    console.error('Erro ao ocultar integração:', err.message);
    res.status(500).json({ message: 'Erro ao ocultar integração' });
  }
});

// PATCH /integracoes/:servico/exibir — reexibe uma integração previamente ocultada.
router.patch('/:servico/exibir', verifyToken, isSuperAdmin, async (req, res) => {
  const servico = normalizarServico(req.params.servico);
  if (!servico) return res.status(400).json({ message: 'Integração inválida.' });
  if (!INTEGRACOES_REMOVIVEIS.has(servico)) {
    return res.status(400).json({ message: 'Integração não permitida.' });
  }
  const supabase = require('../config/supabase');
  try {
    await atualizarOcultas(supabase, req, (ocultas) => ocultas.filter(s => s !== servico));
    res.json({ message: 'Integração reexibida com sucesso', servico });
  } catch (err) {
    console.error('Erro ao reexibir integração:', err.message);
    res.status(500).json({ message: 'Erro ao reexibir integração' });
  }
});

// GET /integracoes/catalogo — lista as integrações personalizadas cadastradas (super-admin).
// Só metadados/definição de campos; nunca valores de credenciais.
router.get('/catalogo', verifyToken, isSuperAdmin, async (req, res) => {
  const supabase = require('../config/supabase');
  try {
    const { data, error } = await supabase
      .from('configuracoes').select('dados').eq('id', 1).single();
    if (error && error.code !== 'PGRST116') throw error;
    const lista = Array.isArray(data?.dados?.integracoes_customizadas) ? data.dados.integracoes_customizadas : [];
    const customizadas = lista.map(sanitizarCustomizada).filter(Boolean);
    res.json({ customizadas });
  } catch (err) {
    console.error('Erro ao carregar catálogo de integrações:', err.message);
    res.status(500).json({ message: 'Erro ao carregar catálogo de integrações' });
  }
});

// POST /integracoes/customizadas — cadastra uma integração personalizada (super-admin).
// Apenas metadados administrativos: sem teste automático, sem automação, sem segredos.
router.post('/customizadas', verifyToken, isSuperAdmin, async (req, res) => {
  const parsed = criarCustomizadaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Dados inválidos' });
  }
  const entrada = parsed.data;

  const servico = normalizarServico(entrada.servico);
  if (!servico) {
    return res.status(400).json({ message: 'Identificador (slug) inválido. Use apenas letras minúsculas, números, hífen ou underline.' });
  }
  if (isServicoReservado(servico)) {
    return res.status(400).json({ message: 'Este identificador é reservado e não pode ser usado.' });
  }

  // Normaliza e valida as chaves dos campos (mesma regra de slug) + unicidade interna.
  const campos = [];
  const chavesVistas = new Set();
  for (const campo of entrada.campos) {
    const chave = normalizarServico(campo.chave);
    if (!chave) {
      return res.status(400).json({ message: 'Chave de campo inválida. Use apenas letras minúsculas, números, hífen ou underline.' });
    }
    if (chavesVistas.has(chave)) {
      return res.status(400).json({ message: 'Há campos com a mesma chave.' });
    }
    chavesVistas.add(chave);
    const campoLimpo = { chave, label: campo.label, tipo: campo.tipo };
    if (campo.tipo === 'select' && Array.isArray(campo.options)) {
      campoLimpo.options = campo.options;
    }
    campos.push(campoLimpo);
  }

  const novaIntegracao = {
    servico,
    nome: entrada.nome,
    categoria: entrada.categoria,
    descricao: entrada.descricao || '',
    campos,
    criado_em: new Date().toISOString(),
  };

  const supabase = require('../config/supabase');
  try {
    const { data: atual, error: readError } = await supabase
      .from('configuracoes').select('dados, empresa_id').eq('id', 1).single();
    if (readError && readError.code !== 'PGRST116') throw readError;
    const dados = atual?.dados || {};
    const customizadas = Array.isArray(dados.integracoes_customizadas) ? dados.integracoes_customizadas : [];

    if (customizadas.some(c => c && c.servico === servico)) {
      return res.status(409).json({ message: 'Já existe uma integração com este identificador.' });
    }
    if (customizadas.length >= MAX_CUSTOMIZADAS) {
      return res.status(400).json({ message: `Limite de ${MAX_CUSTOMIZADAS} integrações personalizadas atingido.` });
    }

    const novosDados = { ...dados, integracoes_customizadas: [...customizadas, novaIntegracao] };
    await upsertConfigGlobal(supabase, req, novosDados, atual?.empresa_id);

    res.status(201).json({ message: 'Integração personalizada criada com sucesso', integracao: sanitizarCustomizada(novaIntegracao) });
  } catch (err) {
    console.error('Erro ao criar integração personalizada:', err.message);
    res.status(500).json({ message: 'Erro ao criar integração personalizada' });
  }
});

// DELETE /integracoes/customizadas/:servico — exclui uma integração PERSONALIZADA (super-admin).
// Só atua sobre customizadas: remove a entrada do catálogo, o blob integracao_<slug> e o slug
// de integracoes_ocultas — preservando todas as demais chaves. Nunca toca serviços padrão.
router.delete('/customizadas/:servico', verifyToken, isSuperAdmin, async (req, res) => {
  const servico = normalizarServico(req.params.servico);
  if (!servico) return res.status(400).json({ message: 'Integração inválida.' });
  if (isServicoReservado(servico)) {
    return res.status(400).json({ message: 'Esta integração não pode ser excluída por esta rota.' });
  }
  const supabase = require('../config/supabase');
  try {
    const { data: atual, error: readError } = await supabase
      .from('configuracoes').select('dados, empresa_id').eq('id', 1).single();
    if (readError && readError.code !== 'PGRST116') throw readError;
    const dados = atual?.dados || {};
    const customizadas = Array.isArray(dados.integracoes_customizadas) ? dados.integracoes_customizadas : [];

    if (!customizadas.some(c => c && c.servico === servico)) {
      return res.status(404).json({ message: 'Integração personalizada não encontrada.' });
    }

    // Preserva todo o resto; remove só o que pertence a este slug.
    const novosDados = { ...dados };
    novosDados.integracoes_customizadas = customizadas.filter(c => !(c && c.servico === servico));
    delete novosDados[`integracao_${servico}`];
    if (Array.isArray(novosDados.integracoes_ocultas)) {
      novosDados.integracoes_ocultas = novosDados.integracoes_ocultas.filter(s => s !== servico);
    }

    await upsertConfigGlobal(supabase, req, novosDados, atual?.empresa_id);

    res.json({ message: 'Integração personalizada excluída com sucesso', servico });
  } catch (err) {
    console.error('Erro ao excluir integração personalizada:', err.message);
    res.status(500).json({ message: 'Erro ao excluir integração personalizada' });
  }
});

module.exports = router;
