const supabase = require('../config/supabase');
const path = require('path');
const notificacaoService = require('../services/notificacaoService');

exports.getAll = async (req, res) => {
  const { tipo, data_inicio, data_fim, frete_id, motorista_id } = req.query;
  const isAdmin = req.user.role === 'admin';

  try {
    let query = supabase.from('despesas').select('*, motoristas(usuarios(nome))');

    if (isAdmin && motorista_id) {
      query = query.eq('motorista_id', motorista_id);
    } else if (!isAdmin) {
      query = query.eq('motorista_id', req.user.uid);
    }

    if (tipo) query = query.eq('tipo', tipo);
    if (frete_id) query = query.eq('frete_id', frete_id);
    if (data_inicio) query = query.gte('data', data_inicio);
    if (data_fim) query = query.lte('data', data_fim);

    const { data, error } = await query.order('data', { ascending: false });
    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao listar despesas.' });
  }
};

exports.create = async (req, res) => {
  const { tipo, descricao, valor, quem_pagou, frete_id } = req.body;

  // Admin pode lançar para qualquer motorista; motorista usa seu próprio uid
  const motorista_id = req.user.role === 'admin'
    ? (req.body.motorista_id || req.user.uid)
    : req.user.uid;

  const file = req.file;

  // Upload do comprovante (opcional)
  let publicUrl = null;
  if (file) {
    try {
      const fileName = `${motorista_id}/despesas/${Date.now()}-${path.basename(file.originalname)}`;
      const { error: uploadError } = await supabase.storage
        .from('comprovantes')
        .upload(fileName, file.buffer, { contentType: file.mimetype, upsert: true });
      if (uploadError) {
        // Upload falhou: NÃO fabricar URL morta. Loga contexto e segue com foto_url = null.
        console.error('[despesasController] Falha no upload do comprovante', {
          controller: 'despesas',
          motorista_id,
          fileName,
          mimetype: file.mimetype,
          size: file.size,
          erro: uploadError.message || String(uploadError),
        });
      } else {
        const { data: urlData } = supabase.storage.from('comprovantes').getPublicUrl(fileName);
        publicUrl = urlData.publicUrl;
      }
    } catch (uploadError) {
      // Exceção inesperada — não interrompe o lançamento; foto_url permanece null.
      console.error('[despesasController] Exceção no upload do comprovante', {
        controller: 'despesas',
        motorista_id,
        erro: uploadError.message || String(uploadError),
      });
    }
  }

  try {
    // Validar status do motorista e obter tipo da empresa
    const { data: userData, error: userError } = await supabase
      .from('usuarios')
      .select('status, empresa_id, empresas(tipo)')
      .eq('id', motorista_id)
      .single();

    if (userError || !userData) {
      return res.status(404).json({ message: 'Motorista não encontrado.' });
    }

    if (!userData || userData.status === 'bloqueado') {
      return res.status(403).json({ message: 'Motorista bloqueado. Entre em contato com o administrador.' });
    }

    // Autônomo é dono dos próprios dados — lançamentos nascem aprovados
    const isAutonomo = userData.empresas?.tipo === 'autonomo';
    const statusLancamento = (req.user.role === 'admin' || isAutonomo) ? 'aprovado' : 'pendente';

    // Gravar no banco
    const { data, error } = await supabase
      .from('despesas')
      .insert({
        motorista_id,
        empresa_id: userData.empresa_id,
        frete_id,
        tipo: tipo || 'geral',
        descricao,
        valor: parseFloat(valor),
        quem_pagou,
        foto_url: publicUrl,
        status: statusLancamento,
        sincronizado: true
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error('Erro ao registrar despesa:', error);
    res.status(500).json({ message: 'Erro ao registrar despesa.' });
  }
};

exports.getById = async (req, res) => {
  const { id } = req.params;
  try {
    const { data, error } = await supabase
      .from('despesas')
      .select('*, motoristas(usuarios(nome))')
      .eq('id', id)
      .single();

    if (error) throw error;
    if (req.user.role !== 'admin' && data.motorista_id !== req.user.uid) {
      return res.status(403).json({ message: 'Acesso negado.' });
    }
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar despesa.' });
  }
};

exports.update = async (req, res) => {
  const { id } = req.params;
  const { descricao, valor, status, tipo, obs_resolucao } = req.body;

  try {
    const { data: checkData, error: checkError } = await supabase
      .from('despesas')
      .select('motorista_id')
      .eq('id', id)
      .single();

    if (checkError || !checkData) {
      return res.status(404).json({ message: 'Despesa não encontrada.' });
    }

    if (req.user.role !== 'admin' && checkData.motorista_id !== req.user.uid) {
      return res.status(403).json({ message: 'Acesso negado.' });
    }

    // Apenas campos explicitamente permitidos
    const updateData = {};
    if (descricao !== undefined) updateData.descricao = descricao;
    if (valor !== undefined) updateData.valor = parseFloat(valor);
    if (status !== undefined) updateData.status = status;
    if (tipo !== undefined) updateData.tipo = tipo;
    if (obs_resolucao !== undefined) {
      updateData.obs_resolucao = obs_resolucao;
      updateData.resolvido_por = req.user.uid;
      updateData.resolvido_em = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('despesas')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (status && (status === 'aprovado' || status === 'rejeitado') && data) {
      notificacaoService.notificarLancamentoResolvido(data, 'despesa', status === 'aprovado')
        .catch((err) => console.error('[despesasController] Falha ao notificar lançamento resolvido', { tipo: 'despesa', id: data?.id, erro: err?.message || err }));
    }
    res.status(200).json(data);
  } catch (error) {
    console.error('[despesasController.update] falha', {
      id: req.params.id,
      status: req.body && req.body.status,
      tem_obs: req.body && req.body.obs_resolucao !== undefined,
      user_id: req.user && req.user.uid,
      empresa_id: req.empresa_id,
      erro: (error && error.message) || String(error),
    });
    res.status(500).json({ message: 'Erro ao atualizar despesa.' });
  }
};
