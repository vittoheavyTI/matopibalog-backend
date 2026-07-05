const supabase = require('../config/supabase');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const { criarEmpresaCompleta } = require('../services/empresaService');
const { getTermosPendentes } = require('./termosController');

// Client ISOLADO só para autenticação (signInWithPassword no login). Mantido
// separado do client admin (config/supabase.js) de propósito: assim a sessão do
// usuário criada no login fica neste client e NUNCA contamina o client admin
// usado por DB/Storage — evitando que uploads (foto/comprovantes) sejam rebaixados
// de service_role para 'authenticated' e batam em RLS. Não usar para DB/Storage.
const supabaseAuth = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// Gera código de convite no formato MATO-XXXXXX
function gerarCodigoConvite() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let codigo = 'MATO-';
  for (let i = 0; i < 6; i++) {
    codigo += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return codigo;
}

exports.register = async (req, res) => {
  const { nome, email, senha, codigo_convite, plano_id, cpf, placa_veiculo } = req.body;

  if (!nome || !email || !senha) {
    return res.status(400).json({ message: 'Campos obrigatórios: nome, email, senha.' });
  }

  try {
    let empresa_id = null;

    if (codigo_convite && codigo_convite.trim() !== '') {
      // --- Fluxo com código de convite: vincular à empresa ---
      const { data: empresa, error: empresaError } = await supabase
        .from('empresas')
        .select('id, status')
        .eq('codigo_convite', codigo_convite.trim().toUpperCase())
        .single();

      if (empresaError || !empresa) {
        return res.status(400).json({ message: 'Código de empresa inválido. Verifique com sua transportadora.' });
      }

      if (empresa.status === 'expirado' || empresa.status === 'bloqueado') {
        return res.status(400).json({ message: 'Esta empresa está com o plano inativo. Contate o suporte.' });
      }

      empresa_id = empresa.id;
    } else {
      // --- Fluxo autônomo: criar empresa própria ---
      let planoQuery = supabase
        .from('planos')
        .select('id, dias_trial, ativo');

      planoQuery = plano_id
        ? planoQuery.eq('id', plano_id)
        : planoQuery.eq('nome', 'Plano Básico');

      const { data: planoData, error: planoError } = await planoQuery.maybeSingle();

      if (planoError) {
        console.error('[register] Falha ao validar plano do autônomo:', planoError.message);
        return res.status(500).json({ message: 'Erro ao validar plano. Tente novamente.' });
      }

      // Quando o app envia um plano, ele precisa continuar disponível no
      // momento do cadastro. Preço, limite e trial nunca vêm do cliente.
      if (plano_id && (!planoData || planoData.ativo !== true)) {
        return res.status(400).json({ message: 'Plano selecionado inválido ou indisponível.' });
      }

      const trialEnd = new Date(
        Date.now() + ((planoData?.dias_trial || 7) * 24 * 60 * 60 * 1000)
      ).toISOString();

      // Garantir código único (tentativas em caso de colisão)
      let codigoUnico = null;
      for (let tentativa = 0; tentativa < 5; tentativa++) {
        const candidato = gerarCodigoConvite();
        const { data: existente } = await supabase
          .from('empresas')
          .select('id')
          .eq('codigo_convite', candidato)
          .maybeSingle();
        if (!existente) { codigoUnico = candidato; break; }
      }

      const { data: novaEmpresa, error: empresaError } = await supabase
        .from('empresas')
        .insert({
          nome: nome + ' (Autônomo)',
          cnpj: null,
          email_contato: email,
          telefone_contato: null,
          plano_id: planoData?.id || null,
          status: 'trial',
          trial_started_at: new Date().toISOString(),
          trial_ends_at: trialEnd,
          codigo_convite: codigoUnico,
          tipo: 'autonomo',
        })
        .select()
        .single();

      if (empresaError || !novaEmpresa) {
        console.error('[register] Falha ao criar empresa autônoma:', empresaError?.message);
        return res.status(500).json({ message: 'Erro ao criar perfil autônomo. Tente novamente.' });
      }

      empresa_id = novaEmpresa.id;
    }

    // Criar usuário no Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true
    });

    if (authError) return res.status(400).json({ message: authError.message });

    // Autônomo (sem código de convite) não tem admin para aprovar:
    // já nasce ativo e aprovado para poder usar o app imediatamente.
    // Motorista via convite permanece pendente até aprovação do admin da empresa.
    const isAutonomo = !codigo_convite || codigo_convite.trim() === '';
    const statusUsuario = isAutonomo ? 'ativo' : 'pendente';
    const statusCadastro = isAutonomo ? 'aprovado' : 'pendente';

    // Criar perfil na tabela usuarios
    const { error: insertError } = await supabase.from('usuarios').insert({
      id: authData.user.id,
      nome,
      email,
      tipo: 'motorista',
      status: statusUsuario,
      empresa_id,
    });

    if (insertError) {
      console.error('[register] Falha ao inserir em usuarios, revertendo Auth:', insertError.message);
      await supabase.auth.admin.deleteUser(authData.user.id).catch(() => {});
      return res.status(500).json({ message: 'Erro ao criar perfil. Tente novamente.' });
    }

    // Criar registro na tabela motoristas
    await supabase.from('motoristas').insert({
      id: authData.user.id,
      empresa_id,
      cpf: cpf || '',
      placa_veiculo: placa_veiculo || '',
      status_cadastro: statusCadastro
    });

    res.status(201).json({ message: 'Usuário criado com sucesso!' });
  } catch (error) {
    console.error('Erro no registro:', error.message);
    res.status(500).json({ message: 'Erro ao cadastrar. Verifique os dados e tente novamente.' });
  }
};

exports.login = async (req, res) => {
  const { email, senha } = req.body;

  try {
    // 1. Autenticar no Supabase Auth (client isolado — não contamina o admin)
    const { data: authData, error: authError } = await supabaseAuth.auth.signInWithPassword({
      email,
      password: senha
    });

    if (authError) return res.status(401).json({ message: 'Credenciais inválidas.' });

    const uid = authData.user.id;

    // 2. Buscar perfil detalhado com tipo da empresa
    const { data: userData, error: userError } = await supabase
      .from('usuarios')
      .select('*, empresas(nome, tipo)')
      .eq('id', uid)
      .single();

    if (userError || !userData) {
      console.error(`[login] Perfil ausente na tabela usuarios para uid ${uid}:`, userError);
      return res.status(409).json({
        message: 'Perfil incompleto. Entre em contato com o suporte.'
      });
    }

    if (userData.status === 'bloqueado') {
      return res.status(403).json({ message: 'Sua conta está bloqueada. Entre em contato com o suporte.' });
    }

    // 3. Gerar JWT para o backend
    const token = jwt.sign(
      { uid: userData.id, email: userData.email, role: userData.tipo, is_super_admin: userData.is_super_admin ?? false },
      process.env.JWT_SECRET,
      { expiresIn: '7d' } // Token expira em 7 dias
    );

    // 4. Salvar o token em um cookie seguro (MUDANÇA FEITA AQUI!)
    res.cookie('token', token, {
      httpOnly: true,
      secure: true, // Obriga o uso de HTTPS (necessário para o sameSite 'none')
      sameSite: 'none', // Permite o cookie viajar do seu Netlify/Hostinger para o Render
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    // 5. Retorna os dados do usuário (token incluso para o app Flutter)
    res.status(200).json({
      token,
      user: {
        uid: userData.id,
        nome: userData.nome,
        email: userData.email,
        role: userData.tipo,
        status: userData.status,
        foto_url: userData.foto_url,
        is_super_admin: userData.is_super_admin ?? false,
        senha_temporaria: userData.senha_temporaria ?? false,
        empresa_id: userData.empresa_id,
        empresa_tipo: userData.empresas?.tipo ?? null,
        empresa_nome: userData.empresas?.nome ?? null,
      }
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ message: 'Erro ao realizar login.' });
  }
};

// NOVA FUNÇÃO: Logout para apagar o cookie (MUDANÇA FEITA AQUI!)
exports.logout = async (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: true, // Obriga o uso de HTTPS
    sameSite: 'none' // Permite apagar o cookie cross-domain
  });
  return res.status(200).json({ message: 'Logout realizado com sucesso' });
};

exports.updateMe = async (req, res) => {
  const CAMPOS_PERMITIDOS = ['telefone', 'celular', 'cep', 'endereco', 'bairro', 'cidade'];
  const update = {};
  for (const campo of CAMPOS_PERMITIDOS) {
    if (req.body[campo] !== undefined) update[campo] = req.body[campo];
  }
  if (Object.keys(update).length === 0) {
    return res.status(400).json({ message: 'Nenhum campo válido para atualizar.' });
  }
  try {
    const { data, error } = await supabase
      .from('usuarios')
      .update(update)
      .eq('id', req.user.uid)
      .select('*, motoristas(*), empresas(nome, tipo)')
      .single();
    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar perfil.' });
  }
};

exports.uploadFotoPerfil = async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ message: 'Foto não enviada.' });
  try {
    const path = require('path');
    // Filename único por upload: evita que Flutter use cache do URL anterior
    // (quando o nome era sempre "profile.jpg", a URL nunca mudava e o avatar
    // ficava congelado no cache do NetworkImage entre sessões)
    const ext = path.extname(file.originalname) || '.jpg';
    const fileName = `avatars/${req.user.uid}/profile_${Date.now()}${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('comprovantes')
      .upload(fileName, file.buffer, { contentType: file.mimetype, upsert: true });

    if (uploadError) {
      console.error('[uploadFotoPerfil] Erro Supabase Storage:', uploadError.message);
      return res.status(500).json({ message: 'Erro ao salvar foto no storage.' });
    }

    const { data: urlData } = supabase.storage.from('comprovantes').getPublicUrl(fileName);
    const publicUrl = urlData.publicUrl;

    const { error: dbError } = await supabase
      .from('usuarios')
      .update({ foto_url: publicUrl })
      .eq('id', req.user.uid);

    if (dbError) {
      console.error('[uploadFotoPerfil] Erro ao atualizar foto_url no banco:', dbError.message);
      return res.status(500).json({ message: 'Foto salva no storage mas erro ao atualizar perfil.' });
    }

    res.status(200).json({ foto_url: publicUrl });
  } catch (error) {
    console.error('[uploadFotoPerfil] Erro inesperado:', error.message || error);
    res.status(500).json({ message: 'Erro ao enviar foto de perfil.' });
  }
};

exports.getMe = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('usuarios')
      .select('*, motoristas(*), empresas(nome, tipo)')
      .eq('id', req.user.uid)
      .single();

    if (error) throw error;

    // LGPD (aditivo): sinaliza termos pendentes. Falha na consulta de termos
    // NÃO pode derrubar /auth/me (login / restauração de sessão) → fallback false/0.
    let termos_pendentes = false;
    let termos_pendentes_count = 0;
    try {
      const { count } = await getTermosPendentes(
        data.id,
        data.tipo,
        data.is_super_admin === true
      );
      termos_pendentes_count = count;
      termos_pendentes = count > 0;
    } catch (termosErr) {
      console.error('[getMe] Falha ao calcular termos pendentes:', termosErr.message || termosErr);
    }

    res.status(200).json({ ...data, termos_pendentes, termos_pendentes_count });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar dados do usuário.' });
  }
};

exports.trocarSenha = async (req, res) => {
  const { nova_senha } = req.body;

  if (!nova_senha || typeof nova_senha !== 'string' || nova_senha.length < 6) {
    return res.status(400).json({ message: 'A nova senha deve ter pelo menos 6 caracteres.' });
  }

  try {
    const { error: authError } = await supabase.auth.admin.updateUserById(req.user.uid, {
      password: nova_senha
    });

    if (authError) {
      console.error('[trocarSenha] Erro no Supabase Auth:', authError.message);
      return res.status(500).json({ message: 'Erro ao atualizar senha. Tente novamente.' });
    }

    const { error: dbError } = await supabase
      .from('usuarios')
      .update({ senha_temporaria: false })
      .eq('id', req.user.uid);

    if (dbError) {
      console.error('[trocarSenha] Erro ao atualizar usuarios:', dbError.message);
    }

    res.status(200).json({ message: 'Senha atualizada com sucesso.' });
  } catch (error) {
    console.error('[trocarSenha] Erro inesperado:', error.message || error);
    res.status(500).json({ message: 'Erro inesperado ao atualizar senha.' });
  }
};

exports.esqueceuSenha = async (req, res) => {
  const { email } = req.body;

  try {
    const redirectTo = `${process.env.FRONTEND_URL || 'https://matopibalog.com.br'}/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

    if (error) {
      console.error('[esqueceuSenha] Supabase error:', error.status, error.message);
      return res.status(500).json({
        message: 'Erro ao enviar link de recuperação.',
        codigo: error.status,
        detalhe: error.message,
      });
    }

    res.json({ message: 'Link de recuperação enviado.' });
  } catch (err) {
    console.error('[esqueceuSenha] Exceção:', err.message || err);
    res.status(500).json({
      message: 'Erro ao enviar link de recuperação.',
      detalhe: err.message || 'Erro desconhecido',
    });
  }
};

exports.registerEmpresa = async (req, res) => {
  const { nome, email, senha, empresa, cnpj, telefone, plano, plano_id } = req.body;

  if (!nome || !email || !senha || !empresa) {
    return res.status(400).json({ message: 'Campos obrigatórios: nome, email, senha, empresa.' });
  }

  try {
    // Se veio plano_id do catálogo público, exigir que exista e esteja ativo.
    // O alias legado (`plano`) continua aceito como fallback quando não há plano_id.
    if (plano_id) {
      const { data: planoSel, error: planoErr } = await supabase
        .from('planos')
        .select('id, ativo')
        .eq('id', plano_id)
        .maybeSingle();
      if (planoErr) {
        console.error('[registerEmpresa] Erro ao validar plano_id:', planoErr.message);
        return res.status(500).json({ message: 'Erro ao validar plano.' });
      }
      if (!planoSel || planoSel.ativo !== true) {
        return res.status(400).json({ message: 'Plano selecionado inválido ou indisponível.' });
      }
    }

    // 1. Criar empresa via helper (gera código, trial automático). plano_id tem
    // precedência sobre o alias legado dentro do criarEmpresaCompleta.
    const { empresa: empresaData, error: empresaError } = await criarEmpresaCompleta({
      nome: empresa,
      cnpj,
      email_contato: email,
      telefone,
      plano_id,
      planoAlias: plano,
      tipo: 'transportadora',
    });

    if (empresaError || !empresaData) {
      return res.status(500).json({ message: empresaError || 'Erro ao criar empresa.' });
    }

    // 2. Criar usuário admin no Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true
    });

    if (authError) {
      await supabase.from('empresas').delete().eq('id', empresaData.id);
      return res.status(400).json({ message: authError.message });
    }

    // 3. Criar admin na tabela usuarios
    const { error: userError } = await supabase
      .from('usuarios')
      .insert({
        id: authData.user.id,
        nome,
        email,
        tipo: 'admin',
        status: 'ativo',
        empresa_id: empresaData.id,
        telefone: telefone || null
      });

    if (userError) {
      console.error('[registerEmpresa] Erro ao inserir usuario admin:', userError);
      await supabase.auth.admin.deleteUser(authData.user.id).catch(() => { });
      await supabase.from('empresas').delete().eq('id', empresaData.id);
      return res.status(500).json({ message: 'Erro ao salvar dados do usuário.' });
    }

    res.status(201).json({
      message: 'Cadastro realizado com sucesso!',
      empresa_id: empresaData.id
    });
  } catch (err) {
    console.error('Erro no register-empresa:', err);
    res.status(500).json({ message: 'Erro ao realizar cadastro.' });
  }
};
