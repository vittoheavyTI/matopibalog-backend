// Snapshot comercial de UPGRADE/ADD-ONS (Fatia 1 — só cliente, sem cobrança).
//
// PURO (sem I/O): recebe os planos e a matriz de disponibilidade já carregados e
// devolve o "snapshot de valores" para a tela do cliente comparar:
//   plano atual × plano alvo, add-ons selecionados, subtotais, total, diferença,
//   recomendação de custo-benefício e o texto de "próxima fatura/ciclo".
//
// Regras da frente (decisões do proprietário):
//   - add-on padrão = R$ 149,90/mês (constante de código nesta fatia);
//   - NÃO gera cobrança, NÃO muda plano_id, NÃO ativa entitlement/capacidade;
//   - ERP/SSO em 'em_breve' seguem SOLICITÁVEIS comercialmente, mas com o rótulo
//     "integração em preparação" — nunca "ativo/conectado";
//   - a recomendação é INFORMATIVA (o cliente pode manter plano + add-on).

const { calcularCustoPlano, recomendarPlano } = require('./calculadoraComercialService');

// Valor padrão de um add-on padrão (Estrutura/ERP/SSO básico). Preliminar, em
// código — o catálogo editável pelo super-admin fica para a Fatia 2.
const ADDON_PADRAO_CENTAVOS = 14990;

const REAL = (centavos) => (centavos == null ? null : Number((centavos / 100).toFixed(2)));

// Situação comercial de um add-on em um plano, a partir da disponibilidade do
// catálogo (plano_funcionalidades.disponibilidade) e do status técnico.
//   incluido      → já faz parte do plano (valor 0)
//   adicional     → contratável como add-on (R$ 149,90)
//   sob_proposta  → negociação (sem valor de tabela)
//   indisponivel  → não ofertado nesse plano
function situacaoAddon(disponibilidade) {
  switch (disponibilidade) {
    case 'incluida': return 'incluido';
    case 'opcional_paga': return 'adicional';
    case 'sob_negociacao': return 'sob_proposta';
    default: return 'indisponivel';
  }
}

function custoPlanoCentavos(plano, quantidade) {
  const c = calcularCustoPlano({ plano, quantidade });
  if (!c.ok || c.requer_negociacao || !c.acomoda || c.total_centavos == null) return null;
  return c.total_centavos;
}

// Soma dos add-ons "adicional" SELECIONADOS em um dado plano (usando a
// disponibilidade daquele plano). Incluídos custam 0; sob_proposta/indisponível
// não entram no total (viram sinalização, não valor).
function subtotalAddons({ addons, selecionados, dispPorCodigo }) {
  let total = 0;
  let temSobProposta = false;
  for (const codigo of selecionados) {
    const disp = dispPorCodigo.get(codigo);
    const sit = situacaoAddon(disp);
    if (sit === 'adicional') total += ADDON_PADRAO_CENTAVOS;
    else if (sit === 'sob_proposta') temSobProposta = true;
  }
  return { totalCentavos: total, temSobProposta };
}

// Monta o snapshot. `addons` = catálogo [{ codigo, nome, em_breve }].
// `dispAtual`/`dispAlvo` = Map(codigo -> disponibilidade) do plano atual/alvo.
function montarSnapshotUpgrade({
  planoAtual,
  planoAlvo = null,
  quantidade = 1,
  addons = [],
  selecionados = [],
  dispAtual = new Map(),
  dispAlvo = new Map(),
} = {}) {
  if (!planoAtual || !planoAtual.id) {
    return { ok: false, motivo: 'plano_atual_ausente', message: 'Plano atual não identificado.' };
  }
  const selSet = new Set(selecionados);

  const planoAtualCentavos = custoPlanoCentavos(planoAtual, quantidade);
  const addonsAtual = subtotalAddons({ addons, selecionados: selSet, dispPorCodigo: dispAtual });
  const totalAtualCentavos = planoAtualCentavos == null ? null : planoAtualCentavos + addonsAtual.totalCentavos;

  let planoAlvoCentavos = null;
  let addonsAlvo = { totalCentavos: 0, temSobProposta: false };
  let totalAlvoCentavos = null;
  if (planoAlvo && planoAlvo.id && planoAlvo.id !== planoAtual.id) {
    planoAlvoCentavos = custoPlanoCentavos(planoAlvo, quantidade);
    addonsAlvo = subtotalAddons({ addons, selecionados: selSet, dispPorCodigo: dispAlvo });
    totalAlvoCentavos = planoAlvoCentavos == null ? null : planoAlvoCentavos + addonsAlvo.totalCentavos;
  }

  // Linhas de add-on para a UI (status no plano atual e no alvo + valor).
  const linhasAddons = addons.map((a) => {
    const sitAtual = situacaoAddon(dispAtual.get(a.codigo));
    const sitAlvo = planoAlvo ? situacaoAddon(dispAlvo.get(a.codigo)) : null;
    const valorSe = (sit) => (sit === 'adicional' ? REAL(ADDON_PADRAO_CENTAVOS) : sit === 'incluido' ? 0 : null);
    return {
      codigo: a.codigo,
      nome: a.nome,
      em_breve: a.em_breve === true,
      selecionado: selSet.has(a.codigo),
      atual: { situacao: sitAtual, valor_mensal: valorSe(sitAtual) },
      alvo: planoAlvo ? { situacao: sitAlvo, valor_mensal: valorSe(sitAlvo) } : null,
    };
  });

  // Recomendação de custo-benefício. Se há plano alvo e o total no alvo (que pode
  // incluir add-ons de graça) for <= total atual, sugere subir. Caso contrário,
  // manter plano + add-on. Negociação/sob proposta → falar com comercial.
  const requerNegociacao = planoAlvo?.requer_negociacao === true
    || addonsAtual.temSobProposta || addonsAlvo.temSobProposta;
  let recomendacao;
  if (requerNegociacao) {
    recomendacao = { tipo: 'sob_proposta', mensagem: 'Parte do que você selecionou é sob proposta. Fale com o comercial para uma condição personalizada.' };
  } else if (totalAlvoCentavos != null && totalAtualCentavos != null && totalAlvoCentavos <= totalAtualCentavos) {
    recomendacao = { tipo: 'subir_plano', mensagem: `Com os serviços selecionados, o plano ${planoAlvo.nome} pode ser mais vantajoso porque já inclui parte desses recursos.` };
  } else {
    recomendacao = { tipo: 'manter_plano_addon', mensagem: 'Adicionar estes serviços ao seu plano atual ainda é a opção mais econômica.' };
  }

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
      plano_alvo: planoAlvo && planoAlvo.id !== planoAtual.id ? {
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
      subtotal_plano_alvo: REAL(planoAlvoCentavos),
      subtotal_addons_alvo: planoAlvo ? REAL(addonsAlvo.totalCentavos) : null,
      total_alvo: REAL(totalAlvoCentavos),
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
  situacaoAddon,
  montarSnapshotUpgrade,
};
