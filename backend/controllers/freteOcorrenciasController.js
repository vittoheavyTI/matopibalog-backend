const crypto = require('crypto');
const supabase = require('../config/supabase');
const { buscarFreteComAcesso, negarSeNaoGerenciaFrete } = require('./freteAcesso');
const { TIPOS_OCORRENCIA, STATUS_OCORRENCIA } = require('../schemas/freteOcorrencias');
const notificacaoService = require('../services/notificacaoService');

// Ocorrencias logisticas (N por frete): atraso, avaria, recusa, reentrega,
// extravio, divergencia, outro. Evidencias no bucket privado compartilhado
// `fretes-evidencias`. Motorista/admin abrem e editam; so admin muda o status
// (em_analise/resolvida).
const BUCKET_EVIDENCIAS = 'fretes-evidencias';
const SIGNED_URL_TTL_SECONDS = 300;
const MAX_EVIDENCIAS = 10;

const EXTENSAO_POR_MIME = {
  'application/pdf': 'pdf',
  'text/xml': 'xml',
  'application/xml': 'xml',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const COLUNAS_OCORRENCIA =
  'id, frete_id, tipo, descricao, ocorrido_em, status, impacto, resolucao, resolvida_em, resolvida_por, criado_por, created_at, updated_at';
const COLUNAS_EVIDENCIA = 'id, nome_arquivo, mime, tamanho_bytes, created_at';

// Busca a ocorrencia garantindo que pertence ao frete acessado. Responde 404.
async function buscarOcorrenciaDoFrete(req, res, frete) {
  const { data: ocorrencia, error } = await supabase
    .from('frete_ocorrencias')
    .select('id, status')
    .eq('id', req.params.ocorrenciaId)
    .eq('frete_id', frete.id)
    .maybeSingle();
  if (error || !ocorrencia) {
    res.status(404).json({ message: 'Ocorrência não encontrada.' });
    return null;
  }
  return ocorrencia;
}

// GET /fretes/:id/ocorrencias?status=&tipo= → lista (mais recentes primeiro).
exports.listar = async (req, res) => {
  const frete = await buscarFreteComAcesso(req, res);
  if (!frete) return;

  let query = supabase
    .from('frete_ocorrencias')
    .select(COLUNAS_OCORRENCIA)
    .eq('frete_id', frete.id);

  const { status, tipo } = req.query;
  if (status && STATUS_OCORRENCIA.includes(status)) query = query.eq('status', status);
  if (tipo && TIPOS_OCORRENCIA.includes(tipo)) query = query.eq('tipo', tipo);

  const { data, error } = await query.order('ocorrido_em', { ascending: false });
  if (error) return res.status(500).json({ message: 'Erro ao listar as ocorrências.' });
  res.json(data || []);
};

// POST /fretes/:id/ocorrencias → abre uma ocorrencia.
exports.criar = async (req, res) => {
  const frete = await buscarFreteComAcesso(req, res);
  if (!frete) return;

  const { tipo, descricao, ocorrido_em, impacto } = req.body;
  const { data: inserido, error } = await supabase
    .from('frete_ocorrencias')
    .insert({
      id: crypto.randomUUID(),
      frete_id: frete.id,
      empresa_id: frete.empresa_id, // derivado do frete, nunca do body
      tipo,
      descricao,
      ocorrido_em: ocorrido_em || new Date().toISOString(),
      status: 'aberta',
      impacto: impacto ?? null,
      criado_por: req.user.uid,
    })
    .select(COLUNAS_OCORRENCIA)
    .single();
  if (error) {
    console.error('[freteOcorrencias:criar] Falha ao inserir', error.message);
    return res.status(500).json({ message: 'Erro ao registrar a ocorrência.' });
  }
  // Avisa os admins da empresa (menos quem criou). Best-effort.
  notificacaoService.notificarOcorrenciaCriada(frete, inserido.id, { actorId: req.user.uid }).catch(() => {});
  res.status(201).json(inserido);
};

// PATCH /fretes/:id/ocorrencias/:ocorrenciaId → edita campos e/ou anda o status.
// Mudanca de status (em_analise/resolvida) é so de admin.
exports.atualizar = async (req, res) => {
  const frete = await buscarFreteComAcesso(req, res);
  if (!frete) return;
  const ocorrencia = await buscarOcorrenciaDoFrete(req, res, frete);
  if (!ocorrencia) return;

  const mudaStatus = req.body.status !== undefined && req.body.status !== ocorrencia.status;
  if (mudaStatus && await negarSeNaoGerenciaFrete(req, res)) return;

  const patch = { updated_at: new Date().toISOString() };
  for (const campo of ['tipo', 'descricao', 'ocorrido_em', 'impacto', 'status', 'resolucao']) {
    if (req.body[campo] !== undefined) patch[campo] = req.body[campo];
  }
  // Carimba/limpa a resolucao conforme o status final.
  if (patch.status === 'resolvida') {
    patch.resolvida_em = new Date().toISOString();
    patch.resolvida_por = req.user.uid;
  } else if (patch.status === 'aberta' || patch.status === 'em_analise') {
    patch.resolvida_em = null;
    patch.resolvida_por = null;
  }

  const { data, error } = await supabase
    .from('frete_ocorrencias')
    .update(patch)
    .eq('id', ocorrencia.id)
    .select(COLUNAS_OCORRENCIA)
    .single();
  if (error) return res.status(500).json({ message: 'Erro ao atualizar a ocorrência.' });
  // Resolvida agora → avisa quem abriu a ocorrência (se não for o próprio admin). Best-effort.
  if (patch.status === 'resolvida' && ocorrencia.status !== 'resolvida') {
    notificacaoService.notificarOcorrenciaResolvida(frete, data, { actorId: req.user.uid }).catch(() => {});
  }
  res.json(data);
};

// POST /fretes/:id/ocorrencias/:ocorrenciaId/evidencias → anexa foto/PDF.
exports.uploadEvidencia = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Evidência não enviada.' });
  const extensao = EXTENSAO_POR_MIME[req.file.mimetype];
  if (!extensao) {
    return res.status(415).json({ message: 'Formato não permitido. Use PDF, XML ou imagem (JPEG, PNG, WebP).' });
  }

  const frete = await buscarFreteComAcesso(req, res);
  if (!frete) return;
  const ocorrencia = await buscarOcorrenciaDoFrete(req, res, frete);
  if (!ocorrencia) return;

  const { count, error: countError } = await supabase
    .from('frete_ocorrencia_evidencias')
    .select('id', { count: 'exact', head: true })
    .eq('ocorrencia_id', ocorrencia.id);
  if (countError) return res.status(500).json({ message: 'Erro ao verificar evidências existentes.' });
  if ((count || 0) >= MAX_EVIDENCIAS) {
    return res.status(409).json({ message: `Limite de ${MAX_EVIDENCIAS} evidências por ocorrência atingido.` });
  }

  const evidId = crypto.randomUUID();
  const storagePath = `${frete.empresa_id}/fretes/${frete.id}/ocorrencias/${ocorrencia.id}/${evidId}.${extensao}`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET_EVIDENCIAS)
    .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
  if (uploadError) {
    console.error('[freteOcorrencias:uploadEvidencia] Falha no upload', {
      frete_id: frete.id, ocorrencia_id: ocorrencia.id, erro: uploadError.message || String(uploadError),
    });
    return res.status(502).json({ message: 'Erro ao salvar a evidência.' });
  }

  const { data: inserido, error: insertError } = await supabase
    .from('frete_ocorrencia_evidencias')
    .insert({
      id: evidId,
      ocorrencia_id: ocorrencia.id,
      frete_id: frete.id,
      empresa_id: frete.empresa_id,
      storage_path: storagePath,
      nome_arquivo: req.file.originalname || null,
      mime: req.file.mimetype,
      tamanho_bytes: req.file.size,
      criado_por: req.user.uid,
    })
    .select(COLUNAS_EVIDENCIA)
    .single();
  if (insertError) {
    await supabase.storage.from(BUCKET_EVIDENCIAS).remove([storagePath]).catch(() => {});
    console.error('[freteOcorrencias:uploadEvidencia] Falha ao inserir metadados', insertError.message);
    return res.status(500).json({ message: 'Erro ao registrar a evidência.' });
  }
  res.status(201).json(inserido);
};

// GET /fretes/:id/ocorrencias/:ocorrenciaId/evidencias/:evidId/url → signed URL.
exports.getEvidenciaUrl = async (req, res) => {
  const frete = await buscarFreteComAcesso(req, res);
  if (!frete) return;
  const { data: evid, error } = await supabase
    .from('frete_ocorrencia_evidencias')
    .select('id, storage_path')
    .eq('id', req.params.evidId)
    .eq('ocorrencia_id', req.params.ocorrenciaId)
    .eq('frete_id', frete.id)
    .maybeSingle();
  if (error || !evid) return res.status(404).json({ message: 'Evidência não encontrada.' });

  const { data, error: urlError } = await supabase.storage
    .from(BUCKET_EVIDENCIAS)
    .createSignedUrl(evid.storage_path, SIGNED_URL_TTL_SECONDS);
  if (urlError) return res.status(500).json({ message: 'Erro ao gerar o link da evidência.' });
  res.json({ url: data?.signedUrl || data?.signedURL || null });
};

exports.BUCKET_EVIDENCIAS = BUCKET_EVIDENCIAS;
exports.MAX_EVIDENCIAS = MAX_EVIDENCIAS;
