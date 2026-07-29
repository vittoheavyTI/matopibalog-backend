const crypto = require('crypto');
const supabase = require('../config/supabase');
const { buscarFreteComAcesso, ehAdmin } = require('./freteAcesso');

// ePOD — comprovacao de entrega digital (1 por frete). Espelha o padrao dos
// documentos fiscais: bucket PRIVADO + path por empresa/frete + signed URL.
// Evidencias (foto/canhoto/PDF) vivem no bucket `fretes-evidencias` (compartilhado
// com ocorrencias). GPS e assinatura sao opcionais (o app preenche depois).
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

const COLUNAS_EPOD =
  'id, frete_id, status, comprovado_em, recebido_por, observacao, latitude, longitude, assinatura_path, criado_por, validado_por, validado_em, motivo_rejeicao, created_at, updated_at';
const COLUNAS_EVIDENCIA = 'id, nome_arquivo, mime, tamanho_bytes, created_at';

// GET /fretes/:id/epod → comprovacao do frete (ou null) + evidencias.
exports.obter = async (req, res) => {
  const frete = await buscarFreteComAcesso(req, res);
  if (!frete) return;

  const { data: epod, error } = await supabase
    .from('frete_epod')
    .select(COLUNAS_EPOD)
    .eq('frete_id', frete.id)
    .maybeSingle();
  if (error) return res.status(500).json({ message: 'Erro ao carregar a comprovação de entrega.' });
  if (!epod) return res.json({ epod: null, evidencias: [] });

  const { data: evidencias, error: evidError } = await supabase
    .from('frete_epod_evidencias')
    .select(COLUNAS_EVIDENCIA)
    .eq('epod_id', epod.id)
    .order('created_at', { ascending: true });
  if (evidError) return res.status(500).json({ message: 'Erro ao carregar as evidências.' });
  res.json({ epod, evidencias: evidencias || [] });
};

// POST /fretes/:id/epod → registra a comprovacao (409 se ja existe).
exports.registrar = async (req, res) => {
  const frete = await buscarFreteComAcesso(req, res);
  if (!frete) return;

  const { data: existente, error: existeError } = await supabase
    .from('frete_epod')
    .select('id')
    .eq('frete_id', frete.id)
    .maybeSingle();
  if (existeError) return res.status(500).json({ message: 'Erro ao verificar a comprovação existente.' });
  if (existente) {
    return res.status(409).json({ message: 'Este frete já possui comprovação de entrega. Edite a existente.' });
  }

  const { recebido_por, observacao, latitude, longitude, comprovado_em } = req.body;
  const { data: inserido, error } = await supabase
    .from('frete_epod')
    .insert({
      id: crypto.randomUUID(),
      frete_id: frete.id,
      empresa_id: frete.empresa_id, // derivado do frete, nunca do body
      status: 'registrado',
      comprovado_em: comprovado_em || new Date().toISOString(),
      recebido_por: recebido_por ?? null,
      observacao: observacao ?? null,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      criado_por: req.user.uid,
    })
    .select(COLUNAS_EPOD)
    .single();
  if (error) {
    console.error('[freteEpod:registrar] Falha ao inserir', error.message);
    return res.status(500).json({ message: 'Erro ao registrar a comprovação de entrega.' });
  }
  res.status(201).json(inserido);
};

// PATCH /fretes/:id/epod → edita campos da comprovacao (nao muda status).
exports.atualizar = async (req, res) => {
  const frete = await buscarFreteComAcesso(req, res);
  if (!frete) return;

  const patch = { updated_at: new Date().toISOString() };
  for (const campo of ['recebido_por', 'observacao', 'latitude', 'longitude', 'comprovado_em']) {
    if (req.body[campo] !== undefined) patch[campo] = req.body[campo];
  }

  const { data, error } = await supabase
    .from('frete_epod')
    .update(patch)
    .eq('frete_id', frete.id)
    .select(COLUNAS_EPOD)
    .maybeSingle();
  if (error) return res.status(500).json({ message: 'Erro ao atualizar a comprovação.' });
  if (!data) return res.status(404).json({ message: 'Comprovação não encontrada. Registre primeiro.' });
  res.json(data);
};

// POST /fretes/:id/epod/validacao → admin aprova/rejeita a comprovacao.
exports.validar = async (req, res) => {
  if (!ehAdmin(req)) return res.status(403).json({ message: 'Apenas administradores podem validar a comprovação.' });
  const frete = await buscarFreteComAcesso(req, res);
  if (!frete) return;

  const { status, motivo_rejeicao } = req.body;
  const patch = {
    status,
    validado_por: req.user.uid,
    validado_em: new Date().toISOString(),
    motivo_rejeicao: status === 'rejeitado' ? (motivo_rejeicao ?? null) : null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('frete_epod')
    .update(patch)
    .eq('frete_id', frete.id)
    .select(COLUNAS_EPOD)
    .maybeSingle();
  if (error) return res.status(500).json({ message: 'Erro ao validar a comprovação.' });
  if (!data) return res.status(404).json({ message: 'Comprovação não encontrada. Registre primeiro.' });
  res.json(data);
};

// POST /fretes/:id/epod/evidencias → anexa foto/canhoto/PDF a comprovacao.
exports.uploadEvidencia = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Evidência não enviada.' });
  const extensao = EXTENSAO_POR_MIME[req.file.mimetype];
  if (!extensao) {
    return res.status(415).json({ message: 'Formato não permitido. Use PDF, XML ou imagem (JPEG, PNG, WebP).' });
  }

  const frete = await buscarFreteComAcesso(req, res);
  if (!frete) return;

  const { data: epod, error: epodError } = await supabase
    .from('frete_epod')
    .select('id')
    .eq('frete_id', frete.id)
    .maybeSingle();
  if (epodError) return res.status(500).json({ message: 'Erro ao localizar a comprovação.' });
  if (!epod) return res.status(404).json({ message: 'Registre a comprovação antes de anexar evidências.' });

  const { count, error: countError } = await supabase
    .from('frete_epod_evidencias')
    .select('id', { count: 'exact', head: true })
    .eq('epod_id', epod.id);
  if (countError) return res.status(500).json({ message: 'Erro ao verificar evidências existentes.' });
  if ((count || 0) >= MAX_EVIDENCIAS) {
    return res.status(409).json({ message: `Limite de ${MAX_EVIDENCIAS} evidências por comprovação atingido.` });
  }

  const evidId = crypto.randomUUID();
  const storagePath = `${frete.empresa_id}/fretes/${frete.id}/epod/${evidId}.${extensao}`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET_EVIDENCIAS)
    .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
  if (uploadError) {
    console.error('[freteEpod:uploadEvidencia] Falha no upload', {
      frete_id: frete.id, empresa_id: frete.empresa_id, erro: uploadError.message || String(uploadError),
    });
    return res.status(502).json({ message: 'Erro ao salvar a evidência.' });
  }

  const { data: inserido, error: insertError } = await supabase
    .from('frete_epod_evidencias')
    .insert({
      id: evidId,
      epod_id: epod.id,
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
    console.error('[freteEpod:uploadEvidencia] Falha ao inserir metadados', insertError.message);
    return res.status(500).json({ message: 'Erro ao registrar a evidência.' });
  }
  res.status(201).json(inserido);
};

// GET /fretes/:id/epod/evidencias/:evidId/url → signed URL curta (bucket privado).
exports.getEvidenciaUrl = async (req, res) => {
  const frete = await buscarFreteComAcesso(req, res);
  if (!frete) return;
  const { data: evid, error } = await supabase
    .from('frete_epod_evidencias')
    .select('id, storage_path')
    .eq('id', req.params.evidId)
    .eq('frete_id', frete.id) // a evidencia tem que pertencer ao frete acessado
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
