const supabase = require('../config/supabase');
const notificacaoService = require('../services/notificacaoService');

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

// Mensagem única da trava de pendências (reuso nas duas travas)
const MSG_PENDENCIAS = 'Não é possível finalizar: há lançamentos pendentes deste motorista. Aprove ou rejeite todos antes de finalizar.';

// Retorna true se o motorista tem QUALQUER lançamento pendente (despesa/abast/vale).
// Checagem por motorista_id (não só frete_id): lançamentos do painel têm frete_id = null.
const motoristaTemPendencias = async (motoristaId) => {
  for (const tabela of ['despesas', 'abastecimentos', 'vales']) {
    const { count, error } = await supabase
      .from(tabela)
      .select('id', { count: 'exact', head: true })
      .eq('motorista_id', motoristaId)
      .eq('status', 'pendente');
    if (error) throw error;
    if ((count || 0) > 0) return true;
  }
  return false;
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

    // Trava de finalização: bloqueia se o motorista tiver lançamentos pendentes (vale p/ todos)
    if (allowedUpdate.status === 'finalizado' && await motoristaTemPendencias(checkData.motorista_id)) {
      return res.status(409).json({ message: MSG_PENDENCIAS });
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

exports.finalizar = async (req, res) => {
  const { id } = req.params;
  const isSuperAdmin = req.user.is_super_admin === true;
  const isAdmin = req.user.role === 'admin';

  try {
    // Busca o frete e verifica ownership
    const { data: frete, error: freteError } = await supabase
      .from('fretes')
      .select('id, motorista_id, empresa_id, status')
      .eq('id', id)
      .single();

    if (freteError || !frete) return res.status(404).json({ message: 'Frete não encontrado.' });

    // super-admin: sempre pode
    if (!isSuperAdmin) {
      // admin empresa: verifica se o frete é da empresa
      if (isAdmin) {
        if (frete.empresa_id !== req.empresa_id) {
          return res.status(403).json({ message: 'Acesso negado.' });
        }
      } else {
        // motorista: verifica ownership + permissão
        if (frete.motorista_id !== req.user.uid) {
          return res.status(403).json({ message: 'Acesso negado.' });
        }

        // Busca permissão e tipo de empresa
        const { data: motData } = await supabase
          .from('motoristas')
          .select('pode_finalizar_viagem, empresas(tipo)')
          .eq('id', req.user.uid)
          .single();

        const isAutonomo = motData?.empresas?.tipo === 'autonomo';
        const podeFinalizar = motData?.pode_finalizar_viagem === true;

        if (!isAutonomo && !podeFinalizar) {
          return res.status(403).json({
            message: 'Sua empresa não autorizou a finalização de viagens pelo app. Contate o administrador.'
          });
        }
      }
    }

    if (frete.status === 'finalizado') {
      return res.status(400).json({ message: 'Esta viagem já está finalizada.' });
    }

    // Trava de finalização: bloqueia se o motorista tiver lançamentos pendentes (vale p/ todos, inclusive super-admin)
    if (await motoristaTemPendencias(frete.motorista_id)) {
      return res.status(409).json({ message: MSG_PENDENCIAS });
    }

    const { data, error } = await supabase
      .from('fretes')
      .update({ status: 'finalizado' })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    notificacaoService.notificarViagemFinalizada(data).catch(() => {});
    res.status(200).json(data);
  } catch (error) {
    console.error('Erro ao finalizar frete:', error);
    res.status(500).json({ message: 'Erro ao finalizar viagem.' });
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
