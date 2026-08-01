const BUCKET_CONTRATOS = 'contratos-comerciais';
const SIGNED_URL_TTL_SECONDS = 300;
const PDF_MAX_BYTES = 10 * 1024 * 1024;

function caminhoContratoAssinado({ empresaId, contratoId }) {
  return `${empresaId}/contratos/${contratoId}/assinado.pdf`;
}

function validarPdfAssinado(file) {
  if (!file) return { ok: false, status: 400, message: 'Envie o contrato assinado em PDF.' };
  if (file.size != null && Number(file.size) > PDF_MAX_BYTES) {
    return { ok: false, status: 413, message: 'Arquivo muito grande. Envie um PDF de ate 10 MB.' };
  }
  if (file.mimetype !== 'application/pdf') {
    return { ok: false, status: 415, message: 'Formato de arquivo nao permitido. Use PDF.' };
  }
  const buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.alloc(0);
  if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    return { ok: false, status: 415, message: 'Arquivo PDF invalido. Envie um contrato assinado em PDF.' };
  }
  return { ok: true };
}

function validarStoragePathContrato({ storagePath, empresaId, contratoId }) {
  if (!storagePath || typeof storagePath !== 'string') return false;
  if (storagePath.includes('..') || storagePath.startsWith('/') || storagePath.includes('\\')) return false;
  return storagePath === caminhoContratoAssinado({ empresaId, contratoId });
}

async function criarUrlAssinadaContrato({ supabase, contrato, empresaId, ttlSeconds = SIGNED_URL_TTL_SECONDS }) {
  if (!contrato || contrato.empresa_id !== empresaId) {
    return { status: 404, body: { message: 'Contrato nao encontrado.' } };
  }
  if (!contrato.signed_storage_path) {
    return { status: 404, body: { message: 'Contrato assinado nao encontrado.' } };
  }
  if (!validarStoragePathContrato({
    storagePath: contrato.signed_storage_path,
    empresaId,
    contratoId: contrato.id,
  })) {
    return { status: 409, body: { message: 'Arquivo assinado com caminho invalido.' } };
  }

  const { data, error } = await supabase.storage
    .from(BUCKET_CONTRATOS)
    .createSignedUrl(contrato.signed_storage_path, ttlSeconds);
  if (error) throw error;
  return {
    status: 200,
    body: {
      url: data?.signedUrl,
      expires_in: ttlSeconds,
    },
  };
}

module.exports = {
  BUCKET_CONTRATOS,
  SIGNED_URL_TTL_SECONDS,
  PDF_MAX_BYTES,
  caminhoContratoAssinado,
  validarPdfAssinado,
  validarStoragePathContrato,
  criarUrlAssinadaContrato,
};
