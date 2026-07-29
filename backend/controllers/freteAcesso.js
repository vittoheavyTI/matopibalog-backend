const supabase = require('../config/supabase');

// Regras de acesso ao frete, reaproveitadas por ePOD e ocorrencias — MESMO modelo
// do fretesController/freteDocumentosController: super-admin tudo; admin so a
// propria empresa; motorista so os proprios fretes.
const acessoPermitidoAoFrete = (req, frete) => {
  if (req.user.is_super_admin === true) return true;
  if (req.user.role === 'admin') return frete.empresa_id === req.empresa_id;
  return frete.motorista_id === req.user.uid;
};

// Ações administrativas (validar ePOD, mudar status de ocorrencia) são só de
// admin/super-admin — o motorista registra/anexa, a empresa valida/resolve.
const ehAdmin = (req) => req.user.is_super_admin === true || req.user.role === 'admin';

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

module.exports = { acessoPermitidoAoFrete, ehAdmin, buscarFreteComAcesso };
