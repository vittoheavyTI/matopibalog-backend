const BUCKET_CONTRATOS = 'contratos-comerciais';
const SIGNED_URL_TTL_SECONDS = 300;
const PDF_MAX_BYTES = 10 * 1024 * 1024;
// SHA-256 em hexadecimal minúsculo (64 chars) — mesmo formato do CHECK da migration 055.
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

function caminhoContratoAssinado({ empresaId, contratoId }) {
  return `${empresaId}/contratos/${contratoId}/assinado.pdf`;
}

// Nomes de arquivo permitidos por categoria, dentro do prefixo <empresa>/contratos/<contrato>/:
//  - 'assinado'   : legado `assinado.pdf` OU fluxo interno `final-<sha256>.pdf`
//  - 'certificado': `certificado-<sha256>.pdf`
function nomeArquivoPermitido(nome, categoria) {
  if (categoria === 'certificado') {
    const m = /^certificado-([0-9a-f]{64})\.pdf$/.exec(nome);
    return Boolean(m && SHA256_HEX_RE.test(m[1]));
  }
  if (nome === 'assinado.pdf') return true;
  const m = /^final-([0-9a-f]{64})\.pdf$/.exec(nome);
  return Boolean(m && SHA256_HEX_RE.test(m[1]));
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

// Valida com segurança o storage path de um contrato/certificado dentro do
// bucket privado. Exige: empresa_id e contrato_id no prefixo, prefixo correto,
// sem traversal (`..`), sem barra inicial, sem `\`, sem subpasta extra, e nome
// de arquivo permitido para a categoria (com hash SHA-256 hex de 64 chars quando
// for final-<hash>.pdf / certificado-<hash>.pdf).
function validarStoragePathContrato({ storagePath, empresaId, contratoId, categoria = 'assinado' }) {
  if (!storagePath || typeof storagePath !== 'string') return false;
  if (!empresaId || !contratoId) return false;
  if (storagePath.includes('..') || storagePath.startsWith('/') || storagePath.includes('\\')) return false;
  const prefixo = `${empresaId}/contratos/${contratoId}/`;
  if (!storagePath.startsWith(prefixo)) return false;
  const nome = storagePath.slice(prefixo.length);
  if (!nome || nome.includes('/')) return false;
  return nomeArquivoPermitido(nome, categoria);
}

// Gera uma signed URL privada e temporária para um path de storage já persistido,
// validando tenant + contrato + path + categoria. Nunca expõe o storage path na
// resposta; devolve apenas a URL assinada e o TTL.
async function criarUrlAssinadaDocumento({ supabase, contrato, empresaId, storagePath, categoria, msgAusente, msgInvalido, ttlSeconds = SIGNED_URL_TTL_SECONDS }) {
  if (!contrato || contrato.empresa_id !== empresaId) {
    return { status: 404, body: { message: 'Contrato nao encontrado.' } };
  }
  if (!storagePath) {
    return { status: 404, body: { message: msgAusente } };
  }
  if (!validarStoragePathContrato({ storagePath, empresaId, contratoId: contrato.id, categoria })) {
    return { status: 409, body: { message: msgInvalido } };
  }

  const { data, error } = await supabase.storage
    .from(BUCKET_CONTRATOS)
    .createSignedUrl(storagePath, ttlSeconds);
  if (error) throw error;
  return {
    status: 200,
    body: {
      url: data?.signedUrl,
      expires_in: ttlSeconds,
    },
  };
}

async function criarUrlAssinadaContrato({ supabase, contrato, empresaId, ttlSeconds = SIGNED_URL_TTL_SECONDS }) {
  return criarUrlAssinadaDocumento({
    supabase,
    contrato,
    empresaId,
    storagePath: contrato && contrato.signed_storage_path,
    categoria: 'assinado',
    msgAusente: 'Contrato assinado nao encontrado.',
    msgInvalido: 'Arquivo assinado com caminho invalido.',
    ttlSeconds,
  });
}

async function criarUrlAssinadaCertificado({ supabase, contrato, empresaId, ttlSeconds = SIGNED_URL_TTL_SECONDS }) {
  return criarUrlAssinadaDocumento({
    supabase,
    contrato,
    empresaId,
    storagePath: contrato && contrato.certificate_storage_path,
    categoria: 'certificado',
    msgAusente: 'Certificado nao encontrado.',
    msgInvalido: 'Certificado com caminho invalido.',
    ttlSeconds,
  });
}

module.exports = {
  BUCKET_CONTRATOS,
  SIGNED_URL_TTL_SECONDS,
  PDF_MAX_BYTES,
  caminhoContratoAssinado,
  nomeArquivoPermitido,
  validarPdfAssinado,
  validarStoragePathContrato,
  criarUrlAssinadaContrato,
  criarUrlAssinadaCertificado,
};
