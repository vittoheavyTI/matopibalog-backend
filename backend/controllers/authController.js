const supabase = require('../config/supabase');
const jwt = require('jsonwebtoken');

exports.register = async (req, res) => {
  const { nome, email, senha, tipo } = req.body;

  if (!nome || !email || !senha) {
    return res.status(400).json({ message: 'Campos obrigatórios: nome, email, senha.' });
  }

  try {
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true
    });

    if (authError) return res.status(400).json({ message: authError.message });

    const { error: insertError } = await supabase.from('usuarios').insert({
      id: authData.user.id,
      nome,
      email,
      tipo: tipo || 'motorista',
      status: 'pendente'
    });

    if (insertError) {
      console.error('[register] Falha ao inserir em usuarios, revertendo Auth:', insertError.message);
      await supabase.auth.admin.deleteUser(authData.user.id).catch(() => {});
      return res.status(500).json({ message: 'Erro ao criar perfil. Tente novamente.' });
    }

    if (tipo === 'motorista') {
      await supabase.from('motoristas').insert({
        id: authData.user.id,
        cpf: '',
        placa_veiculo: '',
        status_cadastro: 'pendente'
      });
    }

    res.status(201).json({ message: 'Usuário criado com sucesso!' });
  } catch (error) {
    console.error('Erro no registro:', error.message);
    res.status(500).json({ message: 'Erro ao cadastrar. Verifique os dados e tente novamente.' });
  }
};

exports.login = async (req, res) => {
  const { email, senha } = req.body;

  try {
    // 1. Autenticar no Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password: senha
    });

    if (authError) return res.status(401).json({ message: 'Credenciais inválidas.' });

    const uid = authData.user.id;

    // 2. Buscar perfil detalhado
    const { data: userData, error: userError } = await supabase
      .from('usuarios')
      .select('*')
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
      { uid: userData.id, email: userData.email, role: userData.tipo },
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
        foto_url: userData.foto_url
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

exports.getMe = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('usuarios')
      .select('*, motoristas(*)')
      .eq('id', req.user.uid)
      .single();

    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar dados do usuário.' });
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
  const { nome, email, senha, empresa, cnpj, telefone, plano } = req.body;

  if (!nome || !email || !senha || !empresa) {
    return res.status(400).json({ message: 'Campos obrigatórios: nome, email, senha, empresa.' });
  }

  try {
    // 1. Buscar plano
    const planosMap = { basico: 'Plano Básico', profissional: 'Plano Profissional', empresarial: 'Plano Enterprise' };
    const planoNome = planosMap[plano] || 'Básico';
    const { data: planoData, error: planoError } = await supabase
      .from('planos')
      .select('id, dias_trial')
      .eq('nome', planoNome)
      .single();

    if (planoError) return res.status(400).json({ message: 'Plano não encontrado.' });

    // 2. Criar empresa
    const trialEnd = new Date(Date.now() + (planoData.dias_trial || 7) * 24 * 60 * 60 * 1000).toISOString();
    const { data: empresaData, error: empresaError } = await supabase
      .from('empresas')
      .insert({
        nome: empresa,
        cnpj: cnpj || '',
        email_contato: email,
        telefone_contato: telefone || '',
        plano_id: planoData.id,
        status: 'trial',
        trial_started_at: new Date().toISOString(),
        trial_ends_at: trialEnd,
      })
      .select()
      .single();

    if (empresaError) return res.status(500).json({ message: 'Erro ao criar empresa.' });

    // 3. Criar usuário no Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true
    });

    if (authError) {
      await supabase.from('empresas').delete().eq('id', empresaData.id);
      return res.status(400).json({ message: authError.message });
    }

    // 4. Criar admin na tabela usuarios
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
