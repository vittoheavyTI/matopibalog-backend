const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const fretesRoutes = require('./routes/fretes');
const despesasRoutes = require('./routes/despesas');
const abastecimentosRoutes = require('./routes/abastecimentos');
const valesRoutes = require('./routes/vales');
const dashboardRoutes = require('./routes/dashboard');
const relatoriosRoutes = require('./routes/relatorios');
const configRoutes = require('./routes/config');

const app = express();

// Origens permitidas: local + domínio de produção definido em FRONTEND_URL
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://matopibalog.netlify.app';
const allowedOrigins = [
  'https://matopibalog.com.br',
  'http://matopibalog.com.br',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
  FRONTEND_URL,
].filter(Boolean);

// 1. Configuração do CORS corrigida (permitindo sua lista de origens e os cookies)
app.use(cors({
  origin: allowedOrigins,
  credentials: true 
}));

app.use(express.json());

// 2. Avisa o Express para ler os cookies
app.use(cookieParser());

// 3. Cria a proteção contra ataques (Rate Limit)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // Limita a 100 requisições por IP a cada 15 min
  message: { error: 'Muitas requisições deste IP, tente novamente mais tarde.' }
});

// Aplica a proteção em todas as requisições que chegarem ao servidor
app.use(generalLimiter);

// Registro de Rotas
app.use('/auth', authRoutes);
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
app.use('/pagamentos', require('./routes/pagamentos'));

// Jobs agendados
require('./jobs/expirarTrials');

// Serve arquivos estáticos do frontend (build)
const path = require('path');
app.use(express.static(path.join(__dirname, '..', 'painel_web', 'dist')));

// Fallback SPA: qualquer rota não-API serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'painel_web', 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor Chofer Log rodando na porta ${PORT}`);
});
