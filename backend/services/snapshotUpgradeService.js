// Snapshot comercial de UPGRADE/ADD-ONS (Portal Comercial Self-Service).
//
// PURO (sem I/O): recebe os planos e a matriz de disponibilidade/preços já
// carregados e devolve o "snapshot de valores" para a tela do cliente comparar:
//   plano atual × plano alvo, add-ons selecionados, subtotais, total, diferença,
//   recomendação de custo-benefício e o texto de "próxima fatura/ciclo".
//
// PREÇO POR FUNCIONALIDADE (V2 — corrige o preço fabricado de ERP/SSO):
//   O preço de um add-on NÃO é mais uma constante global aplicada a tudo que é
//   `opcional_paga`. Ele é resolvido por funcionalidade, na ordem:
//     1) plano_funcionalidades.preco_especifico_centavos (override do plano);
//     2) funcionalidades.preco_padrao_centavos (preço padrão APROVADO da feature);
//     3) senão → SOB PROPOSTA (preço desconhecido; NÃO se inventa valor).
//   Assim, `estrutura_operacional` (com preço padrão aprovado) tem valor de tabela,
//   enquanto ERP/SSO sem preço aprovado aparecem como "valor sob proposta" — nunca
//   um R$ 149,90 fabricado (decisão do proprietário, ver §27/§29 do prompt).
//
// Regras da frente (inalteradas): NÃO gera cobrança, NÃO muda plano_id, NÃO ativa
// entitlement/capacidade; a recomendação é INFORMATIVA; ERP/SSO em preparação
// seguem SOLICITÁVEIS mas rotulados "integração em preparação" (nunca "ativo").

const { calcularCustoPlano } = require('./calculadoraComercialService');

// Preço padrão de referência de um add-on padrão (ex.: Estrutura operacional),
// usado apenas como rótulo informativo/legado quando a feature não traz o seu
// próprio preço. NÃO é mais aplicado cegamente a ERP/SSO.
const ADDON_PADRAO_CENTAVOS = 14990;

const REAL = (centavos) => (centavos == null ? null : Number((centavos / 100).toFixed(2)));

// Situação comercial de um add-on (a partir da disponibilidade do catálogo).
//   incluido      → já faz parte do plano (valor 0)
//   adicional     → contratável como add-on (preço da feature)
//   sob_proposta  → negociação / sem preço de tabela
//   indisponivel  → não ofertado nesse plano
function situacaoAddon(disponibilidade) {
  switch (disponibilidade) {
    case 'incluida': return 'incluido';
    case 'opcional_paga': return 'adicional';
    case 'sob_negociacao': return 'sob_proposta';
    default: return 'indisponivel';
  }
}

// price_status canônico por add-on (§71): não sobrecarrega `null` com 3 sentidos.
const PRICE_STATUS = Object.freeze({
  INCLUDED: 'INCLUDED',
  KNOWN: 'KNOWN',
  UNDER_PROPOSAL: 'UNDER_PROPOSAL',
  NOT_AVAILABLE: 'NOT_AVAILABLE',
});

// Resolve o preço (em centavos) de um add-on num plano, e o price_status.
//   incluida → INCLUDED (0)
//   opcional_paga → preço especifico ?? padrao; se houver → KNOWN, senão UNDER_PROPOSAL
//   sob_negociacao → UNDER_PROPOSAL (sem preço de tabela)
//   indisponivel → NOT_AVAILABLE
function resolverPrecoAddon(disponibilidade, { precoEspecificoCentavos = null, precoPadraoCentavos = null } = {}) {
  const sit = situacaoAddon(disponibilidade);
  if (sit === 'incluido') return { situacao: sit, price_status: PRICE_STATUS.INCLUDED, valorCentavos: 0 };
  if (sit === 'adicional') {
    const preco = Number.isFinite(precoEspecificoCentavos) ? precoEspecificoCentavos
      : (Number.isFinite(precoPadraoCentavos) ? precoPadraoCentavos : null);
    if (preco != null && preco > 0) {
      return { situacao: 'adicional', price_status: PRICE_STATUS.KNOWN, valorCentavos: preco };
    }
    // opcional_paga SEM preço aprovado → sob proposta (não inventa valor). A UI
    // mostra o card como "sob proposta"; a solicitação persiste preço null.
    return { situacao: 'sob_proposta', price_status: PRICE_STATUS.UNDER_PROPOSAL, valorCentavos: null };
  }
  if (sit === 'sob_proposta') {
    return { situacao: 'sob_proposta', price_status: PRICE_STATUS.UNDER_PROPOSAL, valorCentavos: null };
  }
  return { situacao: 'indisponivel', price_status: PRICE_STATUS.NOT_AVAILABLE, valorCentavos: null };
}

// status técnico (§72): separado do comercial. status_ciclo_vida != 'disponivel'
// → em preparação (nunca "ativo/pronto").
function technicalStatus(emBreve) {
  return emBreve ? 'PREPARING' : 'AVAILABLE';
}

// Estado de atenção da capacidade (§12). Baseado em CONTAGEM real, não em
// porcentagem arbitrária: 'ilimitado' (sem limite), 'acima' (legado > limite),
// 'no_limite' (usados == limite), 'proximo' (última vaga: usados == limite-1) e
// 'confortavel' (demais). PURO.
function estadoCapacidade(usados, limite) {
  if (limite == null) return 'ilimitado';
  const u = Number(usados) || 0;
  const l = Number(limite);
  if (u > l) return 'acima';
  if (u === l) return 'no_limite';
  if (u === l - 1) return 'proximo';
  return 'confortavel';
}

function custoPlanoCentavos(plano, quantidade) {
  const c = calcularCustoPlano({ plano, quantidade });
  if (!c.ok || c.requer_negociacao || !c.acomoda || c.total_centavos == null) return null;
  return c.total_centavos;
}

// Soma dos add-ons SELECIONADOS num plano. Só entram valores KNOWN; qualquer add-on
// selecionado UNDER_PROPOSAL marca `temSobProposta` (o total vira incompleto e NÃO
// se calcula economia — §30/§32).
function subtotalAddons({ selecionados, resolvidosPorCodigo }) {
  let total = 0;
  let temSobProposta = false;
  for (const codigo of selecionados) {
    const r = resolvidosPorCodigo.get(codigo);
    if (!r) continue;
    if (r.price_status === PRICE_STATUS.KNOWN) total += r.valorCentavos;
    else if (r.price_status === PRICE_STATUS.UNDER_PROPOSAL) temSobProposta = true;
    // INCLUDED soma 0; NOT_AVAILABLE não deveria estar selecionado (UI bloqueia).
  }
  return { totalCentavos: total, temSobProposta };
}

// Monta o snapshot. `addons` = catálogo [{ codigo, nome, em_breve, preco_padrao_centavos }].
// `dispAtual`/`dispAlvo` = Map(codigo -> disponibilidade). `precoEspecificoAtual`/
// `precoEspecificoAlvo` = Map(codigo -> centavos|null) (override por plano).
function montarSnapshotUpgrade({
  planoAtual,
  planoAlvo = null,
  quantidade = 1,
  addons = [],
  selecionados = [],
  dispAtual = new Map(),
  dispAlvo = new Map(),
  precoEspecificoAtual = new Map(),
  precoEspecificoAlvo = new Map(),
} = {}) {
  if (!planoAtual || !planoAtual.id) {
    return { ok: false, motivo: 'plano_atual_ausente', message: 'Plano atual não identificado.' };
  }
  const selSet = new Set(selecionados);
  const temAlvo = Boolean(planoAlvo && planoAlvo.id && planoAlvo.id !== planoAtual.id);

  const padraoPorCodigo = new Map(
    addons.map((a) => [a.codigo, Number.isFinite(a.preco_padrao_centavos) ? a.preco_padrao_centavos : null]),
  );

  // Resolve cada add-on no plano atual e no alvo.
  const resolvAtual = new Map();
  const resolvAlvo = new Map();
  for (const a of addons) {
    resolvAtual.set(a.codigo, resolverPrecoAddon(dispAtual.get(a.codigo), {
      precoEspecificoCentavos: precoEspecificoAtual.get(a.codigo) ?? null,
      precoPadraoCentavos: padraoPorCodigo.get(a.codigo),
    }));
    if (temAlvo) {
      resolvAlvo.set(a.codigo, resolverPrecoAddon(dispAlvo.get(a.codigo), {
        precoEspecificoCentavos: precoEspecificoAlvo.get(a.codigo) ?? null,
        precoPadraoCentavos: padraoPorCodigo.get(a.codigo),
      }));
    }
  }

  const planoAtualCentavos = custoPlanoCentavos(planoAtual, quantidade);
  const addonsAtual = subtotalAddons({ selecionados: selSet, resolvidosPorCodigo: resolvAtual });

  let planoAlvoCentavos = null;
  let addonsAlvo = { totalCentavos: 0, temSobProposta: false };
  if (temAlvo) {
    planoAlvoCentavos = custoPlanoCentavos(planoAlvo, quantidade);
    addonsAlvo = subtotalAddons({ selecionados: selSet, resolvidosPorCodigo: resolvAlvo });
  }

  // Negociação (plano 41+ ou add-on selecionado sob proposta) → total incompleto:
  // NÃO se fabrica total nem economia (§30/§32).
  const requerNegociacao = planoAlvo?.requer_negociacao === true
    || addonsAtual.temSobProposta || addonsAlvo.temSobProposta;

  const totalAtualCentavos = (planoAtualCentavos == null || addonsAtual.temSobProposta)
    ? null : planoAtualCentavos + addonsAtual.totalCentavos;
  const totalAlvoCentavos = !temAlvo ? null
    : ((planoAlvoCentavos == null || addonsAlvo.temSobProposta) ? null : planoAlvoCentavos + addonsAlvo.totalCentavos);

  // Linhas de add-on para a UI (situação + valor + contratos estruturados).
  const linhasAddons = addons.map((a) => {
    const rA = resolvAtual.get(a.codigo);
    const rL = temAlvo ? resolvAlvo.get(a.codigo) : null;
    const emBreve = a.em_breve === true;
    const commercial = (sit) => (sit === 'incluido' ? 'INCLUDED'
      : sit === 'adicional' ? 'OPTIONAL_PAID'
      : sit === 'sob_proposta' ? 'UNDER_PROPOSAL' : 'UNAVAILABLE');
    return {
      codigo: a.codigo,
      nome: a.nome,
      em_breve: emBreve,
      technical_status: technicalStatus(emBreve),
      selecionado: selSet.has(a.codigo),
      atual: {
        situacao: rA.situacao,
        valor_mensal: REAL(rA.valorCentavos),
        price_status: rA.price_status,
        commercial_status: commercial(rA.situacao),
      },
      alvo: temAlvo ? {
        situacao: rL.situacao,
        valor_mensal: REAL(rL.valorCentavos),
        price_status: rL.price_status,
        commercial_status: commercial(rL.situacao),
      } : null,
    };
  });

  // Recomendação de custo-benefício.
  let recomendacao;
  if (requerNegociacao) {
    recomendacao = { tipo: 'sob_proposta', mensagem: 'Parte do que você selecionou é sob proposta. É necessário falar com o comercial para comparar o valor final.' };
  } else if (totalAlvoCentavos != null && totalAtualCentavos != null && totalAlvoCentavos <= totalAtualCentavos) {
    recomendacao = { tipo: 'subir_plano', mensagem: `Com os serviços selecionados, o plano ${planoAlvo.nome} pode ser mais vantajoso porque já inclui parte desses recursos.` };
  } else {
    recomendacao = { tipo: 'manter_plano_addon', mensagem: 'Adicionar estes serviços ao seu plano atual ainda é a opção mais econômica.' };
  }

  // Diferença/economia só quando ambos os totais são conhecidos (§32: sem economia fantasma).
  const diferencaCentavos = (totalAlvoCentavos != null && totalAtualCentavos != null)
    ? totalAlvoCentavos - totalAtualCentavos
    : null;

  return {
    ok: true,
    snapshot: {
      quantidade_motoristas: Number(quantidade) || null,
      plano_atual: {
        id: planoAtual.id,
        nome: planoAtual.nome || null,
        valor_mensal: REAL(planoAtualCentavos),
        capacidade_inclusa: planoAtual.capacidade_inclusa ?? planoAtual.limite_motoristas ?? null,
      },
      plano_alvo: temAlvo ? {
        id: planoAlvo.id,
        nome: planoAlvo.nome || null,
        valor_mensal: REAL(planoAlvoCentavos),
        capacidade_inclusa: planoAlvo.capacidade_inclusa ?? planoAlvo.limite_motoristas ?? null,
        requer_negociacao: planoAlvo.requer_negociacao === true,
      } : null,
      add_ons: linhasAddons,
      add_on_valor_padrao: REAL(ADDON_PADRAO_CENTAVOS),
      subtotal_plano_atual: REAL(planoAtualCentavos),
      subtotal_addons_atual: REAL(addonsAtual.totalCentavos),
      total_atual: REAL(totalAtualCentavos),
      total_atual_incompleto: addonsAtual.temSobProposta === true,
      subtotal_plano_alvo: REAL(planoAlvoCentavos),
      subtotal_addons_alvo: temAlvo ? REAL(addonsAlvo.totalCentavos) : null,
      total_alvo: REAL(totalAlvoCentavos),
      total_alvo_incompleto: temAlvo ? addonsAlvo.temSobProposta === true : false,
      diferenca_mensal: REAL(diferencaCentavos),
      recomendacao,
      proxima_fatura: {
        gera_cobranca_agora: false,
        texto: 'Nenhuma cobrança é gerada agora. Se aprovada, a alteração é refletida na próxima fatura/ciclo.',
      },
    },
  };
}

module.exports = {
  ADDON_PADRAO_CENTAVOS,
  PRICE_STATUS,
  situacaoAddon,
  resolverPrecoAddon,
  estadoCapacidade,
  montarSnapshotUpgrade,
};
