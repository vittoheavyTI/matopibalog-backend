const supabase = require('../config/supabase');
const path = require('path');
const notificacaoService = require('../services/notificacaoService');

exports.getAll = async (req, res) => {
  const { motorista_id, frete_id } = req.query;
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

    let query = supabase.from('vales').select('*, motoristas(usuarios(nome))');
    if (idsPermitidos !== null) {
      query = query.in('motorista_id', idsPermitidos.length ? idsPermitidos : ['']);
    }
    if (isAdmin && motorista_id) {
      query = query.eq('motorista_id', motorista_id);
    }
    if (frete_id) query = query.eq('frete_id', frete_id);

    const { data, error } = await query.order('data', { ascending: false });
    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    console.error('Erro ao listar vales:', error);
    res.status(500).json({ message: 'Erro ao listar vales.' });
  }
};

exports.create = async (req, res) => {
  const { valor, quem_pagou, posto, litros, frete_id, motorista_id } = req.body;
  const motorista_id_final = req.user.role === 'admin' ? (motorista_id || req.user.uid) : req.user.uid;
  const file = req.file;

  // Foto opcional
  let publicUrl = null;
  if (file) {
    try {
      const fileName = `${motorista_id_final}/vales/${Date.now()}-${path.basename(file.originalname)}`;
      await supabase.storage.from('comprovantes').upload(fileName, file.buffer, { contentType: file.mimetype });
      const { data: { publicUrl: url } } = supabase.storage.from('comprovantes').getPublicUrl(fileName);
      publicUrl = url;
    } catch (err) {
      console.error('Upload failed:', err);
    }
  }

  try {
    const { data: userData } = await supabase.from('usuarios').select('status, empresa_id').eq('id', motorista_id_final).single();
    if (!userData || userData.status === 'bloqueado') return res.status(403).json({ message: 'Motorista bloqueado. Entre em contato com o administrador.' });

    const { data, error } = await supabase
      .from('vales')
      .insert({
        motorista_id: motorista_id_final, empresa_id: userData.empresa_id, frete_id, valor: parseFloat(valor),
        quem_pagou, posto, litros: litros ? parseFloat(litros) : 0,
        foto_url: publicUrl,
        status: req.user.role === 'admin' ? 'aprovado' : 'pendente'
      })
      .select().single();

    if (error) {
      console.error('[valesController:create] Erro ao inserir vale:', error);
      throw error;
    }
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao registrar vale.' });
  }
};

exports.getById = async (req, res) => {
  const { id } = req.params;
  try {
    const { data, error } = await supabase.from('vales').select('*, motoristas(usuarios(nome))').eq('id', id).single();
    if (error) throw error;
    if (req.user.role !== 'admin' && data.motorista_id !== req.user.uid) return res.status(403).json({ message: 'Acesso negado.' });
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar vale.' });
  }
};

exports.update = async (req, res) => {
  const { id } = req.params;
  const { valor, status, posto, litros, obs_resolucao } = req.body;

  try {
    const { data: checkData } = await supabase.from('vales').select('motorista_id').eq('id', id).single();
    if (req.user.role !== 'admin' && checkData.motorista_id !== req.user.uid) {
      return res.status(403).json({ message: 'Acesso negado.' });
    }

    const updateData = {};
    if (valor !== undefined) updateData.valor = parseFloat(valor);
    if (status !== undefined) updateData.status = status;
    if (obs_resolucao !== undefined) {
      updateData.obs_resolucao = obs_resolucao;
      updateData.resolvido_por = req.user.uid;
      updateData.resolvido_em = new Date().toISOString();
    }
    if (posto !== undefined) updateData.posto = posto;
    if (litros !== undefined) updateData.litros = parseFloat(litros);

    const { data, error } = await supabase
      .from('vales')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (status && (status === 'aprovado' || status === 'rejeitado') && data) {
      notificacaoService.notificarLancamentoResolvido(data, 'vale', status === 'aprovado')
        .catch((err) => console.error('[valesController] Falha ao notificar lançamento resolvido', { tipo: 'vale', id: data?.id, erro: err?.message || err }));
    }
    res.status(200).json(data);
  } catch (error) {
    console.error('[valesController.update] falha', {
      id: req.params.id,
      status: req.body && req.body.status,
      tem_obs: req.body && req.body.obs_resolucao !== undefined,
      user_id: req.user && req.user.uid,
      empresa_id: req.empresa_id,
      erro: (error && error.message) || String(error),
    });
    res.status(500).json({ message: 'Erro ao atualizar vale.' });
  }
};
