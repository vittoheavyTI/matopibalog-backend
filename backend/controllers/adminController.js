const supabase = require('../config/supabase');

// ─── Listar Motoristas Pendentes ──────────────────────────────────────────────
exports.getPendentes = async (req, res) => {
  console.log('[adminController:getPendentes] Buscando motoristas pendentes...');
  try {
    const { data, error } = await supabase
      .from('motoristas')
      .select('*, usuarios(nome, email)')
      .eq('status_cadastro', 'pendente');

    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    console.error('[adminController:getPendentes] Erro detalhado:', error);
    res.status(500).json({ message: 'Erro ao listar motoristas pendentes: ' + (error.message || error) });
  }
};

// ─── Aprovar Motorista ────────────────────────────────────────────────────────
exports.approveMotorista = async (req, res) => {
  const { id } = req.params;
  const { percentual_comissao } = req.body;
  console.log(`[adminController:approveMotorista] Aprovando motorista ${id} com comissão ${percentual_comissao}%...`);

  try {
    // 1. Atualizar status na tabela usuarios
    const { error: userError } = await supabase
      .from('usuarios')
      .update({ status: 'ativo' })
      .eq('id', id);

    if (userError) throw userError;

    // 2. Atualizar motorista
    const { error: motError } = await supabase
      .from('motoristas')
      .update({ 
        status_cadastro: 'aprovado',
        percentual_comissao: percentual_comissao || 12.0
      })
      .eq('id', id);

    if (motError) throw motError;

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
    const { data, error } = await supabase
      .from('motoristas')
      .select('*, usuarios(nome, email, status)');

    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    console.error('[adminController:getAllMotoristas] Erro detalhado:', error);
    res.status(500).json({ message: 'Erro ao listar motoristas: ' + (error.message || error) });
  }
};

// ─── Atualizar Comissão e Dados do Motorista ──────────────────────────────────
exports.updateComissao = async (req, res) => {
  const { id } = req.params;
  const { percentual_comissao, placa_veiculo, cpf } = req.body;
  console.log(`[adminController:updateComissao] Atualizando motorista ${id}:`, { percentual_comissao, placa_veiculo, cpf });

  try {
    const updateData = {};
    if (percentual_comissao !== undefined) updateData.percentual_comissao = percentual_comissao;
    if (placa_veiculo !== undefined) updateData.placa_veiculo = placa_veiculo;
    if (cpf !== undefined) updateData.cpf = cpf;

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
    const { error: userError } = await supabase
      .from('usuarios')
      .update({ status })
      .eq('id', id);

    if (userError) throw userError;

    const motStatus = status === 'bloqueado' ? 'bloqueado' : 'aprovado';

    const { error: motError } = await supabase
      .from('motoristas')
      .update({ status_cadastro: motStatus })
      .eq('id', id);

    if (motError) throw motError;

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
    const { data: usuariosDb, error } = await supabase
      .from('usuarios')
      .select('*')
      .order('nome', { ascending: true });

    if (error) throw error;

    const { data: authList } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const authUsers = authList?.users || [];
    const dbIds = new Set((usuariosDb || []).map(u => u.id));

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

    res.status(200).json([...(usuariosDb || []), ...orphans]);
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

  const senhaFinal = senha || '123456';

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
    res.status(201).json({ message: 'Usuário criado com sucesso.', uid });
  } catch (error) {
    console.error('[adminController:createUsuario] Erro geral:', error);
    res.status(500).json({ message: 'Erro inesperado ao criar administrador: ' + (error.message || error) });
  }
};

// ─── Atualizar Administrador ──────────────────────────────────────────────────
exports.updateUsuario = async (req, res) => {
  const { id } = req.params;
  const { nome, telefone, cep, endereco, bairro, cidade, foto_url, permissoes, status, tipo } = req.body;
  console.log(`[adminController:updateUsuario] Atualizando usuário ${id}:`, { nome, status, tipo });

  try {
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
    const { data, error } = await supabase
      .from('fretes')
      .select('motorista_id, motoristas(*, usuarios(nome, email, status))')
      .in('status', ['ativo', 'pendente']);

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
