// Configuração compartilhada do multer para uploads de comprovante/foto.
// - memoryStorage: o controller envia file.buffer para o Supabase Storage.
// - limits.fileSize: teto de 10 MB (evita DoS/OOM por upload grande em memória).
//   Fotos de câmera de celular giram em ~8 MB, então 10 MB cobre o caso real.
// - fileFilter: allowlist de imagens (JPEG, PNG, WebP).
// Os erros (tamanho/MIME) são tratados pelo middleware de erro em server.js.
const multer = require('multer');

const MIME_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_UPLOAD_SIZE_MB = 10;
const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (MIME_PERMITIDOS.includes(file.mimetype)) {
      return cb(null, true);
    }
    const err = new Error('Formato de arquivo não permitido. Use JPEG, PNG ou WebP.');
    err.code = 'INVALID_FILE_TYPE';
    return cb(err);
  },
});

// Exposto para o middleware de erro montar a mensagem sem duplicar o número.
upload.MAX_UPLOAD_SIZE_MB = MAX_UPLOAD_SIZE_MB;

module.exports = upload;
