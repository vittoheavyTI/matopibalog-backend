'use strict';

// partnerRouteSummary — origem e destino da campanha, em linguagem humana.
//
// HIGH-08. A versão anterior mandava `origem_resumo: null` e `destino_resumo:
// null`, o que contradizia o próprio caminho feliz da frente: um parceiro não
// consegue dizer se tem capacidade sem saber de onde para onde a carga vai.
//
// A rota é DERIVADA da autoridade canônica — `campaign_demands` →
// `campaign_locations` — e nunca perguntada de novo ao operador (§23). Se o dado
// não existir, o resumo é `null`: não se inventa string.
//
// O que NÃO sai daqui: id de local, unidade operacional, coordenada, endereço
// completo, nome de cliente ou fazenda além do que já identifica o ponto. O
// parceiro precisa saber a praça, não o cadastro do dono da carga.

const MAX_NOMES = 2;

function erroDeBanco(error) {
  return error && error.code !== 'PGRST116';
}

/**
 * Resume a rota de uma campanha.
 *
 * Devolve `{ origem_resumo, destino_resumo, origens_total, destinos_total }`.
 * Um resumo com múltiplos pontos preserva a informação de que há mais — esconder
 * a contagem faria o parceiro achar que a operação é menor do que é.
 */
async function resumirRotaDaCampanha(supabase, { empresaId, campaignId }) {
  const vazio = { origem_resumo: null, destino_resumo: null, origens_total: 0, destinos_total: 0 };
  if (!empresaId || !campaignId) return vazio;

  const { data: demandas, error: erroDemandas } = await supabase
    .from('campaign_demands')
    .select('origin_location_id, destination_location_id')
    .eq('empresa_id', empresaId)
    .eq('campaign_id', campaignId);
  if (erroDeBanco(erroDemandas) || !demandas || demandas.length === 0) return vazio;

  // Uma consulta para todos os locais citados — não uma por demanda (§71).
  const ids = [...new Set(demandas.flatMap((d) => [d.origin_location_id, d.destination_location_id]).filter(Boolean))];
  if (ids.length === 0) return vazio;

  const { data: locais, error: erroLocais } = await supabase
    .from('campaign_locations')
    .select('id, kind, name')
    .eq('empresa_id', empresaId)
    .eq('campaign_id', campaignId)
    .in('id', ids);
  if (erroDeBanco(erroLocais) || !locais) return vazio;

  const nomePorId = new Map(locais.map((l) => [l.id, l.name]));

  // Ordem estável: a mesma campanha produz sempre o mesmo resumo, o que importa
  // porque o snapshot é imutável e será comparado ao longo do tempo.
  const origens = nomesUnicos(demandas.map((d) => nomePorId.get(d.origin_location_id)));
  const destinos = nomesUnicos(demandas.map((d) => nomePorId.get(d.destination_location_id)));

  return {
    origem_resumo: resumir(origens, 'origem', 'origens'),
    destino_resumo: resumir(destinos, 'destino', 'destinos'),
    origens_total: origens.length,
    destinos_total: destinos.length,
  };
}

function nomesUnicos(lista) {
  return [...new Set(lista.filter((n) => typeof n === 'string' && n.trim() !== ''))].sort();
}

// "Balsas/MA", "Balsas/MA e Riachão/MA", "Balsas/MA + 2 origens".
//
// O "+ N" existe para não esconder tamanho: um parceiro que lê só o primeiro
// ponto e descobre depois que eram cinco tem razão de se sentir enganado. O
// detalhe completo é decisão do E3.6B, quando houver compromisso de execução.
function resumir(nomes, singular, plural) {
  if (nomes.length === 0) return null;
  if (nomes.length <= MAX_NOMES) return nomes.join(' e ');
  const restantes = nomes.length - 1;
  return `${nomes[0]} + ${restantes} ${restantes === 1 ? singular : plural}`;
}

module.exports = { resumirRotaDaCampanha, resumir, MAX_NOMES };
