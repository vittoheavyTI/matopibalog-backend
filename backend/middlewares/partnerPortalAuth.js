'use strict';

// partnerPortalAuth — autenticação do parceiro EXTERNO (Partner Lite).
//
// Mesmo desenho da E3.5, e pela mesma razão: o portal usa o MESMO `JWT_SECRET`
// (não inventamos gestão de segredo nova), então a separação entre mundos vive
// numa claim discriminante obrigatória — `token_kind` — verificada nos dois
// lados. Sem isso, o caminho legado do `verifyToken` interno
// (`jwt.verify` puro) aceitaria qualquer JWT assinado com o mesmo segredo.
//
// O que está em jogo é maior que "ver a tela errada": `middlewares/tenant.js`
// deriva `req.empresa_id` de `usuarios.empresa_id`. Uma identidade externa que
// entrasse ali herdaria o tenant inteiro de quem a convidou.
//
// Simetria obrigatória:
//   1. token de parceiro NUNCA é aceito nas rotas internas (auth.js rejeita);
//   2. token interno NUNCA é aceito nas rotas de parceiro (aqui).

const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const { carregarContextoDoParceiro } = require('../services/partnerNetwork/partnerIdentityService');

const PARTNER_TOKEN_KIND = 'partner_portal';
const PARTNER_TOKEN_TTL_SECONDS = 60 * 60 * 8; // 8h — sessão externa é curta.

function emitirTokenParceiro({ partnerUserId, partnerOrganizationId, email }) {
  return jwt.sign(
    {
      token_kind: PARTNER_TOKEN_KIND,
      partner_user_id: partnerUserId,
      partner_organization_id: partnerOrganizationId,
      email,
    },
    process.env.JWT_SECRET,
    { expiresIn: PARTNER_TOKEN_TTL_SECONDS },
  );
}

// Autentica o parceiro externo. Rejeita explicitamente qualquer token que não
// seja de parceiro — inclusive um token interno válido.
//
// O JWT NÃO É A AUTORIDADE FINAL. Ele prova que a sessão foi emitida; quem diz
// se ela ainda vale é o estado atual em `partner_portal_users`, relido a cada
// requisição. Sem isso, bloquear um parceiro só teria efeito quando o token
// expirasse — até 8 horas depois, o que na prática é não bloquear.
//
// Repare no que este `req` NÃO ganha: `empresa_id`. O parceiro nunca tem tenant
// do solicitante; o acesso dele é sempre derivado de um share explícito.
async function verifyPartnerToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const tokenFromHeader = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = tokenFromHeader || (req.cookies ? req.cookies.partner_token : null);

  if (!token) {
    return res.status(401).json({ message: 'Faça login para acessar a área do parceiro.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ message: 'Sua sessão expirou. Entre novamente.' });
  }

  if (decoded.token_kind !== PARTNER_TOKEN_KIND
    || !decoded.partner_user_id
    || !decoded.partner_organization_id) {
    return res.status(403).json({ message: 'Esta credencial não tem acesso à área do parceiro.' });
  }

  // Releitura do estado: bloqueio, exclusão ou troca de vínculo têm efeito
  // imediato, não no vencimento do token.
  try {
    const contexto = await carregarContextoDoParceiro(supabase, {
      partnerUserId: decoded.partner_user_id,
    });
    // A organização do token tem que bater com a do registro. Se divergir, algo
    // mudou depois da emissão e a sessão não vale mais.
    if (contexto.partner_organization_id !== decoded.partner_organization_id) {
      return res.status(401).json({ message: 'Sua sessão expirou. Entre novamente.' });
    }
    req.partnerUser = {
      id: contexto.id,
      partner_organization_id: contexto.partner_organization_id,
      email: contexto.email,
      auth_user_id: contexto.auth_user_id,
    };
    return next();
  } catch (err) {
    const status = err?.status || 401;
    return res.status(status).json({ message: err?.message || 'Sua sessão expirou. Entre novamente.' });
  }
}

module.exports = {
  PARTNER_TOKEN_KIND,
  PARTNER_TOKEN_TTL_SECONDS,
  emitirTokenParceiro,
  verifyPartnerToken,
};
