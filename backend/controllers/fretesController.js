const supabase = require('../config/supabase');
const notificacaoService = require('../services/notificacaoService');
const { calcularComissao } = require('../utils/comissao');

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
const MSG_PENDENCIAS = 'Não é possível finalizar: há lançamentos pendentes desta viagem. Aprove ou rejeite todos antes de finalizar.';

// Datas simples representam o último dia incluído pelo cliente. Converte esse
// dia no limite exclusivo seguinte; datetimes já expressam o limite desejado.
const normalizarDataFimExclusiva = (dataFim) => {
  if (typeof dataFim !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) return dataFim;

  const [ano, mes, dia] = dataFim.split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  const dataValida = data.getUTCFullYear() === ano
    && data.getUTCMonth() === mes - 1
    && data.getUTCDate() === dia;

  if (!dataValida) return dataFim;

  data.setUTCDate(data.getUTCDate() + 1);
  return data.toISOString().slice(0, 10);
};

// Retorna true se o FRETE tem algum lançamento pendente (despesa/abast/vale).
// Escopo por frete_id: bloqueia só a viagem atual, não outras viagens do motorista.
const freteTemPendencias = async (freteId) => {
  for (const tabela of ['despesas', 'abastecimentos', 'vales']) {
    const { count, error } = await supabase
      .from(tabela)
      .select('id', { count: 'exact', head: true })
      .eq('frete_id', freteId)
      .eq('status', 'pendente');
    if (error) throw error;
    if ((count || 0) > 0) return true;
  }
  return false;
};

// Retorna true se o motorista pertence a uma empresa do tipo 'autonomo'.
// Fonte confiável: motoristas.empresa_id → empresas.tipo. NUNCA detecta por nome.
// Retorna null quando o lookup falha (indeterminado), para o chamador aplicar fallback leniente.
const isMotoristaAutonomo = async (motoristaId) => {
  const { data: mot, error: motErr } = await supabase
    .from('motoristas')
    .select('empresa_id')
    .eq('id', motoristaId)
    .single();
  if (motErr || !mot) return null;
  const { data: emp, error: empErr } = await supabase
    .from('empresas')
    .select('tipo')
    .eq('id', mot.empresa_id)
    .single();
  if (empErr || !emp) return null;
  return emp.tipo === 'autonomo';
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
    if (data_fim) query = query.lt('data', normalizarDataFimExclusiva(data_fim));
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

    // 2b. Definir quem_recebeu por tipo de empresa (TAC vs CLT):
    //  - autonomo (TAC) → SEMPRE 'motorista' (recebe direto, é dono do veículo); o body NÃO
    //    sobrescreve — defense-in-depth contra requisição forjada (espelha a trava do frontend).
    //  - transportadora (CLT) / vinculado → respeita o body; default 'proprietario' se ausente.
    // Lookup do tipo sempre executado; se falhar, fallback leniente + log (mantém comportamento atual).
    let quemRecebeuFinal = quem_recebeu;
    const { data: empData, error: empError } = await supabase
      .from('empresas')
      .select('tipo')
      .eq('id', motData.empresa_id)
      .single();
    if (empError || !empData) {
      console.warn('[fretesController:create] lookup tipo empresa falhou; fallback leniente:', empError?.message);
    }
    if (empData?.tipo === 'autonomo') {
      quemRecebeuFinal = 'motorista';
    } else if (!quemRecebeuFinal) {
      quemRecebeuFinal = 'proprietario';
    }

    // Comissão só para VINCULADO (empresa.tipo conhecido e ≠ 'autonomo'). Autônomo e
    // tipo desconhecido → 0 (nunca assume 12%). Campo comissao_calculada mantido no
    // contrato da resposta, apenas zerado quando não há comissão fixa.
    const comissao = calcularComissao(valor_frete, motData.percentual_comissao, empData?.tipo);

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

    notificacaoService.notificarFreteCriado(data).catch(() => {});
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

    if (error || !data) {
      return res.status(404).json({ message: 'Frete não encontrado.' });
    }

    // Isolamento por tenant: super-admin acessa tudo; admin só a própria
    // empresa; motorista só os próprios fretes.
    const isSuperAdmin = req.user.is_super_admin === true;
    if (!isSuperAdmin) {
      if (req.user.role === 'admin') {
        if (data.empresa_id !== req.empresa_id) {
          return res.status(403).json({ message: 'Acesso negado.' });
        }
      } else if (data.motorista_id !== req.user.uid) {
        return res.status(403).json({ message: 'Acesso negado.' });
      }
    }

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar frete.' });
  }
};

exports.update = async (req, res) => {
  const { id } = req.params;

  try {
    const isSuperAdmin = req.user.is_super_admin === true;
    const isAdmin = req.user.role === 'admin';

    const { data: checkData, error: checkError } = await supabase
      .from('fretes')
      .select('motorista_id, empresa_id')
      .eq('id', id)
      .single();

    if (checkError || !checkData) {
      return res.status(404).json({ message: 'Frete não encontrado.' });
    }

    // Ownership por perfil (espelha exports.finalizar):
    //  - super-admin: sempre pode
    //  - admin de empresa: só fretes da própria empresa (isolamento multi-tenant)
    //  - motorista: só o próprio frete
    if (!isSuperAdmin) {
      if (isAdmin) {
        if (checkData.empresa_id !== req.empresa_id) {
          return res.status(403).json({ message: 'Acesso negado.' });
        }
      } else if (checkData.motorista_id !== req.user.uid) {
        return res.status(403).json({ message: 'Acesso negado.' });
      }
    }

    // Extrair APENAS campos permitidos (previne mass assignment)
    // data com alias (dataFrete) para não colidir com o const { data } do Supabase abaixo
    const { origem, destino, km_inicial, km_final, valor_frete, status, quem_recebeu, data: dataFrete } = req.body;
    const allowedUpdate = {};
    if (origem !== undefined) allowedUpdate.origem = origem;
    if (destino !== undefined) allowedUpdate.destino = destino;
    if (km_inicial !== undefined) allowedUpdate.km_inicial = Number(km_inicial);
    if (km_final !== undefined) allowedUpdate.km_final = Number(km_final);
    if (valor_frete !== undefined) allowedUpdate.valor_frete = parseFloat(valor_frete);
    if (status !== undefined) allowedUpdate.status = status;
    if (quem_recebeu !== undefined) allowedUpdate.quem_recebeu = quem_recebeu;
    if (dataFrete !== undefined) allowedUpdate.data = dataFrete;

    if (Object.keys(allowedUpdate).length === 0) {
      return res.status(400).json({ message: 'Nenhum campo válido para atualizar.' });
    }

    // Defense-in-depth: autônomo SEMPRE recebe via 'motorista'. Força o valor independentemente
    // do body (espelha a trava do frontend). Vinculado preserva o valor enviado. Lookup pelo tipo
    // real da empresa (motoristas → empresas.tipo), nunca por nome; falha → fallback leniente + log.
    if (allowedUpdate.quem_recebeu !== undefined) {
      const autonomo = await isMotoristaAutonomo(checkData.motorista_id);
      if (autonomo === true) {
        allowedUpdate.quem_recebeu = 'motorista';
      } else if (autonomo === null) {
        console.warn('[fretesController:update] lookup tipo empresa falhou; mantendo quem_recebeu do body (fallback leniente).');
      }
    }

    // Trava de finalização: bloqueia se o motorista tiver lançamentos pendentes (vale p/ todos)
    if (allowedUpdate.status === 'finalizado' && await freteTemPendencias(id)) {
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
      .select('id, motorista_id, empresa_id, status, km_inicial')
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

    // Trava de finalização: bloqueia se a viagem tiver lançamentos pendentes (vale p/ todos, inclusive super-admin)
    if (await freteTemPendencias(frete.id)) {
      return res.status(409).json({ message: MSG_PENDENCIAS });
    }

    // Série 1.5 (KM na finalização): o app NOVO envia km_inicial/km_final no corpo;
    // quando vierem, validamos (positivos, km_final > km_inicial) e persistimos junto da
    // finalização. App/cliente ANTIGO não manda KM → finaliza como antes (compatibilidade;
    // a trava obrigatória rígida fica para um PR posterior, após o APK novo validado).
    const updatePayload = { status: 'finalizado' };
    const { km_inicial: kmIniBody, km_final: kmFinBody } = req.body || {};
    const temKmIni = kmIniBody !== undefined && kmIniBody !== null && kmIniBody !== '';
    const temKmFin = kmFinBody !== undefined && kmFinBody !== null && kmFinBody !== '';

    if (temKmFin) {
      const kmFinal = Number(kmFinBody);
      if (!Number.isFinite(kmFinal) || kmFinal <= 0) {
        return res.status(422).json({ message: 'KM final inválido.' });
      }
      // KM inicial efetivo: o enviado agora (se houver) ou o já gravado no frete.
      let kmInicialEfetivo = frete.km_inicial;
      if (temKmIni) {
        const kmIni = Number(kmIniBody);
        if (!Number.isFinite(kmIni) || kmIni <= 0) {
          return res.status(422).json({ message: 'KM inicial inválido.' });
        }
        kmInicialEfetivo = kmIni;
        updatePayload.km_inicial = kmIni;
      }
      if (kmInicialEfetivo === null || kmInicialEfetivo === undefined) {
        return res.status(422).json({ message: 'Informe o KM inicial para finalizar.' });
      }
      if (kmFinal <= Number(kmInicialEfetivo)) {
        return res.status(422).json({ message: 'KM final deve ser maior que o KM inicial.' });
      }
      updatePayload.km_final = kmFinal;
    } else if (temKmIni) {
      // KM inicial enviado isolado (sem km_final): valida e salva, mas não finaliza com média.
      const kmIni = Number(kmIniBody);
      if (!Number.isFinite(kmIni) || kmIni <= 0) {
        return res.status(422).json({ message: 'KM inicial inválido.' });
      }
      updatePayload.km_inicial = kmIni;
    }

    const { data, error } = await supabase
      .from('fretes')
      .update(updatePayload)
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
    const isSuperAdmin = req.user.is_super_admin === true;
    const isAdmin = req.user.role === 'admin';

    // Cancelar = marcar status 'cancelado' (nunca delete físico). Antes, verifica ownership
    // por perfil (espelha exports.finalizar):
    //  - super-admin: sempre pode
    //  - admin de empresa: só fretes da própria empresa (isolamento multi-tenant)
    //  - motorista: só o próprio frete
    const { data: frete, error: freteError } = await supabase
      .from('fretes')
      .select('id, motorista_id, empresa_id')
      .eq('id', id)
      .single();

    if (freteError || !frete) return res.status(404).json({ message: 'Frete não encontrado.' });

    if (!isSuperAdmin) {
      if (isAdmin) {
        if (frete.empresa_id !== req.empresa_id) {
          return res.status(403).json({ message: 'Acesso negado.' });
        }
      } else if (frete.motorista_id !== req.user.uid) {
        return res.status(403).json({ message: 'Acesso negado.' });
      }
    }

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
