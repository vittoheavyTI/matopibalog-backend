const supabase = require('../config/supabase');
const { mesclarConfigEmpresa } = require('../utils/configEmpresaMerge');

// Whitelist de campos de APARÊNCIA (únicos que a tela de login precisa, sem auth).
// `whatsapp_suporte` entra aqui de propósito: é um contato PÚBLICO (canal comercial/
// suporte único), usado pelos CTAs de /planos, /cadastro e no card de plano
// bloqueado para montar links wa.me. É só um número de contato — não é segredo.
// email_suporte/telefone_suporte seguem cobertos por contactEmail/contactPhone.
const APPEARANCE_KEYS = [
  'loginLogo', 'loginLogoScale', 'loginLogoY', 'loginBg', 'loginBgScale', 'loginBgY',
  'loginTemplate', 'footerText', 'contactPhone', 'contactEmail', 'footerColor',
  'footerOpacity', 'footerFontSize', 'footerBold', 'footerFontFamily', 'footerWidth',
  'footerHeight', 'inputBgColor', 'inputBorderColor', 'whatsapp_suporte'
];

// Campos extras que o admin logado usa (preview + empresa + impressoras + sidebar)
const ADMIN_EXTRA_KEYS = ['cardOffsetX', 'cardOffsetY', 'printers', 'sidebarLogo', 'sidebarLogoScale', 'sidebarLogoY'];

// Config de SISTEMA — só super-admin (PainelConfigSistema)
const SYSTEM_KEYS = ['nome_sistema', 'email_suporte', 'whatsapp_suporte', 'telefone_suporte', 'trial_dias', 'manutencao', 'registros_abertos'];

// Monta objeto só com as chaves permitidas (whitelist — nunca blacklist)
function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

function gerarCodigoConvite() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let codigo = 'MATO-';
  for (let i = 0; i < 6; i++) {
    codigo += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return codigo;
}

exports.getCodigoConvite = async (req, res) => {
  try {
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('empresa_id')
      .eq('id', req.user.uid)
      .single();

    if (!usuario?.empresa_id) {
      return res.status(404).json({ message: 'Empresa não encontrada para este usuário.' });
    }

    const { data: empresa, error } = await supabase
      .from('empresas')
      .select('codigo_convite')
      .eq('id', usuario.empresa_id)
      .single();

    if (error || !empresa) {
      return res.status(404).json({ message: 'Empresa não encontrada.' });
    }

    res.json({ codigo_convite: empresa.codigo_convite });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao buscar código de convite.' });
  }
};

exports.regenerarCodigoConvite = async (req, res) => {
  try {
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('empresa_id')
      .eq('id', req.user.uid)
      .single();

    if (!usuario?.empresa_id) {
      return res.status(404).json({ message: 'Empresa não encontrada para este usuário.' });
    }

    let novoCodigo = null;
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      const candidato = gerarCodigoConvite();
      const { data: existente } = await supabase
        .from('empresas').select('id').eq('codigo_convite', candidato).maybeSingle();
      if (!existente) { novoCodigo = candidato; break; }
    }

    if (!novoCodigo) {
      return res.status(500).json({ message: 'Não foi possível gerar um código único. Tente novamente.' });
    }

    const { error } = await supabase
      .from('empresas')
      .update({ codigo_convite: novoCodigo })
      .eq('id', usuario.empresa_id);

    if (error) throw error;

    res.json({ codigo_convite: novoCodigo, message: 'Código regenerado com sucesso.' });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao regenerar código de convite.' });
  }
};

exports.get = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('configuracoes')
      .select('dados')
      .eq('id', 1)
      .single();

    // Tolera linha inexistente (PGRST116) — responde {} em vez de 500
    if (error && error.code !== 'PGRST116') throw error;
    const dados = data?.dados || {};

    // Aparência + preview + empresa + impressoras (nunca os segredos por padrão)
    const resposta = pick(dados, [...APPEARANCE_KEYS, ...ADMIN_EXTRA_KEYS]);

    // Config de sistema SÓ para super-admin.
    // Não expor integracao_*/segredos aqui; Integrações terá endpoint mascarado próprio.
    if (req.user?.is_super_admin) {
      Object.assign(resposta, pick(dados, SYSTEM_KEYS));
    }

    res.json(resposta);
  } catch (err) {
    res.status(500).json({ message: 'Erro ao carregar configurações.' });
  }
};

exports.getPublic = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('configuracoes')
      .select('dados')
      .eq('id', 1)
      .single();

    if (error) {
      return res.status(200).json({});
    }
    // Sem auth → SOMENTE aparência (nada de empresa, impressoras ou segredos)
    res.json(pick(data?.dados || {}, APPEARANCE_KEYS));
  } catch (err) {
    res.status(200).json({});
  }
};

exports.update = async (req, res) => {
  try {
    // Busca linha atual para preservar empresa_id e mesclar dados existentes
    const { data: current } = await supabase
      .from('configuracoes')
      .select('empresa_id, dados')
      .eq('id', 1)
      .single();

    let empresaId = current?.empresa_id;

    // Linha id=1 ainda não existe: busca empresa_id do usuário autenticado
    if (!empresaId) {
      const { data: usuario } = await supabase
        .from('usuarios')
        .select('empresa_id')
        .eq('id', req.user.uid)
        .single();
      empresaId = usuario?.empresa_id;
    }

    if (!empresaId) {
      return res.status(400).json({ message: 'Não foi possível determinar empresa_id para salvar configurações.' });
    }

    // Merge: preserva campos existentes que não vieram no payload
    // Isso evita que um save parcial (ex: só aparência) apague outros campos (ex: printers, company)
    // Merge defensivo: ignora null/undefined do payload para não apagar config
    // existente por um save parcial/corrida (ex: loginLogo:null enviado antes do
    // GET terminar). Remoção intencional chega como string vazia '' e é preservada.
    const dadosAtuais = current?.dados || {};
    const dadosMesclados = { ...dadosAtuais };
    for (const [chave, valor] of Object.entries(req.body || {})) {
      if (valor !== null && valor !== undefined) dadosMesclados[chave] = valor;
    }

    const { error } = await supabase
      .from('configuracoes')
      .upsert({
        id: 1,
        dados: dadosMesclados,
        atualizado_em: new Date(),
        empresa_id: empresaId
      });

    if (error) throw error;
    res.json({ message: 'Configurações salvas com sucesso.' });
  } catch (err) {
    console.error('Erro ao salvar configuracoes:', err);
    res.status(500).json({ message: 'Erro ao salvar configurações.' });
  }
};

// Dados da empresa (por empresa) — substitui o 'company' do blob global id=1 (#16/#32)
exports.getEmpresaConfig = async (req, res) => {
  try {
    if (!req.empresa_id) return res.json({});
    const { data, error } = await supabase
      .from('empresas')
      .select('config_empresa')
      .eq('id', req.empresa_id)
      .single();
    if (error) throw error;
    res.json(data?.config_empresa || {});
  } catch (err) {
    console.error('Erro ao carregar dados da empresa:', err);
    res.status(500).json({ message: 'Erro ao carregar dados da empresa.' });
  }
};

exports.updateEmpresaConfig = async (req, res) => {
  try {
    if (!req.empresa_id) return res.status(400).json({ message: 'Empresa não encontrada.' });
    // Read-merge-write per-tenant: preserva as demais chaves de config_empresa. A
    // logomarca (config_empresa.logomarca) e os dados da empresa convivem sem se
    // apagar quando salvos separadamente. Escopo por empresa_id (multi-tenant).
    const { data: atual, error: readErr } = await supabase
      .from('empresas')
      .select('config_empresa')
      .eq('id', req.empresa_id)
      .single();
    if (readErr) throw readErr;

    const merged = mesclarConfigEmpresa(atual?.config_empresa, req.body);
    const { error } = await supabase
      .from('empresas')
      .update({ config_empresa: merged })
      .eq('id', req.empresa_id);
    if (error) throw error;
    res.json({ message: 'Dados da empresa salvos.' });
  } catch (err) {
    console.error('Erro ao salvar dados da empresa:', err);
    res.status(500).json({ message: 'Erro ao salvar dados da empresa.' });
  }
};
