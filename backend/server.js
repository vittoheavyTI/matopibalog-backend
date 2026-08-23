require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { getAuthConfig } = require('./config/authConfig');

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
const authConfig = getAuthConfig();

// Necessário para o Railway (proxy reverso) — corrige o express-rate-limit
app.set('trust proxy', 1);

// Hardening HTTP básico.
// - Remove o header "x-powered-by: Express" (não revelar a stack).
// - Helmet adiciona headers de segurança (x-content-type-options, hsts, etc.).
app.disable('x-powered-by');

// Content-Security-Policy CONSERVADORA (hardening). Este backend serve o SPA
// (express.static + fallback index.html), então o CSP vale para o painel servido
// AQUI (a Railway). O painel principal em GitHub Pages tem headers próprios e NÃO
// é afetado por este CSP — logo, o "blast radius" de um erro aqui é só o caminho
// de fallback pela Railway.
//
// FONTES LIBERADAS (documentadas — nada além disto):
//   default-src   'self'
//   script-src    'self' 'unsafe-inline'  → o index.html tem um script inline
//                 (redirect de SPA do GitHub Pages). 'unsafe-inline' é necessário
//                 porque um hash é frágil entre builds do Vite. A proteção real
//                 contra EXFILTRAÇÃO de token vem de connect-src/img-src abaixo:
//                 mesmo um script injetado NÃO consegue enviar o token para fora
//                 (fetch/XHR/img só para 'self' + Railway + Supabase).
//   style-src     'self' 'unsafe-inline'  → estilos inline do React + Tailwind.
//   img-src       'self' data: blob: + Supabase (imagens de storage).
//   font-src      'self' data:
//   connect-src   'self' + API Railway + Supabase (fetch/XHR/beacon/ws) — trava
//                 de exfiltração: destino de rede é allowlist.
//   object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'.
const SUPABASE_ORIGIN = (() => {
  try { return new URL(process.env.SUPABASE_URL || 'https://rjahjogidyndphdxevom.supabase.co').origin; }
  catch (_) { return 'https://rjahjogidyndphdxevom.supabase.co'; }
})();
const API_ORIGIN = 'https://matopibalog-backend-production.up.railway.app';
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', SUPABASE_ORIGIN],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", API_ORIGIN, SUPABASE_ORIGIN],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      workerSrc: ["'self'", 'blob:'],
    },
  },
}));

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://matopibalog.com.br';
const allowedOrigins = [
  'https://matopibalog.com.br',
  'http://matopibalog.com.br',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
  FRONTEND_URL,
].filter(Boolean);

// Limite geral: 600 req/15min POR USUÁRIO autenticado (fallback por IP).
// Antes era 200/15min por IP — baixo demais para uma SPA autenticada que faz
// polling e para vários usuários atrás do mesmo NAT/IP (todos dividiam o balde
// e estouravam 429 no uso normal). Números: um usuário ativo, com o polling já
// reduzido (sino 30s ≈ 30/15min + uma seção de frete 60s ≈ 15/15min + navegação/
// ações ≈ 100–200/15min), fica ~250/15min no pico. 600/usuário dá folga (~40
// req/min) sem afrouxar o login (limiter próprio por IP) nem virar vetor de abuso
// (conta autenticada é rastreável/bloqueável). Chave em middlewares/rateLimitKey.
const { chaveRateLimit } = require('./middlewares/rateLimitKey');
const { criarRefreshLimiter } = require('./middlewares/authRateLimit');
const { attachCorrelationContext } = require('./middlewares/correlationContext');
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: chaveRateLimit,
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
const refreshLimiter = criarRefreshLimiter();

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`Origem bloqueada pelo CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  // X-Client-Platform (E1.6A): assinatura de contrato novo do cliente. X-Operational-*:
  // headers de escopo operacional já emitidos pelo web (só quando ORG_SCOPE ativa) —
  // incluídos para o preflight não bloquear quando forem usados.
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Platform', 'X-Request-Id', 'X-Correlation-Id', 'X-Operation-Id', 'X-Causation-Id', 'X-Operational-Group-Id', 'X-Operational-Unit-Id'],
  credentials: true,
}));

// Uploads (foto/comprovante) usam multer/multipart e NÃO passam por aqui,
// então um limite conservador para JSON/urlencoded é seguro e mitiga DoS por payload.
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ limit: '2mb', extended: true }));
app.use(cookieParser());
app.use(attachCorrelationContext);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() });
});

// Stream SSE (realtime) montado ANTES do apiLimiter: uma conexão SSE é uma única
// requisição de longa duração e um reconnect não pode ser penalizado pelo balde de
// rate limit. A autenticação/tenant continua garantida pelo próprio router.
app.use('/realtime', require('./routes/realtime'));

app.use(apiLimiter);
app.use('/auth/login', loginLimiter);
app.use(['/auth/refresh', '/auth/mobile/refresh'], refreshLimiter);
app.use('/auth', authRoutes);
// /admin/termos e /admin/contrato-modelos ANTES de /admin para o router genérico
// não capturar o prefixo.
app.use('/admin/termos', adminTermosRoutes);
app.use('/admin/contrato-modelos', require('./routes/adminContratoModelos'));
app.use('/admin/diagnostics', require('./routes/diagnostics'));
app.use('/admin/permissions', require('./routes/permissions'));
app.use('/admin', adminRoutes);
app.use('/fleet', require('./routes/fleet'));
app.use('/operation-campaigns', require('./routes/operationCampaigns'));
app.use('/fretes', fretesRoutes);
app.use('/despesas', despesasRoutes);
app.use('/abastecimentos', abastecimentosRoutes);
app.use('/vales', valesRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/relatorios', relatoriosRoutes);
app.use('/configuracoes', configRoutes);
app.use('/operacional', require('./routes/operacional'));
app.use('/impressoras', require('./routes/impressoras'));
app.use('/integracoes', require('./routes/integracoes'));
app.use('/painel-admin', require('./routes/painel-admin'));
app.use('/planos', require('./routes/planos'));
app.use('/contratacao', require('./routes/contratacao'));
app.use('/pagamentos', require('./routes/pagamentos'));
app.use('/notificacoes', notificacoesRoutes);
app.use('/push', require('./routes/push'));
app.use('/termos', termosRoutes);
// Politica de versao do app (MOBILE-M1-008 / D-053) — rota publica read-only, sem
// banco. Serve latest/recommended/minimum + severity ao cliente Flutter.
app.use('/app', require('./routes/appVersion'));

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

// Verificação de trial/inadimplência/suspensão NÃO roda mais aqui (era um
// setInterval em toda instância). Agora é job one-shot determinístico agendado
// por cron externo: node jobs/expirarTrials.js (ver backend/railway.cron.suspensao.toml).

const path = require('path');
app.use(express.static(path.join(__dirname, '..', 'painel_web', 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'painel_web', 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('[auth] config', authConfig.summary());
  console.log(`🚀 Servidor Matopiba Log rodando na porta ${PORT}`);
});
