const supabase = require('../config/supabase');
const { ensureEffective } = require('./../middlewares/requirePermission');

// Regras de acesso ao frete, reaproveitadas por ePOD e ocorrencias — MESMO modelo
// do fretesController/freteDocumentosController: super-admin tudo; admin so a
// propria empresa; motorista so os proprios fretes.
const acessoPermitidoAoFrete = (req, frete) => {
  if (req.user.is_super_admin === true) return true;
  if (req.user.role === 'admin') return frete.empresa_id === req.empresa_id;
  return frete.motorista_id === req.user.uid;
};

// Ações administrativas do frete — validar ePOD, resolver ocorrência — são da EMPRESA:
// o motorista registra e anexa, a empresa valida. A autoridade é a permissão efetiva
// `freight.manage`, não a classe de conta (RBV9-INV-110). Com `role==='admin'` o gate
// não distinguia ninguém interno, e um perfil customizado sem `freight.manage` passava
// só por ser interno — o oposto do que o modelo de perfis promete.
//
// Assíncrono de propósito: resolve o efetivo uma vez por request (cache em `req`).
async function podeGerenciarFrete(req) {
  if (req.user && req.user.is_super_admin === true) return true;
  const efetivo = await ensureEffective(req);
  return !!(efetivo && efetivo.permissions && efetivo.permissions['freight.manage'] === true);
}

// Nega com a mensagem canônica de permissão. Devolve true quando JÁ respondeu.
async function negarSeNaoGerenciaFrete(req, res) {
  if (await podeGerenciarFrete(req)) return false;
  res.status(403).json({
    message: 'Permissão insuficiente para esta ação.',
    permission: 'freight.manage',
  });
  return true;
}

// Busca o frete e valida acesso. Responde 404/403 e retorna null quando barrado.
async function buscarFreteComAcesso(req, res) {
  const { data: frete, error } = await supabase
    .from('fretes')
    .select('id, motorista_id, empresa_id, status')
    .eq('id', req.params.id)
    .single();
  if (error || !frete) {
    res.status(404).json({ message: 'Frete não encontrado.' });
    return null;
  }
  if (!acessoPermitidoAoFrete(req, frete)) {
    res.status(403).json({ message: 'Acesso negado.' });
    return null;
  }
  return frete;
}

module.exports = { acessoPermitidoAoFrete, podeGerenciarFrete, negarSeNaoGerenciaFrete, buscarFreteComAcesso };
