const supabase = require('../config/supabase');

// Status de frete "encerrados": não aceitam novos lançamentos.
const STATUS_ENCERRADOS = ['finalizado', 'cancelado'];

// Quando frete_id é vazio/null → ok:true (não bloqueia lançamentos sem frete neste patch).
async function checarFreteAberto(freteId) {
  if (!freteId) return { ok: true, semFrete: true };
  const { data, error } = await supabase
    .from('fretes').select('status, motorista_id').eq('id', freteId).single();
  if (error || !data) return { ok: false, notFound: true };
  if (STATUS_ENCERRADOS.includes(data.status)) {
    return { ok: false, encerrado: true, status: data.status, motoristaId: data.motorista_id };
  }
  return { ok: true, status: data.status, motoristaId: data.motorista_id };
}

// Resolve o frete de um lançamento. Regra única antifraude (vale p/ todos os perfis):
// - frete_id informado → frete deve existir, pertencer ao motorista do lançamento
//   e estar aberto (ativo/pendente). Ownership é checado ANTES do status: frete de
//   outro motorista (ou sem motorista_id no banco) retorna sempre 422, sem revelar
//   se está ativo ou encerrado;
// - frete_id vazio → busca viagens abertas do motorista:
//     0 → 409 (sem viagem ativa) | 1 → vincula automaticamente | >1 → 409 (ambíguo).
// Nunca lança exceção: erros viram { ok:false, http, message } para uso direto nos controllers.
async function resolverFreteParaLancamento(freteId, motoristaId) {
  if (freteId) {
    const check = await checarFreteAberto(freteId);
    if (check.notFound) return { ok: false, http: 404, message: 'Frete não encontrado.' };
    if (check.motoristaId !== motoristaId) {
      return { ok: false, http: 422, message: 'O frete informado não pertence a este motorista.' };
    }
    if (check.encerrado) {
      const palavra = check.status === 'cancelado' ? 'cancelada' : 'finalizada';
      return { ok: false, http: 409, message: `Não é possível lançar em uma viagem ${palavra}.` };
    }
    return { ok: true, freteId };
  }
  const { data, error } = await supabase
    .from('fretes')
    .select('id')
    .eq('motorista_id', motoristaId)
    .in('status', ['ativo', 'pendente']);
  if (error) return { ok: false, http: 500, message: 'Erro ao validar a viagem do lançamento.' };
  const abertos = data || [];
  if (abertos.length === 0) {
    return { ok: false, http: 409, message: 'Não há viagem ativa para este motorista. Inicie um frete antes de lançar.' };
  }
  if (abertos.length > 1) {
    return { ok: false, http: 409, message: 'Há mais de uma viagem ativa para este motorista. Selecione a viagem no lançamento.' };
  }
  return { ok: true, freteId: abertos[0].id, vinculadoAutomaticamente: true };
}

module.exports = { checarFreteAberto, resolverFreteParaLancamento, STATUS_ENCERRADOS };
