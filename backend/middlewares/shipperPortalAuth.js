'use strict';

// shipperPortalAuth — autenticação do usuário EXTERNO do portal.
//
// Duas garantias simétricas, e as duas importam:
//   1. Um token de portal NUNCA é aceito nas rotas internas da transportadora.
//   2. Um token interno NUNCA é aceito nas rotas do portal.
//
// A garantia (1) é o risco mais grave: o `verifyToken` interno faz
// `jwt.verify(token, JWT_SECRET)` e, no caminho legado (sessionsEnabled=false),
// aceitaria qualquer JWT assinado com o mesmo segredo. Como o portal usa o mesmo
// JWT_SECRET (não inventamos gestão de segredo nova), a separação é feita por uma
// claim discriminante obrigatória — `token_kind` — verificada nos DOIS lados.
// Ver a rejeição explícita adicionada em middlewares/auth.js.

const jwt = require('jsonwebtoken');

const PORTAL_TOKEN_KIND = 'shipper_portal';
const PORTAL_TOKEN_TTL_SECONDS = 60 * 60 * 8; // 8h — sessão de portal é curta.

function emitirTokenPortal({ portalUserId, shipperOrgId, email }) {
  return jwt.sign(
    {
      token_kind: PORTAL_TOKEN_KIND,
      portal_user_id: portalUserId,
      shipper_org_id: shipperOrgId,
      email,
    },
    process.env.JWT_SECRET,
    { expiresIn: PORTAL_TOKEN_TTL_SECONDS },
  );
}

// Autentica o portal. Rejeita explicitamente qualquer token que não seja de
// portal — inclusive um token interno válido (um operador da transportadora não
// entra no portal com a credencial interna; são contextos distintos, §5).
function verifyPortalToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const tokenFromHeader = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = tokenFromHeader || (req.cookies ? req.cookies.portal_token : null);

  if (!token) {
    return res.status(401).json({ message: 'Faça login para acessar o portal.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ message: 'Sua sessão expirou. Entre novamente.' });
  }

  if (decoded.token_kind !== PORTAL_TOKEN_KIND || !decoded.portal_user_id || !decoded.shipper_org_id) {
    // Token interno (ou qualquer outro) não vale aqui.
    return res.status(403).json({ message: 'Esta credencial não tem acesso ao portal.' });
  }

  req.portalUser = {
    id: decoded.portal_user_id,
    shipper_org_id: decoded.shipper_org_id,
    email: decoded.email || null,
  };
  return next();
}

module.exports = { verifyPortalToken, emitirTokenPortal, PORTAL_TOKEN_KIND, PORTAL_TOKEN_TTL_SECONDS };
