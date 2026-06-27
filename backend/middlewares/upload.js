// Configuração compartilhada do multer para uploads de comprovante/foto.
// - memoryStorage: o controller envia file.buffer para o Supabase Storage.
// - limits.fileSize: teto de 5 MB (evita DoS/OOM por upload grande em memória).
// - fileFilter: allowlist de imagens (JPEG, PNG, WebP).
// Os erros (tamanho/MIME) são tratados pelo middleware de erro em server.js.
const multer = require('multer');

const MIME_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];
const LIMITE_BYTES = 5 * 1024 * 1024; // 5 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITE_BYTES },
  fileFilter: (req, file, cb) => {
    if (MIME_PERMITIDOS.includes(file.mimetype)) {
      return cb(null, true);
    }
    const err = new Error('Formato de arquivo não permitido. Use JPEG, PNG ou WebP.');
    err.code = 'INVALID_FILE_TYPE';
    return cb(err);
  },
});

module.exports = upload;
