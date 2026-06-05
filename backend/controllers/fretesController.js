const supabase = require('../config/supabase');

// Helper para validar status do motorista
const checkMotoristaStatus = async (uid) => {
  const { data, error } = await supabase
    .from('usuarios')
    .select('status')
    .eq('id', uid)
    .single();
  
  if (error || !data) return false;
  return data.status === 'ativo';
};

exports.getAll = async (req, res) => {
  const { data_inicio, data_fim, status, motorista_id } = req.query;
  const isAdmin = req.user.role === 'admin';

  try {
    const isSuperAdmin = req.user.is_super_admin === true;
    const empresaAlvo = isSuperAdmin
      ? (req.query.empresa_id || null)
      : req.empresa_id;

    let idsPermitidos = null;

    if (!isAdmin) {
      idsPermitidos = [req.user.uid];
    } else if (empresaAlvo) {
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
      .select('*, motoristas(usuarios(nome))');

    if (idsPermitidos !== null) {
      query = query.in('motorista_id', idsPermitidos.length ? idsPermitidos : ['']);
    }

    if (isAdmin && motorista_id) {
      query = query.eq('motorista_id', motorista_id);
    }

    if (data_inicio) query = query.gte('data', data_inicio);
    if (data_fim) query = query.lte('data', data_fim);
    if (status) query = query.eq('status', status);

    const { data, error } = await query.order('data', { ascending: false });
    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    console.error('Erro ao listar fretes:', error);
    res.status(500).json({ message: 'Erro ao listar fretes.' });
  }
};

exports.create = async (req, res) => {
  const { origem, destino, km_inicial, valor_frete, quem_recebeu } = req.body;
  const motorista_id = req.user.role === 'admin'
    ? (req.body.motorista_id || req.user.uid)
    : req.user.uid;

  try {
    // 1. Validar status
    const isAtivo = await checkMotoristaStatus(motorista_id);
    if (!isAtivo) return res.status(403).json({ message: 'Motorista não aprovado ou bloqueado.' });

    // 2. Buscar dados do motorista (placa e comissão) em uma única consulta
    const { data: motData, error: motError } = await supabase
      .from('motoristas')
      .select('placa_veiculo, percentual_comissao, empresa_id')
      .eq('id', motorista_id)
      .single();

    if (motError || !motData) throw motError || new Error('Dados do motorista não encontrados');

    const comissao = valor_frete * (motData.percentual_comissao / 100);

    // 2b. Definir quem_recebeu por tipo de empresa (TAC vs CLT), se não veio no body
    //  - autonomo (TAC) → 'motorista' (recebe direto, é dono do veículo)
    //  - transportadora (CLT) → 'proprietario' (a empresa recebe)
    // O body sobrescreve, para casos especiais definidos pelo usuário.
    let quemRecebeuFinal = quem_recebeu;
    if (!quemRecebeuFinal) {
      const { data: empData, error: empError } = await supabase
        .from('empresas')
        .select('tipo')
        .eq('id', motData.empresa_id)
        .single();
      if (empError) {
        console.error('[fretesController:create] Erro ao buscar tipo da empresa:', empError);
      }
      quemRecebeuFinal = empData?.tipo === 'autonomo' ? 'motorista' : 'proprietario';
    }

    // 3. Inserir frete
    const { data, error } = await supabase
      .from('fretes')
      .insert({
        motorista_id,
        empresa_id: motData.empresa_id,
        origem,
        destino,
        km_inicial,
        valor_frete,
        quem_recebeu: quemRecebeuFinal,
        placa: motData.placa_veiculo
      })
      .select()
      .single();

    if (error) {
      console.error('[fretesController:create] Erro ao inserir frete:', error);
      throw error;
    }

    res.status(201).json({ ...data, comissao_calculada: comissao });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erro ao criar frete.' });
  }
};

exports.getById = async (req, res) => {
  const { id } = req.params;
  try {
    const { data, error } = await supabase
      .from('fretes')
      .select('*, motoristas(usuarios(nome))')
      .eq('id', id)
      .single();

    if (error) throw error;
    if (req.user.role !== 'admin' && data.motorista_id !== req.user.uid) {
      return res.status(403).json({ message: 'Acesso negado.' });
    }

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar frete.' });
  }
};

exports.update = async (req, res) => {
  const { id } = req.params;

  try {
    const { data: checkData, error: checkError } = await supabase
      .from('fretes')
      .select('motorista_id')
      .eq('id', id)
      .single();

    if (checkError || !checkData) {
      return res.status(404).json({ message: 'Frete não encontrado.' });
    }

    if (req.user.role !== 'admin' && checkData.motorista_id !== req.user.uid) {
      return res.status(403).json({ message: 'Acesso negado.' });
    }

    // Extrair APENAS campos permitidos (previne mass assignment)
    const { origem, destino, km_inicial, km_final, valor_frete, status, quem_recebeu } = req.body;
    const allowedUpdate = {};
    if (origem !== undefined) allowedUpdate.origem = origem;
    if (destino !== undefined) allowedUpdate.destino = destino;
    if (km_inicial !== undefined) allowedUpdate.km_inicial = Number(km_inicial);
    if (km_final !== undefined) allowedUpdate.km_final = Number(km_final);
    if (valor_frete !== undefined) allowedUpdate.valor_frete = parseFloat(valor_frete);
    if (status !== undefined) allowedUpdate.status = status;
    if (quem_recebeu !== undefined) allowedUpdate.quem_recebeu = quem_recebeu;

    if (Object.keys(allowedUpdate).length === 0) {
      return res.status(400).json({ message: 'Nenhum campo válido para atualizar.' });
    }

    const { data, error } = await supabase
      .from('fretes')
      .update(allowedUpdate)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    console.error('Erro ao atualizar frete:', error);
    res.status(500).json({ message: 'Erro ao atualizar frete.' });
  }
};

exports.delete = async (req, res) => {
  const { id } = req.params;
  try {
    const { error } = await supabase
      .from('fretes')
      .update({ status: 'cancelado' })
      .eq('id', id);

    if (error) throw error;
    res.status(200).json({ message: 'Frete cancelado com sucesso.' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao cancelar frete.' });
  }
};
