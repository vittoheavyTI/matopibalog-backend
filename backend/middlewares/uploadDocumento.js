// Upload de DOCUMENTOS de frete (CTe/MDF-e/NF-e e outros). Middleware SEPARADO
// do upload de imagens (middlewares/upload.js) de propósito:
//  - allowlist diferente: PDF, XML e imagens (o motorista pode fotografar o
//    documento em papel);
//  - teto maior (15 MB) que o de fotos (10 MB);
//  - trata os erros do multer LOCALMENTE (tamanho/MIME) para não herdar a
//    mensagem/limite do upload de imagens no handler global do server.js.
// NÃO afrouxa nem substitui o upload.js existente.
const multer = require('multer');

const MIME_PERMITIDOS = [
  'application/pdf',
  'text/xml',
  'application/xml',
  'image/jpeg',
  'image/png',
  'image/webp',
];
const MAX_UPLOAD_SIZE_MB = 15;
const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;

const _multer = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (MIME_PERMITIDOS.includes(file.mimetype)) return cb(null, true);
    const err = new Error('Formato de arquivo não permitido. Use PDF, XML ou imagem (JPEG, PNG, WebP).');
    err.code = 'INVALID_FILE_TYPE';
    return cb(err);
  },
});

// Wrapper de `.single(field)` que resolve os erros do multer AQUI, com as
// mensagens/limite corretos deste fluxo — sem cair no handler global (que usa o
// limite do upload de imagens). Sucesso → next(); erro → resposta JSON.
function single(field) {
  return (req, res, next) => {
    _multer.single(field)(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ message: `Arquivo muito grande. Limite: ${MAX_UPLOAD_SIZE_MB} MB.` });
      }
      if (err.code === 'INVALID_FILE_TYPE') {
        return res.status(415).json({ message: err.message });
      }
      return res.status(400).json({ message: 'Erro no upload do documento.' });
    });
  };
}

module.exports = { single, MIME_PERMITIDOS, MAX_UPLOAD_SIZE_MB };
