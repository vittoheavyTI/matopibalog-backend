const supabase = require('../config/supabase');
const path = require('path');
const notificacaoService = require('../services/notificacaoService');
const { resolverFreteParaLancamento } = require('../services/freteService');
const workflow = require('../services/lancamentoWorkflow');
const bus = require('../services/realtimeBus');
const { executarTransicao } = require('./lancamentoAcoesController');

const papelDe = (req) => (req.user && req.user.is_super_admin === true ? 'super_admin' : (req.user && req.user.role) || 'usuario');

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

    let query = supabase.from('abastecimentos').select('*, motoristas(usuarios(nome))');
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
    console.error('Erro ao listar abastecimentos:', error);
    res.status(500).json({ message: 'Erro ao listar abastecimentos.' });
  }
};

exports.create = async (req, res) => {
  const { litros, valor_total, quem_pagou, arla_litros, arla_valor, posto, observacao, frete_id, motorista_id, client_request_id } = req.body;
  const motorista_id_final = req.user.role === 'admin' ? (motorista_id || req.user.uid) : req.user.uid;

  // E1.6A: observação obrigatória só para cliente NOVO (X-Client-Platform); legado passa.
  const obsCheck = workflow.exigeCampoContexto(req, observacao, 'observação');
  if (!obsCheck.ok) return res.status(400).json({ message: obsCheck.message });

  // Idempotência: reenvio da mesma tentativa (mesmo client_request_id) após
  // timeout não cancelado devolve o lançamento já criado, sem duplicar. Checado
  // ANTES do upload para não gerar arquivo órfão no Storage. Campo opcional.
  const clientRequestId = client_request_id || null;
  if (clientRequestId) {
    const { data: existente, error: dupError } = await supabase
      .from('abastecimentos')
      .select('*, motoristas(usuarios(nome))')
      .eq('motorista_id', motorista_id_final)
      .eq('client_request_id', clientRequestId)
      .maybeSingle();
    if (!dupError && existente) {
      return res.status(201).json({ ...existente, idempotent: true });
    }
  }

  // Trava antifraude: todo lançamento exige viagem aberta (vincula automaticamente se houver só uma)
  const freteResolvido = await resolverFreteParaLancamento(frete_id, motorista_id_final);
  if (!freteResolvido.ok) return res.status(freteResolvido.http).json({ message: freteResolvido.message });

  const file = req.file;

  // Foto opcional
  let publicUrl = null;
  if (file) {
    try {
      const fileName = `${motorista_id_final}/abastecimentos/${Date.now()}-${path.basename(file.originalname)}`;
      const { error: uploadError } = await supabase.storage
        .from('comprovantes')
        .upload(fileName, file.buffer, { contentType: file.mimetype, upsert: true });
      if (uploadError) {
        // Upload falhou: NÃO fabricar URL morta. Loga contexto e segue com foto_url = null.
        console.error('[abastecimentosController] Falha no upload do comprovante', {
          controller: 'abastecimentos',
          motorista_id: motorista_id_final,
          fileName,
          mimetype: file.mimetype,
          size: file.size,
          erro: uploadError.message || String(uploadError),
        });
      } else {
        const { data: { publicUrl: url } } = supabase.storage.from('comprovantes').getPublicUrl(fileName);
        publicUrl = url;
      }
    } catch (err) {
      // Exceção inesperada — não interrompe o lançamento; foto_url permanece null.
      console.error('[abastecimentosController] Exceção no upload do comprovante', {
        controller: 'abastecimentos',
        motorista_id: motorista_id_final,
        erro: err.message || String(err),
      });
    }
  }

  try {
    const { data: userData } = await supabase.from('usuarios').select('status, empresa_id, empresas!usuarios_empresa_id_fkey(tipo)').eq('id', motorista_id_final).single();
    if (!userData || userData.status === 'bloqueado') return res.status(403).json({ message: 'Motorista bloqueado. Entre em contato com o administrador.' });

    const isAutonomo = userData.empresas?.tipo === 'autonomo';
    const statusLancamento = (req.user.role === 'admin' || isAutonomo) ? 'aprovado' : 'pendente';

    const { data, error } = await supabase
      .from('abastecimentos')
      .insert({
        motorista_id: motorista_id_final, empresa_id: userData.empresa_id, frete_id: freteResolvido.freteId, litros: parseFloat(litros), valor_total: parseFloat(valor_total),
        quem_pagou, arla_litros: arla_litros ? parseFloat(arla_litros) : 0,
        arla_valor: arla_valor ? parseFloat(arla_valor) : 0,
        posto, observacao, foto_url: publicUrl,
        status: statusLancamento,
        created_by: req.user.uid,
        client_request_id: clientRequestId
      })
      .select().single();

    if (error) {
      console.error('[abastecimentosController:create] Erro ao inserir abastecimento:', error);
      throw error;
    }
    workflow.registrarCriacao({ entityType: 'abastecimento', row: data, actorId: req.user.uid, actorRole: papelDe(req), source: workflow.detectarOrigem(req) }).catch(() => {});
    notificacaoService.notificarLancamentoCriado(data, 'abastecimento').catch(() => {});
    // Lancamento criado pelo painel (admin): avisa tambem o motorista, que o
    // fluxo padrao (somenteAdmins / nasce aprovado) nao alcancava.
    if (req.user.role === 'admin') {
      notificacaoService.notificarLancamentoParaMotorista(data, 'abastecimento').catch(() => {});
    }
    res.status(201).json(data);
  } catch (error) {
    // Corrida concorrente: outro request com o mesmo client_request_id inseriu
    // primeiro (violação do índice único parcial → Postgres 23505). Devolve o
    // registro existente como reuso idempotente em vez de erro.
    if (clientRequestId && (error?.code === '23505' || String(error?.message || '').includes('23505'))) {
      const { data: existente } = await supabase
        .from('abastecimentos')
        .select('*, motoristas(usuarios(nome))')
        .eq('motorista_id', motorista_id_final)
        .eq('client_request_id', clientRequestId)
        .maybeSingle();
      if (existente) return res.status(201).json({ ...existente, idempotent: true });
    }
    console.error('[abastecimentosController:create] Erro:', error);
    res.status(500).json({ message: 'Erro ao registrar abastecimento.' });
  }
};

exports.getById = async (req, res) => {
  const { id } = req.params;
  try {
    const { data, error } = await supabase.from('abastecimentos').select('*, motoristas(usuarios(nome))').eq('id', id).single();
    if (error || !data) {
      return res.status(404).json({ message: 'Abastecimento não encontrado.' });
    }
    // Isolamento por tenant: super-admin acessa tudo; admin só a própria
    // empresa; motorista só os próprios lançamentos.
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
    res.status(500).json({ message: 'Erro ao buscar abastecimento.' });
  }
};

exports.update = async (req, res) => {
  const { id } = req.params;

  // Onda 1: SÓ transições audit-safe (aprovado/rejeitado/cancelado) → máquina de estados.
  // Status legados (ex.: 'finalizado' no fechamento; 'pendente' em undo) seguem direto.
  const TRANSICOES_AUDIT = new Set(['aprovado', 'rejeitado', 'cancelado']);
  if (req.body && req.body.status !== undefined && TRANSICOES_AUDIT.has(String(req.body.status))) {
    return executarTransicao(req, res, 'abastecimento', String(req.body.status));
  }

  const { posto, valor_total, litros, observacao, status, obs_resolucao } = req.body;
  try {
    const { data: checkData, error: checkError } = await supabase.from('abastecimentos').select('motorista_id, empresa_id, frete_id').eq('id', id).single();
    if (checkError || !checkData) {
      return res.status(404).json({ message: 'Abastecimento não encontrado.' });
    }
    // Isolamento por tenant: super-admin acessa tudo; admin só a própria
    // empresa; motorista só os próprios lançamentos.
    const isSuperAdmin = req.user.is_super_admin === true;
    if (!isSuperAdmin) {
      if (req.user.role === 'admin') {
        if (checkData.empresa_id !== req.empresa_id) {
          return res.status(403).json({ message: 'Acesso negado.' });
        }
      } else if (checkData.motorista_id !== req.user.uid) {
        return res.status(403).json({ message: 'Acesso negado.' });
      }
    }

    const updateData = { updated_at: new Date().toISOString() };
    if (posto !== undefined) updateData.posto = posto;
    if (valor_total !== undefined) updateData.valor_total = parseFloat(valor_total);
    if (litros !== undefined) updateData.litros = parseFloat(litros);
    if (observacao !== undefined) updateData.observacao = observacao;
    if (status !== undefined) updateData.status = status; // legado: finalizado/pendente
    if (obs_resolucao !== undefined) {
      updateData.obs_resolucao = obs_resolucao;
      updateData.resolvido_por = req.user.uid;
      updateData.resolvido_em = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('abastecimentos')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    try {
      bus.publish(workflow.construirEventoLancamento({
        type: 'launch.updated', empresaId: checkData.empresa_id, entityType: 'abastecimento',
        entityId: id, freteId: checkData.frete_id ?? null, version: data?.version ?? null,
      }));
    } catch (_) { /* best-effort */ }
    res.status(200).json(data);
  } catch (error) {
    console.error('[abastecimentosController.update] falha', {
      id: req.params.id,
      status: req.body && req.body.status,
      tem_obs: req.body && req.body.obs_resolucao !== undefined,
      user_id: req.user && req.user.uid,
      empresa_id: req.empresa_id,
      erro: (error && error.message) || String(error),
    });
    res.status(500).json({ message: 'Erro ao atualizar abastecimento.' });
  }
};
