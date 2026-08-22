const crypto = require('crypto');
const supabase = require('../config/supabase');
const { TIPOS_DOCUMENTO } = require('../schemas/freteDocumentos');

// Documentos fiscais de frete. Espelha o padrão do odômetro (bucket PRIVADO +
// path por empresa/frete + signed URL), mas em recurso próprio (tabela
// frete_documentos, bucket fretes-documentos) — sem tocar odômetro/comprovantes.
const BUCKET_DOCUMENTOS = 'fretes-documentos';
const SIGNED_URL_TTL_SECONDS = 300;
const MAX_DOCS_POR_FRETE = 10;
const COLUNAS_DOCUMENTO =
  'id, tipo, nome_arquivo, nome_documento, descricao, mime, tamanho_bytes, status, client_request_id, document_contract_version, created_at, updated_at';

// Mesma allowlist do middleware, aqui para resolver a extensão do path.
const EXTENSAO_POR_MIME = {
  'application/pdf': 'pdf',
  'text/xml': 'xml',
  'application/xml': 'xml',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// Mesmo modelo de acesso do fretesController: super-admin tudo; admin só a
// própria empresa; motorista só os próprios fretes.
const acessoPermitidoAoFrete = (req, frete) => {
  if (req.user.is_super_admin === true) return true;
  if (req.user.role === 'admin') return frete.empresa_id === req.empresa_id;
  return frete.motorista_id === req.user.uid;
};

const textoOpcional = (v, max = 180) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

const normalizarClientRequestId = (v) => {
  const s = textoOpcional(v, 120);
  return s && /^[A-Za-z0-9._:-]{8,120}$/.test(s) ? s : null;
};

const usaContratoV2 = (body) =>
  String(body.document_contract_version || '').trim() === '2'
  || body.contrato_documento_v2 === true
  || body.contrato_documento_v2 === 'true';

const eventoDocumento = async ({ documento, evento, req, reason = null, metadata = {} }) => {
  await supabase
    .from('frete_documento_eventos')
    .insert({
      documento_id: documento.id,
      frete_id: documento.frete_id,
      empresa_id: documento.empresa_id,
      evento,
      actor_id: req.user?.uid || null,
      actor_role: req.user?.role || null,
      source: req.headers?.['x-client-platform'] || 'api',
      reason,
      metadata,
    });
};

// Busca o frete e valida acesso. Responde 404/403 e retorna null quando barrado.
async function buscarFreteComAcesso(req, res) {
  const { data: frete, error } = await supabase
    .from('fretes')
    .select('id, motorista_id, empresa_id, status')
    .eq('id', req.params.id)
    .single();
  if (error || !frete) {
    res.status(404).json({ message: 'Frete não encontrado.' });
    return null;
  }
  if (!acessoPermitidoAoFrete(req, frete)) {
    res.status(403).json({ message: 'Acesso negado.' });
    return null;
  }
  return frete;
}

async function exigirGestaoDocumentosEmpresarial(req, res) {
  const ehEmpresarial = req.user.is_super_admin !== true && req.user.role === 'admin';
  if (!ehEmpresarial) return true;
  try {
    const { ensureEffective } = require('../middlewares/requirePermission');
    const eff = await ensureEffective(req);
    if (!(eff && eff.permissions && eff.permissions['documents.manage'] === true)) {
      res.status(403).json({ message: 'Permissão insuficiente para gerenciar documentos.', permission: 'documents.manage' });
      return false;
    }
    return true;
  } catch (e) {
    res.status(500).json({ message: 'Erro ao verificar permissão.' });
    return false;
  }
}

exports.listar = async (req, res) => {
  const frete = await buscarFreteComAcesso(req, res);
  if (!frete) return;
  const { data, error } = await supabase
    .from('frete_documentos')
    .select(COLUNAS_DOCUMENTO)
    .eq('frete_id', frete.id)
    .eq('status', 'ativo')
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ message: 'Erro ao listar documentos do frete.' });
  res.json(data || []);
};

exports.upload = async (req, res) => {
  const tipo = String(req.body.tipo || '').trim().toLowerCase();
  if (!TIPOS_DOCUMENTO.includes(tipo)) {
    return res.status(400).json({ message: 'Tipo inválido. Use cte, mdfe, nfe ou outro.' });
  }
  if (!req.file) {
    return res.status(400).json({ message: 'Documento não enviado.' });
  }
  const extensao = EXTENSAO_POR_MIME[req.file.mimetype];
  if (!extensao) {
    return res.status(415).json({ message: 'Formato de arquivo não permitido. Use PDF, XML ou imagem (JPEG, PNG, WebP).' });
  }

  const frete = await buscarFreteComAcesso(req, res);
  if (!frete) return;

  const documentContractVersion = usaContratoV2(req.body) ? 2 : 1;
  const nomeDocumento = textoOpcional(req.body.nome_documento || req.body.nome, 120);
  const descricao = textoOpcional(req.body.descricao, 500);
  const clientRequestId = normalizarClientRequestId(req.body.client_request_id);

  if (documentContractVersion === 2 && tipo === 'outro' && !nomeDocumento && !descricao) {
    return res.status(422).json({ message: 'Informe nome ou descrição para documento do tipo Outro.' });
  }

  if (clientRequestId) {
    const { data: existente, error: idemError } = await supabase
      .from('frete_documentos')
      .select(COLUNAS_DOCUMENTO)
      .eq('frete_id', frete.id)
      .eq('criado_por', req.user.uid)
      .eq('client_request_id', clientRequestId)
      .maybeSingle();
    if (idemError) return res.status(500).json({ message: 'Erro ao verificar idempotência do documento.' });
    if (existente) return res.status(200).json({ ...existente, idempotent: true });
  }

  // P2.10 — AUTORIDADE do upload:
  //   • motorista dono do frete → ação CONTEXTUAL (comprovante do próprio frete),
  //     preservada sem exigir documents.manage empresarial;
  //   • caller EMPRESARIAL (admin/operador/gerente) → exige documents.manage EFETIVA;
  //   • super-admin → authority de plataforma.
  if (!(await exigirGestaoDocumentosEmpresarial(req, res))) return;

  // Limite por frete (piloto: 10).
  const { count, error: countError } = await supabase
    .from('frete_documentos')
    .select('id', { count: 'exact', head: true })
    .eq('frete_id', frete.id);
  if (countError) return res.status(500).json({ message: 'Erro ao verificar documentos existentes.' });
  if ((count || 0) >= MAX_DOCS_POR_FRETE) {
    return res.status(409).json({ message: `Limite de ${MAX_DOCS_POR_FRETE} documentos por frete atingido.` });
  }

  const docId = crypto.randomUUID();
  const storagePath = `${frete.empresa_id}/fretes/${frete.id}/documentos/${docId}.${extensao}`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET_DOCUMENTOS)
    .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
  if (uploadError) {
    console.error('[freteDocumentos:upload] Falha no upload privado', {
      frete_id: frete.id,
      empresa_id: frete.empresa_id,
      tipo,
      mime: req.file.mimetype,
      size: req.file.size,
      erro: uploadError.message || String(uploadError),
    });
    return res.status(502).json({ message: 'Erro ao salvar o documento.' });
  }

  const { data: inserido, error: insertError } = await supabase
    .from('frete_documentos')
    .insert({
      id: docId,
      frete_id: frete.id,
      empresa_id: frete.empresa_id, // derivado do frete, nunca do body
      tipo,
      storage_path: storagePath,
      nome_arquivo: req.file.originalname || null,
      nome_documento: nomeDocumento,
      descricao,
      mime: req.file.mimetype,
      tamanho_bytes: req.file.size,
      criado_por: req.user.uid,
      client_request_id: clientRequestId,
      document_contract_version: documentContractVersion,
      status: 'ativo',
    })
    .select(COLUNAS_DOCUMENTO + ', frete_id, empresa_id')
    .single();
  if (insertError) {
    // Rollback do objeto para não deixar arquivo órfão sem metadados.
    await supabase.storage.from(BUCKET_DOCUMENTOS).remove([storagePath]).catch(() => {});
    if (insertError.code === '23505' && clientRequestId) {
      const { data: existente } = await supabase
        .from('frete_documentos')
        .select(COLUNAS_DOCUMENTO)
        .eq('frete_id', frete.id)
        .eq('criado_por', req.user.uid)
        .eq('client_request_id', clientRequestId)
        .maybeSingle();
      if (existente) return res.status(200).json({ ...existente, idempotent: true });
    }
    console.error('[freteDocumentos:upload] Falha ao inserir metadados', insertError.message);
    return res.status(500).json({ message: 'Erro ao registrar o documento.' });
  }
  eventoDocumento({
    documento: inserido,
    evento: 'uploaded',
    req,
    metadata: { tipo, mime: req.file.mimetype, tamanho_bytes: req.file.size, contract_version: documentContractVersion },
  }).catch(() => {});
  const { frete_id, empresa_id, ...publico } = inserido;
  res.status(201).json(publico);
};

exports.getSignedUrl = async (req, res) => {
  const frete = await buscarFreteComAcesso(req, res);
  if (!frete) return;
  const { data: doc, error } = await supabase
    .from('frete_documentos')
    .select('id, storage_path, mime, nome_arquivo, nome_documento')
    .eq('id', req.params.docId)
    .eq('frete_id', frete.id) // o documento tem que pertencer ao frete acessado
    .eq('status', 'ativo')
    .single();
  if (error || !doc) return res.status(404).json({ message: 'Documento não encontrado.' });

  const { data, error: urlError } = await supabase.storage
    .from(BUCKET_DOCUMENTOS)
    .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);
  if (urlError) return res.status(500).json({ message: 'Erro ao gerar o link do documento.' });
  res.json({
    url: data?.signedUrl || data?.signedURL || null,
    mime: doc.mime || null,
    nome_arquivo: doc.nome_arquivo || null,
    nome_documento: doc.nome_documento || null,
    expires_in: SIGNED_URL_TTL_SECONDS,
  });
};

exports.cancelar = async (req, res) => {
  const frete = await buscarFreteComAcesso(req, res);
  if (!frete) return;
  if (!(await exigirGestaoDocumentosEmpresarial(req, res))) return;

  const agora = new Date().toISOString();
  const motivo = textoOpcional(req.body?.motivo || req.body?.reason, 500);
  const { data: doc, error } = await supabase
    .from('frete_documentos')
    .update({
      status: 'cancelado',
      cancelado_em: agora,
      cancelado_por: req.user.uid,
      cancelamento_motivo: motivo,
      updated_at: agora,
    })
    .eq('id', req.params.docId)
    .eq('frete_id', frete.id)
    .neq('status', 'cancelado')
    .select(COLUNAS_DOCUMENTO + ', frete_id, empresa_id')
    .maybeSingle();
  if (error) return res.status(500).json({ message: 'Erro ao cancelar o documento.' });
  if (!doc) return res.status(404).json({ message: 'Documento não encontrado.' });
  eventoDocumento({ documento: doc, evento: 'cancelled', req, reason: motivo }).catch(() => {});
  res.json({ id: doc.id, status: doc.status, cancelado_em: agora });
};

// Exposto para os testes.
exports.MAX_DOCS_POR_FRETE = MAX_DOCS_POR_FRETE;
exports.BUCKET_DOCUMENTOS = BUCKET_DOCUMENTOS;
exports.usaContratoV2 = usaContratoV2;
