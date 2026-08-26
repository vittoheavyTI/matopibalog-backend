const crypto = require('crypto');
const supabase = require('../config/supabase');
const { buscarFreteComAcesso, negarSeNaoGerenciaFrete } = require('./freteAcesso');
const notificacaoService = require('../services/notificacaoService');

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
const COLUNAS_EVIDENCIA =
  'id, nome_arquivo, mime, tamanho_bytes, status, client_request_id, validado_por, validado_em, rejeitado_por, rejeitado_em, motivo_rejeicao, created_at';

const normalizarClientRequestId = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s && /^[A-Za-z0-9._:-]{8,120}$/.test(s) ? s : null;
};

// Status GERAL do ePOD DERIVADO das evidências (PURO — testável).
// Regras (macrofrente ePOD v2 — a evidência rejeitada PERMANECE no histórico,
// com motivo/responsável/timestamps, mas é considerada SUPERADA para o status
// geral quando já existe aprovação e nada mais está pendente):
//   • validado:   há ≥1 aprovada e NENHUMA pendente (rejeitadas históricas não bloqueiam);
//   • parcial:    há ≥1 aprovada e ainda há evidência pendente;
//   • rejeitado:  todas rejeitadas (sem nenhuma aprovada nem pendente);
//   • registrado: sem evidência, ou não há aprovada e o fluxo ainda está pendente/inicial.
function derivarStatusEpod(evidencias) {
  const n = (evidencias || []).length;
  if (n === 0) return 'registrado';
  const aprovadas = evidencias.filter((e) => e.status === 'aprovada').length;
  const pendentes = evidencias.filter((e) => e.status === 'pendente').length;
  const rejeitadas = evidencias.filter((e) => e.status === 'rejeitada').length;
  if (aprovadas >= 1 && pendentes === 0) return 'validado';   // rejeitadas não bloqueiam
  if (aprovadas >= 1) return 'parcial';                       // ≥1 aprovada e ainda há pendente
  if (rejeitadas === n) return 'rejeitado';                   // todas rejeitadas, sem aprovada/pendente
  return 'registrado';                                        // sem aprovada e ainda pendente/inicial
}

// Recalcula e persiste o status do ePOD a partir das evidências. Best-effort:
// devolve o novo status (ou null em falha) sem quebrar o fluxo do chamador.
async function recomputarStatusEpod(epodId) {
  const { data: evs, error } = await supabase
    .from('frete_epod_evidencias')
    .select('status')
    .eq('epod_id', epodId);
  if (error) return null;
  const novo = derivarStatusEpod(evs || []);
  await supabase
    .from('frete_epod')
    .update({ status: novo, updated_at: new Date().toISOString() })
    .eq('id', epodId);
  return novo;
}

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

// Busca o ePOD do frete (id). Responde 404 e retorna null quando não existe.
async function buscarEpodDoFrete(res, freteId) {
  const { data: epod, error } = await supabase
    .from('frete_epod')
    .select('id')
    .eq('frete_id', freteId)
    .maybeSingle();
  if (error) { res.status(500).json({ message: 'Erro ao localizar a comprovação.' }); return null; }
  if (!epod) { res.status(404).json({ message: 'Comprovação não encontrada. Registre primeiro.' }); return null; }
  return epod;
}

// POST /fretes/:id/epod/evidencias/:evidId/validacao → admin aprova/rejeita UMA
// evidência. Recalcula o status geral e avisa o motorista.
exports.validarEvidencia = async (req, res) => {
  if (await negarSeNaoGerenciaFrete(req, res)) return;
  const frete = await buscarFreteComAcesso(req, res);
  if (!frete) return;

  const { status, motivo_rejeicao } = req.body; // 'aprovada' | 'rejeitada'
  const agora = new Date().toISOString();
  const patch = status === 'aprovada'
    ? { status, validado_por: req.user.uid, validado_em: agora, rejeitado_por: null, rejeitado_em: null, motivo_rejeicao: null }
    : { status, rejeitado_por: req.user.uid, rejeitado_em: agora, motivo_rejeicao: motivo_rejeicao ?? null, validado_por: null, validado_em: null };

  const { data: evid, error } = await supabase
    .from('frete_epod_evidencias')
    .update(patch)
    .eq('id', req.params.evidId)
    .eq('frete_id', frete.id) // a evidência tem que pertencer ao frete acessado
    .select('id, epod_id')
    .maybeSingle();
  if (error) return res.status(500).json({ message: 'Erro ao validar a evidência.' });
  if (!evid) return res.status(404).json({ message: 'Evidência não encontrada.' });

  const statusGeral = await recomputarStatusEpod(evid.epod_id);

  // Avisa o motorista (best-effort).
  if (status === 'aprovada') {
    notificacaoService.notificarEpodEvidenciaAprovada(frete, evid.id).catch(() => {});
  } else {
    notificacaoService.notificarEpodEvidenciaRejeitada(frete, evid.id, motivo_rejeicao).catch(() => {});
  }
  res.json({ evidencia_id: evid.id, status, status_geral: statusGeral });
};

// POST /fretes/:id/epod/rejeitar → admin rejeita a COMPROVAÇÃO inteira: marca
// todas as evidências não-rejeitadas como rejeitadas (com motivo) e grava o
// motivo no ePOD. Recalcula (→ rejeitado) e avisa o motorista.
exports.rejeitarComprovacao = async (req, res) => {
  if (await negarSeNaoGerenciaFrete(req, res)) return;
  const frete = await buscarFreteComAcesso(req, res);
  if (!frete) return;
  const epod = await buscarEpodDoFrete(res, frete.id);
  if (!epod) return;

  const agora = new Date().toISOString();
  const { motivo_rejeicao } = req.body;

  const { error: evidErr } = await supabase
    .from('frete_epod_evidencias')
    .update({ status: 'rejeitada', rejeitado_por: req.user.uid, rejeitado_em: agora, motivo_rejeicao })
    .eq('epod_id', epod.id)
    .neq('status', 'rejeitada');
  if (evidErr) return res.status(500).json({ message: 'Erro ao rejeitar as evidências.' });

  await supabase
    .from('frete_epod')
    .update({ motivo_rejeicao, updated_at: agora })
    .eq('id', epod.id);

  const statusGeral = await recomputarStatusEpod(epod.id);
  notificacaoService.notificarEpodEvidenciaRejeitada(frete, `epod:${epod.id}`, motivo_rejeicao).catch(() => {});
  res.json({ epod_id: epod.id, status_geral: statusGeral });
};

// POST /fretes/:id/epod/aprovar-pendentes → atalho: admin aprova TODAS as
// evidências pendentes de uma vez. Recalcula e avisa o motorista.
exports.aprovarPendentes = async (req, res) => {
  if (await negarSeNaoGerenciaFrete(req, res)) return;
  const frete = await buscarFreteComAcesso(req, res);
  if (!frete) return;
  const epod = await buscarEpodDoFrete(res, frete.id);
  if (!epod) return;

  const agora = new Date().toISOString();
  const { data: aprovadas, error } = await supabase
    .from('frete_epod_evidencias')
    .update({ status: 'aprovada', validado_por: req.user.uid, validado_em: agora, rejeitado_por: null, rejeitado_em: null, motivo_rejeicao: null })
    .eq('epod_id', epod.id)
    .eq('status', 'pendente')
    .select('id');
  if (error) return res.status(500).json({ message: 'Erro ao aprovar as evidências pendentes.' });

  const statusGeral = await recomputarStatusEpod(epod.id);
  if ((aprovadas || []).length > 0) {
    notificacaoService.notificarEpodEvidenciaAprovada(frete, `epod:${epod.id}`).catch(() => {});
  }
  res.json({ epod_id: epod.id, aprovadas: (aprovadas || []).length, status_geral: statusGeral });
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

  const clientRequestId = normalizarClientRequestId(req.body?.client_request_id);
  if (clientRequestId) {
    const { data: existente, error: idemError } = await supabase
      .from('frete_epod_evidencias')
      .select(COLUNAS_EVIDENCIA)
      .eq('epod_id', epod.id)
      .eq('criado_por', req.user.uid)
      .eq('client_request_id', clientRequestId)
      .maybeSingle();
    if (idemError) return res.status(500).json({ message: 'Erro ao verificar idempotência da evidência.' });
    if (existente) return res.status(200).json({ ...existente, idempotent: true });
  }

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
      client_request_id: clientRequestId,
    })
    .select(COLUNAS_EVIDENCIA)
    .single();
  if (insertError) {
    await supabase.storage.from(BUCKET_EVIDENCIAS).remove([storagePath]).catch(() => {});
    if (insertError.code === '23505' && clientRequestId) {
      const { data: existente } = await supabase
        .from('frete_epod_evidencias')
        .select(COLUNAS_EVIDENCIA)
        .eq('epod_id', epod.id)
        .eq('criado_por', req.user.uid)
        .eq('client_request_id', clientRequestId)
        .maybeSingle();
      if (existente) return res.status(200).json({ ...existente, idempotent: true });
    }
    console.error('[freteEpod:uploadEvidencia] Falha ao inserir metadados', insertError.message);
    return res.status(500).json({ message: 'Erro ao registrar a evidência.' });
  }

  // Nova evidência = pendente → recalcula o status geral (ex.: validado→parcial)
  // e avisa os admins que há algo a validar. Best-effort: não quebra o upload.
  await recomputarStatusEpod(epod.id).catch(() => {});
  notificacaoService
    .notificarEpodEvidenciaEnviada(frete, evidId, { actorId: req.user.uid })
    .catch(() => {});

  res.status(201).json(inserido);
};

// GET /fretes/:id/epod/evidencias/:evidId/url → signed URL curta (bucket privado).
exports.getEvidenciaUrl = async (req, res) => {
  const frete = await buscarFreteComAcesso(req, res);
  if (!frete) return;
  const { data: evid, error } = await supabase
    .from('frete_epod_evidencias')
    .select('id, storage_path, mime, nome_arquivo')
    .eq('id', req.params.evidId)
    .eq('frete_id', frete.id) // a evidencia tem que pertencer ao frete acessado
    .maybeSingle();
  if (error || !evid) return res.status(404).json({ message: 'Evidência não encontrada.' });

  const { data, error: urlError } = await supabase.storage
    .from(BUCKET_EVIDENCIAS)
    .createSignedUrl(evid.storage_path, SIGNED_URL_TTL_SECONDS);
  if (urlError) return res.status(500).json({ message: 'Erro ao gerar o link da evidência.' });
  res.json({
    url: data?.signedUrl || data?.signedURL || null,
    mime: evid.mime || null,
    nome_arquivo: evid.nome_arquivo || null,
    expires_in: SIGNED_URL_TTL_SECONDS,
  });
};

exports.BUCKET_EVIDENCIAS = BUCKET_EVIDENCIAS;
exports.MAX_EVIDENCIAS = MAX_EVIDENCIAS;
exports.derivarStatusEpod = derivarStatusEpod; // exposto p/ testes
