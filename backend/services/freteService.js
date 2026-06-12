const supabase = require('../config/supabase');

// Status de frete "encerrados": não aceitam novos lançamentos.
const STATUS_ENCERRADOS = ['finalizado', 'cancelado'];

// Quando frete_id é vazio/null → ok:true (não bloqueia lançamentos sem frete neste patch).
async function checarFreteAberto(freteId) {
  if (!freteId) return { ok: true, semFrete: true };
  const { data, error } = await supabase
    .from('fretes').select('status').eq('id', freteId).single();
  if (error || !data) return { ok: false, notFound: true };
  if (STATUS_ENCERRADOS.includes(data.status)) return { ok: false, encerrado: true, status: data.status };
  return { ok: true, status: data.status };
}

module.exports = { checarFreteAberto, STATUS_ENCERRADOS };
