const jwt = require('jsonwebtoken');
const { getAuthRuntime } = require('../services/auth/authRuntime');
const { criarVerifyTokenSec1 } = require('./authSession');

let verifyTokenSec1Memo = null;

// IDENTIDADES EXTERNAS: o token do Portal do Embarcador (E3.5) e o da Rede de
// Parceiros (E3.6) são assinados com o MESMO JWT_SECRET — não inventamos gestão
// de segredo nova — e se distinguem por uma claim obrigatória, `token_kind`.
//
// Sem esta rejeição explícita, o caminho legado abaixo (jwt.verify puro)
// aceitaria um token externo como se fosse de um operador interno. E o dano não
// seria "ver a tela errada": `middlewares/tenant.js` deriva `req.empresa_id` de
// `usuarios.empresa_id`, então uma identidade externa que entrasse aqui herdaria
// o tenant inteiro de quem a convidou.
//
// A lista é DEFAULT-DENY por construção: todo `token_kind` conhecido é externo,
// e o token interno simplesmente não tem a claim. Um kind novo criado no futuro
// precisa entrar aqui — e o teste de simetria cobra isso.
const TOKEN_KINDS_EXTERNOS = new Set(['shipper_portal', 'partner_portal']);

const MENSAGEM_POR_KIND = {
  shipper_portal: 'Esta credencial é do portal do embarcador e não acessa o sistema interno.',
  partner_portal: 'Esta credencial é da área do parceiro e não acessa o sistema interno.',
};

function rejeitarTokenExterno(decoded, res) {
  const kind = decoded && decoded.token_kind;
  if (kind && TOKEN_KINDS_EXTERNOS.has(kind)) {
    res.status(403).json({ message: MENSAGEM_POR_KIND[kind] || 'Esta credencial não acessa o sistema interno.' });
    return true;
  }
  return false;
}

// Middleware 1: Verifica se o usuário está logado olhando o Cookie
const verifyToken = (req, res, next) => {
  const { cfg, sessionService } = getAuthRuntime();
  if (cfg.sessionsEnabled) {
    if (!verifyTokenSec1Memo) {
      verifyTokenSec1Memo = criarVerifyTokenSec1({ cfg, sessionService });
    }
    // Defesa em profundidade: mesmo com SEC-1 ligado (que valida sessão em
    // `auth_sessions`, onde uma identidade externa nunca existe), rejeitamos o
    // token externo ANTES, com mensagem correta em vez de erro de sessão.
    const authHeader = req.headers['authorization'];
    const bruto = (authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null)
      || (req.cookies ? req.cookies.token : null);
    if (bruto) {
      const semVerificar = jwt.decode(bruto);
      if (rejeitarTokenExterno(semVerificar, res)) return undefined;
    }
    return verifyTokenSec1Memo(req, res, next);
  }

  const tokenFromCookie = req.cookies ? req.cookies.token : null;
  const authHeader = req.headers['authorization'];
  const tokenFromHeader = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;
  const token = tokenFromCookie || tokenFromHeader;

  if (!token) {
    return res.status(401).json({ error: 'Acesso negado. Token não fornecido.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (rejeitarTokenExterno(decoded, res)) return undefined;
    req.user = decoded; // Salva os dados do usuário para a próxima rota
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Token inválido ou expirado.' });
  }
};

// Middleware 2 — DEPRECIADO. NÃO USAR EM ROTA NOVA.
//
// Verifica `role === 'admin'`, que é a CLASSE DA CONTA e não o papel da pessoa:
// desde o TEAM_USER_PROVISIONING_V1 (D-069) todo usuário interno nasce com
// `tipo='admin'` — Operador, Gerente e Financeiro inclusive. Ou seja, este gate
// **não distingue ninguém interno**: usá-lo é escrever uma porta destrancada.
//
// RBV9-INV-110 removeu todos os 11 usos que existiam (80 rotas). Hoje nenhuma rota
// o referencia; a exportação permanece só para não quebrar importadores externos.
//
// Use no lugar:
//   • ação de tenant  → requirePermission('<capability>') + verificarEmpresa
//   • plataforma      → isSuperAdmin
// E não substitua por outro teste de nome de papel — se nenhuma permissão existente
// representa a rota, escolha a MENOR capability canônica (D-072).
const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next(); // Pode passar
  } else {
    return res.status(403).json({ message: 'Acesso restrito para administradores.' });
  }
};

// Middleware 3: Verifica se o usuário é super-admin (poder global sobre todas as empresas)
const isSuperAdmin = (req, res, next) => {
  if (req.user && req.user.is_super_admin === true) {
    next();
  } else {
    return res.status(403).json({ message: 'Acesso restrito ao administrador do sistema.' });
  }
};

// Exporta as funções para serem usadas nas rotas
module.exports = {
  verifyToken,
  TOKEN_KINDS_EXTERNOS,
  isAdmin,
  isSuperAdmin
};
