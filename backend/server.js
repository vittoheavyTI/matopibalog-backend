require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const upload = require('./middlewares/upload');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const fretesRoutes = require('./routes/fretes');
const despesasRoutes = require('./routes/despesas');
const abastecimentosRoutes = require('./routes/abastecimentos');
const valesRoutes = require('./routes/vales');
const dashboardRoutes = require('./routes/dashboard');
const relatoriosRoutes = require('./routes/relatorios');
const configRoutes = require('./routes/config');
const notificacoesRoutes = require('./routes/notificacoes');
const termosRoutes = require('./routes/termos');
const adminTermosRoutes = require('./routes/adminTermos');

const app = express();

// Necessário para o Railway (proxy reverso) — corrige o express-rate-limit
app.set('trust proxy', 1);

// Hardening HTTP básico.
// - Remove o header "x-powered-by: Express" (não revelar a stack).
// - Helmet adiciona headers de segurança (x-content-type-options, hsts, etc.).
//   CSP desabilitado neste primeiro PR para não arriscar quebrar o frontend
//   (SPA servida por este mesmo backend) nem chamadas cross-origin do app/painel.
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://matopibalog.com.br';
const allowedOrigins = [
  'https://matopibalog.com.br',
  'http://matopibalog.com.br',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
  FRONTEND_URL,
].filter(Boolean);

// Limite geral: 200 req/15min por IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Muitas requisições. Tente novamente em alguns minutos.' },
});

// Limite estrito de login: 10 tentativas/15min por IP (anti brute-force)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { message: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`Origem bloqueada pelo CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Uploads (foto/comprovante) usam multer/multipart e NÃO passam por aqui,
// então um limite conservador para JSON/urlencoded é seguro e mitiga DoS por payload.
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ limit: '2mb', extended: true }));
app.use(cookieParser());

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() });
});

app.use(apiLimiter);
app.use('/auth/login', loginLimiter);
app.use('/auth', authRoutes);
// /admin/termos ANTES de /admin para o router genérico não capturar o prefixo.
app.use('/admin/termos', adminTermosRoutes);
app.use('/admin', adminRoutes);
app.use('/fretes', fretesRoutes);
app.use('/despesas', despesasRoutes);
app.use('/abastecimentos', abastecimentosRoutes);
app.use('/vales', valesRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/relatorios', relatoriosRoutes);
app.use('/configuracoes', configRoutes);
app.use('/impressoras', require('./routes/impressoras'));
app.use('/integracoes', require('./routes/integracoes'));
app.use('/painel-admin', require('./routes/painel-admin'));
app.use('/planos', require('./routes/planos'));
app.use('/pagamentos', require('./routes/pagamentos'));
app.use('/notificacoes', notificacoesRoutes);
app.use('/push', require('./routes/push'));
app.use('/termos', termosRoutes);

// Tratamento de erros de upload (multer). Mapeia tamanho/MIME para respostas
// JSON controladas; erros não relacionados seguem para o próximo handler.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: `Arquivo muito grande. Limite: ${upload.MAX_UPLOAD_SIZE_MB} MB.` });
    }
    return res.status(400).json({ message: 'Erro no upload do arquivo.' });
  }
  if (err && err.code === 'INVALID_FILE_TYPE') {
    return res.status(400).json({ message: 'Formato de arquivo não permitido. Use JPEG, PNG ou WebP.' });
  }
  return next(err);
});

require('./jobs/expirarTrials');

const path = require('path');
app.use(express.static(path.join(__dirname, '..', 'painel_web', 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'painel_web', 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor Matopiba Log rodando na porta ${PORT}`);
});
