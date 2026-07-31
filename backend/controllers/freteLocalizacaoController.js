const supabase = require('../config/supabase');
const { buscarFreteComAcesso } = require('./freteAcesso');

const STATUS_ATIVOS = new Set(['ativo', 'em_viagem', 'em_andamento']);
const STATUS_ENCERRADOS = new Set(['finalizado', 'cancelado']);
const ESTADOS_OPERACIONAIS = new Set([
  'aguardando_primeira',
  'atualizada',
  'interrompida',
  'gps_desativado',
  'permissao_nao_concedida',
  'sem_conexao',
  'rastreamento_encerrado',
]);
const MAX_HISTORICO = 200;
const MAX_FRETES_SESSAO = 4;

const sanitizarLocalizacao = (linha) => {
  if (!linha) return null;
  return {
    frete_id: linha.frete_id,
    motorista_id: linha.motorista_id,
    captured_at: linha.captured_at,
    received_at: linha.received_at,
    accuracy_m: linha.accuracy_m,
    source: linha.source,
    latitude: linha.latitude,
    longitude: linha.longitude,
  };
};

const sanitizarEstado = (linha) => {
  if (!linha) return null;
  return {
    frete_id: linha.frete_id,
    motorista_id: linha.motorista_id,
    estado: linha.estado,
    detalhe: linha.detalhe || null,
    atualizado_em: linha.atualizado_em,
    ultima_localizacao_em: linha.ultima_localizacao_em || null,
  };
};

const removerUltimaSeEncerrado = async (frete) => {
  if (!frete?.id || !STATUS_ENCERRADOS.has(String(frete.status || '').toLowerCase())) return;
  await supabase
    .from('frete_localizacao_retencao')
    .upsert({
      frete_id: frete.id,
      empresa_id: frete.empresa_id,
    }, { onConflict: 'frete_id', ignoreDuplicates: true });
  await supabase
    .from('frete_ultima_localizacao')
    .delete()
    .eq('frete_id', frete.id);
  await registrarEstadoFrete(frete, 'rastreamento_encerrado', {
    detalhe: 'Viagem encerrada. Localizacao ativa removida.',
  });
};

const dedupePonto = async ({ freteId, capturedAt }) => {
  const inicio = new Date(capturedAt);
  if (Number.isNaN(inicio.getTime())) return false;
  const janelaInicio = new Date(inicio.getTime() - 60 * 1000).toISOString();
  const janelaFim = new Date(inicio.getTime() + 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('frete_localizacoes')
    .select('id', { count: 'exact', head: true })
    .eq('frete_id', freteId)
    .gte('captured_at', janelaInicio)
    .lte('captured_at', janelaFim);
  if (error) throw error;
  return (count || 0) > 0;
};

const buscarFretesEmAndamentoDoMotorista = async (req) => {
  if (req.user?.role !== 'motorista' || !req.user?.uid || !req.empresa_id) {
    return [];
  }
  const { data, error } = await supabase
    .from('fretes')
    .select('id, empresa_id, motorista_id, status, data')
    .eq('empresa_id', req.empresa_id)
    .eq('motorista_id', req.user.uid)
    .in('status', Array.from(STATUS_ATIVOS))
    .order('data', { ascending: false })
    .limit(MAX_FRETES_SESSAO);
  if (error) throw error;
  return data || [];
};

const listarUltimasPorFrete = async (ids) => {
  if (!ids.length) return new Map();
  const { data, error } = await supabase
    .from('frete_ultima_localizacao')
    .select('frete_id, motorista_id, latitude, longitude, accuracy_m, captured_at, received_at, source')
    .in('frete_id', ids);
  if (error) throw error;
  return new Map((data || []).map((l) => [l.frete_id, l]));
};

const listarEstadosPorFrete = async (ids) => {
  if (!ids.length) return new Map();
  const { data, error } = await supabase
    .from('frete_localizacao_estado')
    .select('frete_id, motorista_id, estado, detalhe, atualizado_em, ultima_localizacao_em')
    .in('frete_id', ids);
  if (error) throw error;
  return new Map((data || []).map((l) => [l.frete_id, l]));
};

async function registrarEstadoFrete(frete, estado, opcoes = {}) {
  if (!frete?.id || !ESTADOS_OPERACIONAIS.has(estado)) return null;
  const payload = {
    frete_id: frete.id,
    empresa_id: frete.empresa_id,
    motorista_id: frete.motorista_id,
    estado,
    detalhe: opcoes.detalhe || null,
    atualizado_em: new Date().toISOString(),
    ultima_localizacao_em: opcoes.ultimaLocalizacaoEm || null,
  };
  const { data, error } = await supabase
    .from('frete_localizacao_estado')
    .upsert(payload, { onConflict: 'frete_id' })
    .select('frete_id, motorista_id, estado, detalhe, atualizado_em, ultima_localizacao_em')
    .single();
  if (error) throw error;
  return data;
}

const gravarPontoNoFrete = async (frete, body) => {
  const payload = {
    empresa_id: frete.empresa_id,
    frete_id: frete.id,
    motorista_id: frete.motorista_id,
    latitude: body.latitude,
    longitude: body.longitude,
    accuracy_m: body.accuracy_m ?? null,
    captured_at: body.captured_at,
    source: body.source || 'app_foreground_service',
  };

  const jaExiste = await dedupePonto({ freteId: frete.id, capturedAt: payload.captured_at });
  if (!jaExiste) {
    const { error: insertError } = await supabase
      .from('frete_localizacoes')
      .insert(payload);
    if (insertError) throw insertError;
  }

  const { data: ultima, error: upsertError } = await supabase
    .from('frete_ultima_localizacao')
    .upsert(payload, { onConflict: 'frete_id' })
    .select('frete_id, motorista_id, latitude, longitude, accuracy_m, captured_at, received_at, source')
    .single();
  if (upsertError) throw upsertError;

  await registrarEstadoFrete(frete, 'atualizada', {
    ultimaLocalizacaoEm: payload.captured_at,
  });

  return { ultima, deduplicado: jaExiste };
};

exports.obterSessao = async (req, res) => {
  try {
    if (req.user.role !== 'motorista') {
      return res.status(403).json({ message: 'Sessao de localizacao disponivel somente para motorista autenticado.' });
    }

    const fretes = await buscarFretesEmAndamentoDoMotorista(req);
    const ids = fretes.map((f) => f.id);
    const [ultimas, estados] = await Promise.all([
      listarUltimasPorFrete(ids),
      listarEstadosPorFrete(ids),
    ]);

    return res.status(200).json({
      ativa: fretes.length > 0,
      total_fretes_em_andamento: fretes.length,
      fretes: fretes.map((frete) => ({
        frete_id: frete.id,
        status: frete.status,
        ultima: sanitizarLocalizacao(ultimas.get(frete.id)),
        estado: sanitizarEstado(estados.get(frete.id)),
      })),
    });
  } catch (error) {
    console.error('[freteLocalizacao:obterSessao] Falha ao consultar sessao', {
      user: req.user?.uid,
      status: error?.code || error?.message || 'erro',
    });
    return res.status(500).json({ message: 'Erro ao consultar sessao de localizacao.' });
  }
};

exports.registrarSessao = async (req, res) => {
  try {
    if (req.user.role !== 'motorista') {
      return res.status(403).json({ message: 'Apenas o motorista autenticado pode enviar localizacao da viagem.' });
    }

    const fretes = await buscarFretesEmAndamentoDoMotorista(req);
    if (!fretes.length) {
      return res.status(409).json({ message: 'Compartilhamento pausado: nao ha viagem em andamento.' });
    }

    const resultados = [];
    for (const frete of fretes) {
      const resultado = await gravarPontoNoFrete(frete, req.body);
      resultados.push({
        frete_id: frete.id,
        ultima: sanitizarLocalizacao(resultado.ultima),
        deduplicado: resultado.deduplicado,
      });
    }

    return res.status(201).json({
      ok: true,
      fretes_atualizados: resultados.length,
      resultados,
    });
  } catch (error) {
    console.error('[freteLocalizacao:registrarSessao] Falha ao registrar localizacao', {
      user: req.user?.uid,
      status: error?.code || error?.message || 'erro',
    });
    return res.status(500).json({ message: 'Erro ao registrar localizacao da viagem.' });
  }
};

exports.registrarEstadoSessao = async (req, res) => {
  try {
    if (req.user.role !== 'motorista') {
      return res.status(403).json({ message: 'Apenas o motorista autenticado pode atualizar o estado da localizacao.' });
    }

    const estado = req.body.estado;
    if (!ESTADOS_OPERACIONAIS.has(estado) || estado === 'atualizada' || estado === 'rastreamento_encerrado') {
      return res.status(400).json({ message: 'Estado de localizacao invalido.' });
    }

    const fretes = await buscarFretesEmAndamentoDoMotorista(req);
    if (!fretes.length) {
      return res.status(200).json({ ok: true, fretes_atualizados: 0, ativa: false });
    }

    const estados = [];
    for (const frete of fretes) {
      const linha = await registrarEstadoFrete(frete, estado, {
        detalhe: req.body.detalhe || null,
      });
      estados.push(sanitizarEstado(linha));
    }

    return res.status(200).json({ ok: true, ativa: true, fretes_atualizados: estados.length, estados });
  } catch (error) {
    console.error('[freteLocalizacao:registrarEstadoSessao] Falha ao registrar estado', {
      user: req.user?.uid,
      estado: req.body?.estado,
      status: error?.code || error?.message || 'erro',
    });
    return res.status(500).json({ message: 'Erro ao atualizar estado da localizacao.' });
  }
};

exports.registrar = async (req, res) => {
  try {
    const frete = await buscarFreteComAcesso(req, res);
    if (!frete) return null;

    if (req.user.role !== 'motorista' || frete.motorista_id !== req.user.uid) {
      return res.status(403).json({ message: 'Apenas o motorista vinculado pode enviar localizacao da viagem.' });
    }

    const status = String(frete.status || '').toLowerCase();
    if (!STATUS_ATIVOS.has(status)) {
      await removerUltimaSeEncerrado(frete);
      return res.status(409).json({ message: 'Compartilhamento pausado: viagem sem status ativo.' });
    }

    const resultado = await gravarPontoNoFrete(frete, req.body);
    return res.status(201).json({
      ok: true,
      ultima: sanitizarLocalizacao(resultado.ultima),
      deduplicado: resultado.deduplicado,
    });
  } catch (error) {
    console.error('[freteLocalizacao:registrar] Falha ao registrar localizacao', {
      frete_id: req.params.id,
      user: req.user?.uid,
      status: error?.code || error?.message || 'erro',
    });
    return res.status(500).json({ message: 'Erro ao registrar localizacao da viagem.' });
  }
};

exports.obter = async (req, res) => {
  try {
    const frete = await buscarFreteComAcesso(req, res);
    if (!frete) return null;

    const status = String(frete.status || '').toLowerCase();
    if (STATUS_ENCERRADOS.has(status)) {
      await removerUltimaSeEncerrado(frete);
      const { data: historico, error: histError } = await supabase
        .from('frete_localizacoes')
        .select('frete_id, motorista_id, latitude, longitude, accuracy_m, captured_at, received_at, source')
        .eq('frete_id', frete.id)
        .order('captured_at', { ascending: false })
        .limit(MAX_HISTORICO);
      if (histError) throw histError;
      return res.status(200).json({
        ativa: false,
        ultima: null,
        estado: { estado: 'rastreamento_encerrado', rotulo: 'Rastreamento encerrado' },
        historico: (historico || []).map(sanitizarLocalizacao),
      });
    }

    const [{ data: ultima, error: ultimaError }, { data: estado, error: estadoError }] = await Promise.all([
      supabase
        .from('frete_ultima_localizacao')
        .select('frete_id, motorista_id, latitude, longitude, accuracy_m, captured_at, received_at, source')
        .eq('frete_id', frete.id)
        .maybeSingle(),
      supabase
        .from('frete_localizacao_estado')
        .select('frete_id, motorista_id, estado, detalhe, atualizado_em, ultima_localizacao_em')
        .eq('frete_id', frete.id)
        .maybeSingle(),
    ]);
    if (ultimaError) throw ultimaError;
    if (estadoError) throw estadoError;

    return res.status(200).json({
      ativa: STATUS_ATIVOS.has(status),
      ultima: sanitizarLocalizacao(ultima),
      estado: sanitizarEstado(estado),
      historico: [],
    });
  } catch (error) {
    console.error('[freteLocalizacao:obter] Falha ao consultar localizacao', {
      frete_id: req.params.id,
      user: req.user?.uid,
      status: error?.code || error?.message || 'erro',
    });
    return res.status(500).json({ message: 'Erro ao consultar localizacao da viagem.' });
  }
};

exports.limparVencidas = async (_req, res) => {
  try {
    const { data, error } = await supabase.rpc('purge_frete_localizacoes_vencidas');
    if (error) throw error;
    return res.status(200).json({ removidas: data || 0 });
  } catch (error) {
    console.error('[freteLocalizacao:limparVencidas] Falha na retencao', error?.message || error);
    return res.status(500).json({ message: 'Erro ao limpar historico vencido.' });
  }
};
