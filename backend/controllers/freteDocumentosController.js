const crypto = require('crypto');
const supabase = require('../config/supabase');
const { TIPOS_DOCUMENTO } = require('../schemas/freteDocumentos');

// Documentos fiscais de frete. Espelha o padrão do odômetro (bucket PRIVADO +
// path por empresa/frete + signed URL), mas em recurso próprio (tabela
// frete_documentos, bucket fretes-documentos) — sem tocar odômetro/comprovantes.
const BUCKET_DOCUMENTOS = 'fretes-documentos';
const SIGNED_URL_TTL_SECONDS = 300;
const MAX_DOCS_POR_FRETE = 10;

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

exports.listar = async (req, res) => {
  const frete = await buscarFreteComAcesso(req, res);
  if (!frete) return;
  const { data, error } = await supabase
    .from('frete_documentos')
    .select('id, tipo, nome_arquivo, mime, tamanho_bytes, created_at')
    .eq('frete_id', frete.id)
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
      mime: req.file.mimetype,
      tamanho_bytes: req.file.size,
      criado_por: req.user.uid,
    })
    .select('id, tipo, nome_arquivo, mime, tamanho_bytes, created_at')
    .single();
  if (insertError) {
    // Rollback do objeto para não deixar arquivo órfão sem metadados.
    await supabase.storage.from(BUCKET_DOCUMENTOS).remove([storagePath]).catch(() => {});
    console.error('[freteDocumentos:upload] Falha ao inserir metadados', insertError.message);
    return res.status(500).json({ message: 'Erro ao registrar o documento.' });
  }
  res.status(201).json(inserido);
};

exports.getSignedUrl = async (req, res) => {
  const frete = await buscarFreteComAcesso(req, res);
  if (!frete) return;
  const { data: doc, error } = await supabase
    .from('frete_documentos')
    .select('id, storage_path')
    .eq('id', req.params.docId)
    .eq('frete_id', frete.id) // o documento tem que pertencer ao frete acessado
    .single();
  if (error || !doc) return res.status(404).json({ message: 'Documento não encontrado.' });

  const { data, error: urlError } = await supabase.storage
    .from(BUCKET_DOCUMENTOS)
    .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);
  if (urlError) return res.status(500).json({ message: 'Erro ao gerar o link do documento.' });
  res.json({ url: data?.signedUrl || data?.signedURL || null });
};

// Exposto para os testes.
exports.MAX_DOCS_POR_FRETE = MAX_DOCS_POR_FRETE;
exports.BUCKET_DOCUMENTOS = BUCKET_DOCUMENTOS;
