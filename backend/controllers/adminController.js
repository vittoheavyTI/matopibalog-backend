const supabase = require('../config/supabase');
const crypto = require('crypto');
const planoLimiteService = require('../services/planoLimiteService');

// Gera senha temporária aleatória e forte (sem caracteres ambíguos: 0/O/1/l/I)
// usando o crypto nativo do Node. Substitui o antigo default fixo '123456' em
// createUsuario, que era previsível. Nunca é logada nem persistida em texto puro.
function gerarSenhaTemporaria(tamanho = 14) {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let senha = '';
  for (let i = 0; i < tamanho; i++) {
    senha += alfabeto[crypto.randomInt(alfabeto.length)];
  }
  return senha;
}

// Default de comissão ao criar/aprovar motorista, conforme o tipo da empresa.
// Autônomo NÃO usa comissão fixa → default 0. Só zeramos com evidência positiva
// (tipo === 'autonomo'); tipo desconhecido/não resolvido mantém a regra atual (12%)
// para não regredir a criação de motoristas vinculados.
const defaultComissaoPorTipo = (empresaTipo) => (empresaTipo === 'autonomo' ? 0 : 12.0);

// ─── Listar Motoristas Pendentes ──────────────────────────────────────────────
exports.getPendentes = async (req, res) => {
  console.log('[adminController:getPendentes] Buscando motoristas pendentes...');
  try {
    const isSuperAdmin = req.user.is_super_admin === true;
    const empresaAlvo = isSuperAdmin
      ? (req.query.empresa_id || null)
      : req.empresa_id;

    let query = supabase
      .from('motoristas')
      .select('*, usuarios!inner(nome, email, empresa_id)')
      .eq('status_cadastro', 'pendente');

    if (empresaAlvo) {
      query = query.eq('usuarios.empresa_id', empresaAlvo);
    }
    // empresaAlvo === null → super-admin sem filtro → vê todos os pendentes

    const { data, error } = await query;

    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    console.error('[adminController:getPendentes] Erro:', error);
    res.status(500).json({ message: 'Erro ao listar motoristas pendentes: ' + (error.message || error) });
  }
};

// ─── Aprovar Motorista ────────────────────────────────────────────────────────
exports.approveMotorista = async (req, res) => {
  const { id } = req.params;
  const { percentual_comissao } = req.body;
  console.log(`[adminController:approveMotorista] Aprovando motorista ${id} com comissão ${percentual_comissao}%...`);

  try {
    // Validar ownership (super-admin pula)
    const isSuperAdmin = req.user.is_super_admin === true;
    if (!isSuperAdmin) {
      const { data: pertence, error: pertenceError } = await supabase
        .from('usuarios')
        .select('id')
        .eq('id', id)
        .eq('empresa_id', req.empresa_id)
        .eq('tipo', 'motorista')
        .single();

      if (pertenceError || !pertence) {
        return res.status(403).json({ message: 'Acesso negado: motorista não pertence a esta empresa.' });
      }
    }

    // 1. Atualizar status na tabela usuarios
    const { error: userError } = await supabase
      .from('usuarios')
      .update({ status: 'ativo' })
      .eq('id', id);

    if (userError) {
      console.error('[adminController:approveMotorista] Erro ao atualizar usuarios:', userError);
      throw userError;
    }

    // Tipo da empresa do motorista → define o default de comissão (autônomo → 0).
    const { data: motEmpresa } = await supabase
      .from('motoristas')
      .select('empresas!left(tipo)')
      .eq('id', id)
      .single();
    const tipoEmpresa = Array.isArray(motEmpresa?.empresas)
      ? motEmpresa.empresas[0]?.tipo
      : motEmpresa?.empresas?.tipo;

    // 2. Atualizar motorista
    const { error: motError } = await supabase
      .from('motoristas')
      .update({
        status_cadastro: 'aprovado',
        percentual_comissao: percentual_comissao || defaultComissaoPorTipo(tipoEmpresa)
      })
      .eq('id', id);

    if (motError) {
      console.error('[adminController:approveMotorista] Erro ao atualizar motoristas:', motError);
      throw motError;
    }

    console.log(`[adminController:approveMotorista] Motorista ${id} aprovado com sucesso.`);
    res.status(200).json({ message: 'Motorista aprovado com sucesso.' });
  } catch (error) {
    console.error('[adminController:approveMotorista] Erro detalhado:', error);
    res.status(500).json({ message: 'Erro ao aprovar motorista: ' + (error.message || error) });
  }
};

// ─── Listar Todos os Motoristas ───────────────────────────────────────────────
exports.getAllMotoristas = async (req, res) => {
  console.log('[adminController:getAllMotoristas] Buscando todos os motoristas...');
  try {
    let query = supabase
      .from('motoristas')
      .select('*, usuarios!inner(nome, email, status, empresa_id, telefone, cep, endereco, bairro, cidade, foto_url), empresas!left(nome, tipo)');

    if (!req.user.is_super_admin) {
      // Admin comum: filtra SEMPRE pela empresa dele, ignora qualquer ?empresa_id= passado
      query = query.eq('usuarios.empresa_id', req.empresa_id);
    } else if (req.query.empresa_id) {
      // Super-admin: pode filtrar por empresa opcionalmente
      query = query.eq('usuarios.empresa_id', req.query.empresa_id);
    }
    // Super-admin sem ?empresa_id= → retorna todos

    const { data, error } = await query;

    if (error) throw error;
    // Achata o tipo da empresa por motorista (mesmo padrão de getUsuarios).
    // Necessário para o painel diferenciar autônomo de vinculado nos cálculos
    // financeiros (PRs seguintes). Não altera nenhum cálculo aqui.
    const motoristasComTipo = (data || []).map(m => ({
      ...m,
      empresa_tipo: Array.isArray(m.empresas)
        ? m.empresas[0]?.tipo || null
        : m.empresas?.tipo || null,
    }));
    res.status(200).json(motoristasComTipo);
  } catch (error) {
    console.error('[adminController:getAllMotoristas] Erro detalhado:', error);
    res.status(500).json({ message: 'Erro ao listar motoristas: ' + (error.message || error) });
  }
};

// ─── Criar Motorista (cadastro pelo admin) ────────────────────────────────────
exports.createMotorista = async (req, res) => {
  const {
    nome, email, senha, cpf, placa_veiculo,
    telefone, cep, endereco, bairro, cidade, foto_url, percentual_comissao
  } = req.body;
  console.log('[adminController:createMotorista] Criando motorista:', { email, nome, empresa_id: req.empresa_id });

  if (!nome || !email || !senha) {
    return res.status(400).json({ message: 'Nome, e-mail e senha são obrigatórios.' });
  }
  if (senha.length < 6) {
    return res.status(400).json({ message: 'A senha deve ter no mínimo 6 caracteres.' });
  }

  // Frente #7: trava de limite de motoristas por plano. Avaliada ANTES de criar
  // no Supabase Auth para não deixar usuário órfão. Fail-open: um erro de infra da
  // própria trava não bloqueia o cadastro (o trigger legado no banco segue como
  // backstop) — a prioridade é não regredir a operação.
  try {
    const avaliacao = await planoLimiteService.avaliarLimiteMotoristas(supabase, req.empresa_id);
    if (!avaliacao.ok) {
      return res.status(409).json(planoLimiteService.montarErroLimiteMotoristas(avaliacao));
    }
  } catch (limiteErr) {
    console.error('[adminController:createMotorista] Falha ao avaliar limite (fail-open):', limiteErr.message);
  }

  let uid = null;
  try {
    // 1. Criar no Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true
    });

    if (authError) {
      console.error('[adminController:createMotorista] Erro no Supabase Auth:', authError.message);
      if (authError.message?.toLowerCase().includes('already') || authError.status === 422) {
        return res.status(400).json({ message: 'Este e-mail já está cadastrado no sistema.' });
      }
      return res.status(500).json({ message: `Erro ao criar motorista no Auth: ${authError.message}` });
    }

    uid = authData.user.id;

    // 2. Inserir em usuarios (empresa do ADMIN, já ativo, senha temporária)
    const { error: userError } = await supabase
      .from('usuarios')
      .insert({
        id: uid,
        nome,
        email,
        tipo: 'motorista',
        status: 'ativo',
        empresa_id: req.empresa_id,
        senha_temporaria: true,
        telefone: telefone || null,
        cep: cep || null,
        endereco: endereco || null,
        bairro: bairro || null,
        cidade: cidade || null,
        foto_url: foto_url || null
      });

    if (userError) {
      console.error('[adminController:createMotorista] Erro ao inserir em usuarios, revertendo Auth:', userError);
      try { await supabase.auth.admin.deleteUser(uid); } catch (e) { console.error('[adminController:createMotorista] rollback auth falhou:', e); }
      return res.status(500).json({ message: `Erro ao salvar motorista no banco: ${userError.message}` });
    }

    // Tipo da empresa do admin → define o default de comissão (autônomo → 0).
    const { data: empresaRow } = await supabase
      .from('empresas')
      .select('tipo')
      .eq('id', req.empresa_id)
      .single();
    const tipoEmpresa = empresaRow?.tipo || null;

    // 3. Inserir em motoristas (cpf vazio → null para não colidir no UNIQUE)
    const { error: motError } = await supabase
      .from('motoristas')
      .insert({
        id: uid,
        empresa_id: req.empresa_id,
        cpf: cpf && cpf.trim() !== '' ? cpf.trim() : null,
        placa_veiculo: placa_veiculo || '',
        percentual_comissao: percentual_comissao || defaultComissaoPorTipo(tipoEmpresa),
        status_cadastro: 'aprovado'
      });

    if (motError) {
      console.error('[adminController:createMotorista] Erro ao inserir em motoristas, revertendo usuarios + Auth:', motError);
      try { await supabase.from('usuarios').delete().eq('id', uid); } catch (e) { console.error('[adminController:createMotorista] rollback usuarios falhou:', e); }
      try { await supabase.auth.admin.deleteUser(uid); } catch (e) { console.error('[adminController:createMotorista] rollback auth falhou:', e); }
      // Frente #7: se o trigger legado de limite disparar (corrida com o pré-check),
      // mapeia para o 409 amigável — nunca deixa virar 500 genérico.
      if (planoLimiteService.ehErroTriggerLimiteMotoristas(motError)) {
        try {
          const avaliacao = await planoLimiteService.avaliarLimiteMotoristas(supabase, req.empresa_id);
          return res.status(409).json(planoLimiteService.montarErroLimiteMotoristas(avaliacao));
        } catch (_) {
          return res.status(409).json({ limiteMotoristasAtingido: true, message: 'Limite de motoristas do plano atingido. Faça upgrade para adicionar mais motoristas.' });
        }
      }
      return res.status(500).json({ message: `Erro ao salvar dados do motorista: ${motError.message}` });
    }

    console.log(`[adminController:createMotorista] Motorista ${nome} criado com sucesso (uid ${uid}).`);
    res.status(201).json({ message: 'Motorista cadastrado com sucesso.', uid });
  } catch (error) {
    console.error('[adminController:createMotorista] Erro geral:', error);
    if (uid) {
      try { await supabase.from('usuarios').delete().eq('id', uid); } catch (e) { console.error('[adminController:createMotorista] rollback usuarios falhou:', e); }
      try { await supabase.auth.admin.deleteUser(uid); } catch (e) { console.error('[adminController:createMotorista] rollback auth falhou:', e); }
    }
    res.status(500).json({ message: 'Erro inesperado ao cadastrar motorista: ' + (error.message || error) });
  }
};

// ─── Uso do plano (limite de motoristas) para o painel ────────────────────────
// Read-only: devolve limite, uso atual e nome do plano da empresa do usuário
// logado, usando o MESMO serviço da trava (fonte única de contagem). Não toca
// pagamentos/faturas/Asaas. Escopo garantido por verificarEmpresa (req.empresa_id).
exports.getPlanoUso = async (req, res) => {
  if (!req.empresa_id) {
    return res.status(400).json({ message: 'Empresa não identificada.' });
  }
  try {
    const avaliacao = await planoLimiteService.avaliarLimiteMotoristas(supabase, req.empresa_id);
    return res.status(200).json({
      limite: avaliacao.limite,
      totalAtual: avaliacao.totalAtual,
      planoAtual: avaliacao.planoAtual,
      ilimitado: avaliacao.ilimitado === true,
    });
  } catch (error) {
    console.error('[adminController:getPlanoUso] Erro ao carregar uso do plano:', error.message);
    return res.status(500).json({ message: 'Erro ao carregar uso do plano.' });
  }
};

// ─── Atualizar Comissão e Dados do Motorista ──────────────────────────────────
exports.updateComissao = async (req, res) => {
  const { id } = req.params;
  const { percentual_comissao, placa_veiculo, cpf, pode_finalizar_viagem } = req.body;
  console.log(`[adminController:updateComissao] Atualizando motorista ${id}:`, { percentual_comissao, placa_veiculo, cpf, pode_finalizar_viagem });

  try {
    // Validar ownership (super-admin pula)
    const isSuperAdmin = req.user.is_super_admin === true;
    if (!isSuperAdmin) {
      const { data: pertence, error: pertenceError } = await supabase
        .from('usuarios')
        .select('id')
        .eq('id', id)
        .eq('empresa_id', req.empresa_id)
        .eq('tipo', 'motorista')
        .single();

      if (pertenceError || !pertence) {
        return res.status(403).json({ message: 'Acesso negado: motorista não pertence a esta empresa.' });
      }
    }

    const updateData = {};
    if (percentual_comissao !== undefined) updateData.percentual_comissao = percentual_comissao;
    if (placa_veiculo !== undefined) updateData.placa_veiculo = placa_veiculo;
    if (cpf !== undefined) updateData.cpf = cpf;
    if (pode_finalizar_viagem !== undefined) updateData.pode_finalizar_viagem = Boolean(pode_finalizar_viagem);

    const { error } = await supabase
      .from('motoristas')
      .update(updateData)
      .eq('id', id);

    if (error) throw error;
    
    console.log(`[adminController:updateComissao] Motorista ${id} atualizado com sucesso no banco.`);
    res.status(200).json({ message: 'Dados do motorista atualizados com sucesso.' });
  } catch (error) {
    console.error('[adminController:updateComissao] Erro detalhado:', error);
    res.status(500).json({ message: 'Erro ao atualizar dados do motorista: ' + (error.message || error) });
  }
};

// ─── Bloquear/Desbloquear Motorista ───────────────────────────────────────────
exports.blockMotorista = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'bloqueado' ou 'ativo'
  console.log(`[adminController:blockMotorista] Alterando status do motorista ${id} para ${status}...`);

  try {
    // Validar ownership (super-admin pula)
    const isSuperAdmin = req.user.is_super_admin === true;
    if (!isSuperAdmin) {
      const { data: pertence, error: pertenceError } = await supabase
        .from('usuarios')
        .select('id')
        .eq('id', id)
        .eq('empresa_id', req.empresa_id)
        .eq('tipo', 'motorista')
        .single();

      if (pertenceError || !pertence) {
        return res.status(403).json({ message: 'Acesso negado: motorista não pertence a esta empresa.' });
      }
    }

    const { error: userError } = await supabase
      .from('usuarios')
      .update({ status })
      .eq('id', id);

    if (userError) {
      console.error('[adminController:blockMotorista] Erro ao atualizar usuarios:', userError);
      throw userError;
    }

    const motStatus = status === 'bloqueado' ? 'bloqueado' : 'aprovado';

    const { error: motError } = await supabase
      .from('motoristas')
      .update({ status_cadastro: motStatus })
      .eq('id', id);

    if (motError) {
      console.error('[adminController:blockMotorista] Erro ao atualizar motoristas:', motError);
      throw motError;
    }

    console.log(`[adminController:blockMotorista] Status do motorista ${id} alterado com sucesso.`);
    res.status(200).json({ message: `Motorista ${motStatus === 'bloqueado' ? 'bloqueado' : 'desbloqueado'}.` });
  } catch (error) {
    console.error('[adminController:blockMotorista] Erro detalhado:', error);
    res.status(500).json({ message: 'Erro ao alterar status do motorista: ' + (error.message || error) });
  }
};

// ─── Listar Administradores ───────────────────────────────────────────────────
exports.getUsuarios = async (req, res) => {
  console.log('[adminController:getUsuarios] Listando todos os usuários...');
  try {
    const isSuperAdmin = req.user.is_super_admin === true;
    const empresaAlvo = isSuperAdmin ? (req.query.empresa_id || null) : req.empresa_id;

    let query = supabase
      .from('usuarios')
      // FK explícita: !left não desambigua a relação (PGRST201 após migration 024);
      // embed to-one já é left join por padrão, semântica preservada.
      .select('*, empresas!usuarios_empresa_id_fkey(tipo)')
      .order('nome', { ascending: true });

    if (empresaAlvo) {
      query = query.eq('empresa_id', empresaAlvo);
    }
    // super-admin sem filtro → vê todos

    const { data: usuariosDb, error } = await query;

    if (error) throw error;

    const usuariosComEmpresa = (usuariosDb || []).map(u => ({
      ...u,
      empresa_tipo: Array.isArray(u.empresas)
        ? u.empresas[0]?.tipo || null
        : u.empresas?.tipo || null,
      is_super_admin: u.is_super_admin === true,
    }));

    // Órfãos do Auth (sem linha em usuarios) NÃO têm empresa_id → não dá para
    // atribuir a uma empresa. Só super-admin os vê; admin comum nunca (evita
    // vazar e-mails de outras empresas).
    if (!isSuperAdmin) {
      return res.status(200).json(usuariosComEmpresa || []);
    }

    const { data: authList } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const authUsers = authList?.users || [];
    const dbIds = new Set((usuariosComEmpresa || []).map(u => u.id));

    const orphans = authUsers
      .filter(au => !dbIds.has(au.id))
      .map(au => ({
        id: au.id,
        nome: au.user_metadata?.nome || au.email?.split('@')[0] || 'Sem nome',
        email: au.email,
        tipo: au.user_metadata?.role || 'admin',
        status: 'ativo',
        telefone: null,
        endereco: null,
        permissoes: { dashboard: true, motoristas: true, relatorios: true, usuarios: false, configuracoes: false },
        _orphan: true
      }));

    res.status(200).json([...(usuariosComEmpresa || []), ...orphans]);
  } catch (error) {
    console.error('[adminController:getUsuarios] Erro detalhado ao listar usuários admin:', error);
    res.status(500).json({ message: 'Erro ao listar administradores: ' + (error.message || error) });
  }
};

// ─── Criar Administrador ──────────────────────────────────────────────────────
exports.createUsuario = async (req, res) => {
  const { email, senha, nome, telefone, cep, endereco, bairro, cidade, foto_url, permissoes, tipo } = req.body;
  console.log('[adminController:createUsuario] Criando usuário:', { email, nome, tipo });

  if (!email || !nome) {
    return res.status(400).json({ message: 'Nome e e-mail são obrigatórios.' });
  }
  if (senha && senha.length < 6) {
    return res.status(400).json({ message: 'A senha deve ter no mínimo 6 caracteres.' });
  }
  // Defense-in-depth: este fluxo genérico cria apenas usuários administrativos. Motorista
  // exige linha correspondente em `motoristas` (placa, comissão, etc.), criada só pelo fluxo
  // próprio (createMotorista). Aceitar tipo='motorista' aqui geraria "motorista fantasma".
  if (tipo === 'motorista') {
    return res.status(400).json({ message: 'Motoristas devem ser cadastrados pelo fluxo de Motoristas.' });
  }
  if (tipo === 'operador') {
    return res.status(400).json({ message: 'Operador ainda não possui permissões no painel. Crie um administrador.' });
  }

  // [B1a] Super-admin deve escolher a empresa-alvo explicitamente (?empresa_id=, que o
  // tenant.js resolve marcando req.impersonating). Sem isso, req.empresa_id seria a empresa
  // do próprio super-admin → o usuário nasceria na empresa errada. Exige seleção explícita.
  if (req.user.is_super_admin === true && !req.impersonating) {
    return res.status(400).json({ message: 'Selecione a empresa para criar o usuário.' });
  }

  // [B1a] Validar que a empresa-alvo resolvida (req.empresa_id) existe — vale para super-admin
  // impersonando e para admin comum. Evita criar usuário órfão ou em empresa inexistente.
  if (!req.empresa_id) {
    return res.status(400).json({ message: 'Empresa do usuário não identificada.' });
  }
  const { data: empresaAlvo, error: empresaAlvoError } = await supabase
    .from('empresas')
    .select('id')
    .eq('id', req.empresa_id)
    .single();
  if (empresaAlvoError || !empresaAlvo) {
    return res.status(400).json({ message: 'Empresa selecionada não encontrada.' });
  }

  // Se o admin informou senha, usa a dele; senão gera uma aleatória forte.
  // A gerada é devolvida UMA única vez no response (senha_temporaria_gerada) para
  // o painel exibir ao admin; não é logada nem gravada em texto puro em `usuarios`.
  const senhaInformada = typeof senha === 'string' && senha.trim().length > 0;
  const senhaFinal = senhaInformada ? senha : gerarSenhaTemporaria();

  try {
    // 1. Criar no Supabase Auth
    console.log('[adminController:createUsuario] Criando no Supabase Auth...');
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password: senhaFinal,
      email_confirm: true
    });

    if (authError) {
      console.error('[adminController:createUsuario] Erro no Supabase Auth:', authError.message);
      if (authError.message?.toLowerCase().includes('already') || authError.status === 422) {
        return res.status(400).json({ message: 'Este e-mail já está cadastrado no sistema.' });
      }
      return res.status(500).json({ message: `Erro ao criar usuário no Auth: ${authError.message}` });
    }

    const uid = authData.user.id;
    console.log(`[adminController:createUsuario] Criado com UID ${uid}. Gravando na tabela usuarios...`);

    // 2. Inserir na tabela usuarios
    const { error: userError } = await supabase
      .from('usuarios')
      .insert({
        id: uid,
        nome,
        email,
        tipo: tipo || 'admin',
        status: 'ativo',
        empresa_id: req.empresa_id,
        // [B1a] Usuário criado pelo admin nasce com senha provisória → força troca no 1º acesso.
        senha_temporaria: true,
        telefone: telefone || null,
        cep: cep || null,
        endereco: endereco || null,
        bairro: bairro || null,
        cidade: cidade || null,
        foto_url: foto_url || null,
        permissoes: permissoes || { dashboard: true, motoristas: true, relatorios: true, usuarios: false, configuracoes: false }
      });

    if (userError) {
      console.error('[adminController:createUsuario] Erro ao inserir na tabela usuarios:', userError.message);
      await supabase.auth.admin.deleteUser(uid).catch(() => {});
      return res.status(500).json({ message: `Erro ao salvar dados do administrador no banco: ${userError.message}` });
    }

    console.log(`[adminController:createUsuario] Usuário ${nome} criado com sucesso.`);
    const resposta = { message: 'Usuário criado com sucesso.', uid };
    // Só retorna a senha quando foi o backend que a gerou (admin não informou).
    if (!senhaInformada) resposta.senha_temporaria_gerada = senhaFinal;
    res.status(201).json(resposta);
  } catch (error) {
    console.error('[adminController:createUsuario] Erro geral:', error);
    res.status(500).json({ message: 'Erro inesperado ao criar administrador: ' + (error.message || error) });
  }
};

// ─── Resetar Senha de Usuário ───────────────────────────────────────────────
exports.resetSenhaUsuario = async (req, res) => {
  const { id } = req.params;
  const { nova_senha } = req.body;
  console.log(`[adminController:resetSenhaUsuario] Resetando senha do usuário ${id}...`);

  if (!nova_senha || typeof nova_senha !== 'string' || nova_senha.length < 6) {
    return res.status(400).json({ message: 'Senha deve ter pelo menos 6 caracteres.' });
  }

  try {
    // Ownership: super-admin pode resetar qualquer um;
    // admin comum só pode resetar motorista da própria empresa.
    const isSuperAdmin = req.user.is_super_admin === true;
    if (!isSuperAdmin) {
      const { data: pertence, error: pertenceError } = await supabase
        .from('usuarios')
        .select('id, tipo')
        .eq('id', id)
        .eq('empresa_id', req.empresa_id)
        .single();

      if (pertenceError || !pertence) {
        return res.status(403).json({ message: 'Acesso negado: usuário não pertence a esta empresa.' });
      }
      // Admin de empresa NÃO pode resetar senha de outro admin ou super-admin.
      if (pertence.tipo !== 'motorista') {
        return res.status(403).json({ message: 'Acesso negado: você só pode resetar senha de motoristas.' });
      }
    }

    const { data, error } = await supabase.auth.admin.updateUserById(id, {
      password: nova_senha
    });

    if (error) {
      console.error('[adminController:resetSenhaUsuario] Erro no Supabase Auth:', error);
      return res.status(500).json({ message: 'Erro ao resetar senha do usuário.' });
    }

    const { error: dbError } = await supabase
      .from('usuarios')
      .update({ senha_temporaria: true })
      .eq('id', id);

    if (dbError) {
      console.error('[adminController:resetSenhaUsuario] Erro ao atualizar senha_temporaria:', dbError.message);
    }

    console.log(`[adminController:resetSenhaUsuario] Senha resetada com sucesso para ${id}.`);
    res.status(200).json({ message: 'Senha resetada com sucesso.' });
  } catch (error) {
    console.error('[adminController:resetSenhaUsuario] Erro detalhado:', error);
    res.status(500).json({ message: 'Erro ao resetar senha do usuário: ' + (error.message || error) });
  }
};

// ─── Atualizar Administrador ──────────────────────────────────────────────────
exports.updateUsuario = async (req, res) => {
  const { id } = req.params;
  const { nome, telefone, cep, endereco, bairro, cidade, foto_url, permissoes, status, tipo } = req.body;
  console.log(`[adminController:updateUsuario] Atualizando usuário ${id}:`, { nome, status, tipo });

  try {
    // Validar ownership (super-admin pula)
    const isSuperAdmin = req.user.is_super_admin === true;
    let usuarioAtual = null;
    if (!isSuperAdmin) {
      const { data: pertence, error: pertenceError } = await supabase
        .from('usuarios')
        .select('id, tipo')
        .eq('id', id)
        .eq('empresa_id', req.empresa_id)
        .single();

      if (pertenceError || !pertence) {
        return res.status(403).json({ message: 'Acesso negado: usuário não pertence a esta empresa.' });
      }
      usuarioAtual = pertence;
    }

    const tipoProtegidoSolicitado = tipo === 'motorista' || tipo === 'operador';
    if (tipoProtegidoSolicitado && !usuarioAtual) {
      const { data: usuario, error: usuarioError } = await supabase
        .from('usuarios')
        .select('id, tipo')
        .eq('id', id)
        .single();

      if (usuarioError || !usuario) {
        return res.status(404).json({ message: 'Usuário não encontrado.' });
      }
      usuarioAtual = usuario;
    }

    if (tipoProtegidoSolicitado && tipo !== usuarioAtual.tipo) {
      return res.status(400).json({ message: 'Não é permitido alterar o tipo do usuário para motorista ou operador.' });
    }

    const updateData = {};
    if (nome !== undefined) updateData.nome = nome;
    if (telefone !== undefined) updateData.telefone = telefone;
    if (cep !== undefined) updateData.cep = cep;
    if (endereco !== undefined) updateData.endereco = endereco;
    if (bairro !== undefined) updateData.bairro = bairro;
    if (cidade !== undefined) updateData.cidade = cidade;
    if (foto_url !== undefined) updateData.foto_url = foto_url;
    if (permissoes !== undefined) updateData.permissoes = permissoes;
    if (status !== undefined) updateData.status = status;
    if (tipo !== undefined) updateData.tipo = tipo;

    const { error } = await supabase
      .from('usuarios')
      .update(updateData)
      .eq('id', id);

    if (error) throw error;

    console.log(`[adminController:updateUsuario] Usuário ${id} atualizado com sucesso.`);
    res.status(200).json({ message: 'Usuário atualizado com sucesso.' });
  } catch (error) {
    console.error('[adminController:updateUsuario] Erro detalhado ao atualizar admin:', error);
    res.status(500).json({ message: 'Erro ao atualizar administrador: ' + (error.message || error) });
  }
};

// ─── Listar Motoristas em Viagem ──────────────────────────────────────────────
exports.getEmViagem = async (req, res) => {
  console.log('[adminController:getEmViagem] Listando motoristas em viagem ativa...');
  try {
    const isSuperAdmin = req.user.is_super_admin === true;
    const empresaAlvo = isSuperAdmin
      ? (req.query.empresa_id || null)
      : req.empresa_id;

    let idsPermitidos = null;
    if (empresaAlvo) {
      const { data: uids, error: uidsError } = await supabase
        .from('usuarios')
        .select('id')
        .eq('empresa_id', empresaAlvo)
        .eq('tipo', 'motorista');
      if (uidsError) throw uidsError;
      idsPermitidos = uids.map(u => u.id);
    }

    let query = supabase
      .from('fretes')
      .select('motorista_id, motoristas(*, usuarios(nome, email, status))')
      .in('status', ['ativo', 'pendente']);

    if (idsPermitidos !== null) {
      query = query.in('motorista_id', idsPermitidos.length ? idsPermitidos : ['']);
    }

    const { data, error } = await query;

    if (error) throw error;

    const uniqueMotoristas = [];
    const seenUids = new Set();
    
    data.forEach(item => {
      if (item.motoristas && !seenUids.has(item.motorista_id)) {
        seenUids.add(item.motorista_id);
        uniqueMotoristas.push(item.motoristas);
      }
    });

    res.status(200).json(uniqueMotoristas);
  } catch (error) {
    console.error('[adminController:getEmViagem] Erro detalhado:', error);
    res.status(500).json({ message: 'Erro ao listar motoristas em viagem: ' + (error.message || error) });
  }
};

// ─── Exclusão de Administrador ────────────────────────────────────────────────
exports.deleteUsuario = async (req, res) => {
  const { id } = req.params;
  console.log(`[adminController:deleteUsuario] Solicitando exclusão do administrador ${id}...`);

  if (id === req.user.uid) {
    console.warn(`[adminController:deleteUsuario] Tentativa de auto-exclusão por ${id}. Negado.`);
    return res.status(400).json({ message: 'Você não pode excluir sua própria conta.' });
  }

  try {
    // Validar ownership (super-admin pula) — ANTES de qualquer delete
    const isSuperAdmin = req.user.is_super_admin === true;
    if (!isSuperAdmin) {
      const { data: pertence, error: pertenceError } = await supabase
        .from('usuarios')
        .select('id')
        .eq('id', id)
        .eq('empresa_id', req.empresa_id)
        .single();

      if (pertenceError || !pertence) {
        return res.status(403).json({ message: 'Acesso negado: usuário não pertence a esta empresa.' });
      }
    }

    // 1. Verificar se o usuário possui registro na tabela motoristas
    const { data: motorista } = await supabase
      .from('motoristas')
      .select('id')
      .eq('id', id)
      .single();

    if (motorista) {
      console.log(`[adminController:deleteUsuario] Usuário ${id} possui registro em motoristas. Removendo dados vinculados...`);

      const { error: despesasError } = await supabase.from('despesas').delete().eq('motorista_id', id);
      if (despesasError) throw despesasError;

      const { error: abastecimentosError } = await supabase.from('abastecimentos').delete().eq('motorista_id', id);
      if (abastecimentosError) throw abastecimentosError;

      const { error: valesError } = await supabase.from('vales').delete().eq('motorista_id', id);
      if (valesError) throw valesError;

      const { error: fretesError } = await supabase.from('fretes').delete().eq('motorista_id', id);
      if (fretesError) throw fretesError;

      const { error: motError } = await supabase
        .from('motoristas')
        .delete()
        .eq('id', id);
      if (motError) throw motError;
    }

    // 2. Remover da tabela usuarios
    console.log(`[adminController:deleteUsuario] Removendo ${id} da tabela usuarios...`);
    const { error: dbError } = await supabase
      .from('usuarios')
      .delete()
      .eq('id', id);

    if (dbError) throw dbError;

    // 3. Remover do Supabase Auth
    console.log(`[adminController:deleteUsuario] Removendo ${id} do Supabase Auth...`);
    const { error: authError } = await supabase.auth.admin.deleteUser(id);
    if (authError) {
      console.warn('[adminController:deleteUsuario] Registro removido do banco, mas falha no Auth:', authError.message);
    }

    console.log(`[adminController:deleteUsuario] Administrador ${id} deletado.`);
    res.status(200).json({ message: 'Administrador excluído com sucesso.' });
  } catch (error) {
    console.error('[adminController:deleteUsuario] Erro ao excluir administrador:', error);
    res.status(500).json({ message: 'Erro ao excluir administrador: ' + (error.message || error) });
  }
};

// ─── Exclusão de Motorista (Com Cascata Programática) ─────────────────────────
exports.deleteMotorista = async (req, res) => {
  const { id } = req.params;
  console.log(`[adminController:deleteMotorista] Solicitando exclusão do motorista ${id}...`);

  try {
    // Validar ownership (super-admin pula) — ANTES de qualquer delete
    const isSuperAdmin = req.user.is_super_admin === true;
    if (!isSuperAdmin) {
      const { data: pertence, error: pertenceError } = await supabase
        .from('usuarios')
        .select('id')
        .eq('id', id)
        .eq('empresa_id', req.empresa_id)
        .eq('tipo', 'motorista')
        .single();

      if (pertenceError || !pertence) {
        return res.status(403).json({ message: 'Acesso negado: motorista não pertence a esta empresa.' });
      }
    }

    // 1. Verificar se há fretes ativos (não pode excluir motorista em viagem ativa)
    const { data: fretesAtivos, error: fretesError } = await supabase
      .from('fretes')
      .select('id')
      .eq('motorista_id', id)
      .in('status', ['pendente', 'ativo', 'em_andamento']);

    if (fretesError) throw fretesError;

    if (fretesAtivos && fretesAtivos.length > 0) {
      console.warn(`[adminController:deleteMotorista] Impedindo exclusão do motorista ${id} - Viagem ativa em curso.`);
      return res.status(400).json({
        message: `Não é possível excluir este motorista. Ele possui ${fretesAtivos.length} viagem(ns) ativa(s). Finalize ou cancele as viagens antes de excluir.`
      });
    }

    // 2. Excluir dados vinculados para resolver Foreign Key Constraints
    console.log(`[adminController:deleteMotorista] Excluindo registros vinculados (despesas, abastecimentos, vales, fretes)...`);

    const { error: despesasError } = await supabase.from('despesas').delete().eq('motorista_id', id);
    if (despesasError) {
      console.error('[adminController:deleteMotorista] Falha ao deletar despesas:', despesasError);
      throw despesasError;
    }

    const { error: abastecimentosError } = await supabase.from('abastecimentos').delete().eq('motorista_id', id);
    if (abastecimentosError) {
      console.error('[adminController:deleteMotorista] Falha ao deletar abastecimentos:', abastecimentosError);
      throw abastecimentosError;
    }

    const { error: valesError } = await supabase.from('vales').delete().eq('motorista_id', id);
    if (valesError) {
      console.error('[adminController:deleteMotorista] Falha ao deletar vales:', valesError);
      throw valesError;
    }

    const { error: fretesErrorDel } = await supabase.from('fretes').delete().eq('motorista_id', id);
    if (fretesErrorDel) {
      console.error('[adminController:deleteMotorista] Falha ao deletar fretes:', fretesErrorDel);
      throw fretesErrorDel;
    }

    // 3. Remover da tabela motoristas
    console.log(`[adminController:deleteMotorista] Removendo motorista ${id} da tabela motoristas...`);
    const { error: motError } = await supabase
      .from('motoristas')
      .delete()
      .eq('id', id);

    if (motError) throw motError;

    // 4. Remover da tabela usuarios
    console.log(`[adminController:deleteMotorista] Removendo motorista ${id} da tabela usuarios...`);
    const { error: userError } = await supabase
      .from('usuarios')
      .delete()
      .eq('id', id);

    if (userError) throw userError;

    // 5. Remover do Supabase Auth
    console.log(`[adminController:deleteMotorista] Removendo motorista ${id} do Supabase Auth...`);
    const { error: authError } = await supabase.auth.admin.deleteUser(id);
    if (authError) {
      console.warn('[adminController:deleteMotorista] Registros removidos do banco, mas falha no Auth:', authError.message);
    }

    console.log(`[adminController:deleteMotorista] Motorista ${id} deletado em definitivo do sistema.`);
    res.status(200).json({ message: 'Motorista excluído com sucesso.' });
  } catch (error) {
    console.error('[adminController:deleteMotorista] Erro detalhado ao excluir motorista:', error);
    res.status(500).json({ message: 'Erro ao excluir motorista: ' + (error.message || error) });
  }
};
