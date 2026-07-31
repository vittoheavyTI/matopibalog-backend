const supabase = require('../config/supabase');
const { buscarFreteComAcesso } = require('./freteAcesso');

const STATUS_ATIVOS = new Set(['ativo', 'em_viagem', 'em_andamento']);
const STATUS_ENCERRADOS = new Set(['finalizado', 'cancelado']);
const MAX_HISTORICO = 200;

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

    const payload = {
      empresa_id: frete.empresa_id,
      frete_id: frete.id,
      motorista_id: frete.motorista_id,
      latitude: req.body.latitude,
      longitude: req.body.longitude,
      accuracy_m: req.body.accuracy_m ?? null,
      captured_at: req.body.captured_at,
      source: req.body.source || 'app_foreground_service',
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

    return res.status(201).json({ ok: true, ultima: sanitizarLocalizacao(ultima), deduplicado: jaExiste });
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
      return res.status(200).json({ ativa: false, ultima: null, historico: (historico || []).map(sanitizarLocalizacao) });
    }

    const { data: ultima, error: ultimaError } = await supabase
      .from('frete_ultima_localizacao')
      .select('frete_id, motorista_id, latitude, longitude, accuracy_m, captured_at, received_at, source')
      .eq('frete_id', frete.id)
      .maybeSingle();
    if (ultimaError) throw ultimaError;

    return res.status(200).json({ ativa: STATUS_ATIVOS.has(status), ultima: sanitizarLocalizacao(ultima), historico: [] });
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
