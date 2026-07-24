// backend/services/calculadoraComercialService.js
// MEGA-FRENTE Billing Comercial Avançado — FASE 2/3: regras PURAS de cálculo
// comercial (base + capacidade inclusa + motorista/caminhão extra) e RECOMENDAÇÃO
// de plano mais barato. Sem I/O: não toca banco, não fala com o Asaas, não cria
// fatura, não importa supabase — mesmo estilo testável de planoPrecoService,
// upgradeDomainService e faturaRecorrenteDomainService.
//
// POR QUE ESTE MÓDULO EXISTE (o que o modelo atual NÃO expressa)
// ---------------------------------------------------------------
// Hoje um plano tem dois modelos (planoPrecoService):
//   * 'fixo'          → preco_mensal digitado;
//   * 'por_motorista' → preco_mensal = preco_por_motorista × limite_motoristas
//                       (LINEAR e sem base: 10 motoristas custam 10× o unitário).
// O modelo comercial novo é OUTRO: uma BASE que já inclui N motoristas, e um preço
// de EXTRA só para quem passa de N. Ex.: Empresa Start = R$ 299,90 já com 5
// inclusos; o 6º motorista custa +R$ 100,00. Nem 'fixo' nem 'por_motorista'
// descrevem isso — por isso a conta mora aqui, e os campos novos do plano
// (capacidade_inclusa, preco_motorista_extra) são aditivos (ver migration 038).
//
// REGRA CENTRAL (a mesma do resto do billing — não reinterpretar):
//   O backend é a autoridade e a conta é feita em CENTAVOS INTEIROS. A conversão
//   monetária → centavos é REAPROVEITADA de planoPrecoService.paraCentavos (fonte
//   única): valor com mais de 2 casas é RECUSADO, nunca arredondado (a coluna é
//   numeric(10,2) e o Postgres arredondaria em silêncio).
//
// FRONTEIRA COM O BANCO / CATÁLOGO
//   Este módulo é GENÉRICO: recebe o(s) plano(s) já carregado(s) e a quantidade
//   desejada, e devolve custo/recomendação. Ele NÃO embute a tabela comercial
//   (Start/Essencial/Growth/Scale) — esses números vêm do catálogo (tabela
//   `planos`, com os campos novos) e, nos testes, de fixtures. Assim a decisão
//   sobre dinheiro é provável sem rede/DB, e trocar preços não exige tocar código.
//
// NEGOCIAÇÃO 41+ (decisão comercial explícita do prompt)
//   Acima de LIMITE_NEGOCIACAO_PADRAO (40) motoristas/caminhões, não há preço de
//   tabela: é "sob proposta". O cálculo retorna requer_negociacao=true e NÃO
//   inventa um valor. O teto é global por padrão, mas sobrescrevível por plano
//   (plano.limite_negociacao) sem migration.

const { paraCentavos } = require('./planoPrecoService');

// ─── Política comercial (ajustável sem migration) ────────────────────────────
// Acima disto, 41+ → negociação/sob proposta (decisão do prompt). Global por
// padrão; um plano pode declarar o seu próprio teto em `limite_negociacao`.
const LIMITE_NEGOCIACAO_PADRAO = 40;

// Motivos estáveis (para log/telemetria e mensagens de UI).
const MOTIVOS = Object.freeze({
  OK: 'ok',
  QUANTIDADE_INVALIDA: 'quantidade_invalida',
  BASE_INVALIDA: 'base_invalida',
  EXTRA_INVALIDO: 'extra_invalido',
  CAPACIDADE_INVALIDA: 'capacidade_invalida',
  REQUER_NEGOCIACAO: 'requer_negociacao',
  EXCEDE_SEM_EXTRA: 'excede_capacidade_sem_extra',
});

function formatarBRL(valor) {
  return `R$ ${Number(valor).toFixed(2).replace('.', ',')}`;
}

function falha(motivo, message, extra = {}) {
  return { ok: false, motivo, message, ...extra };
}

// Quantidade desejada de motoristas/caminhões. EXIGIDA como inteiro >= 1.
// String ('7') é recusada de propósito: quem chama normaliza o tipo antes (a
// rota faz Number(...)); string aqui denuncia caller esquecido, num campo que
// multiplica dinheiro. Mesmo contrato de planoPrecoService.validarQuantidade.
function validarQuantidade(quantidade) {
  if (quantidade === undefined || quantidade === null) {
    return falha(MOTIVOS.QUANTIDADE_INVALIDA, 'Informe a quantidade de motoristas/caminhões desejada.');
  }
  if (typeof quantidade !== 'number' || !Number.isInteger(quantidade)) {
    return falha(MOTIVOS.QUANTIDADE_INVALIDA, 'A quantidade deve ser um número inteiro.');
  }
  if (quantidade < 1) {
    return falha(MOTIVOS.QUANTIDADE_INVALIDA, 'A quantidade deve ser de pelo menos 1.');
  }
  return { ok: true, quantidade };
}

// Capacidade inclusa na base do plano. Aditivo: quando ausente, cai para
// limite_motoristas (o "contratado" de hoje) — assim um plano legado, sem os
// campos novos, se comporta exatamente como antes (base cobre até o limite, sem
// extras). Exige inteiro >= 1.
function resolverCapacidadeInclusa(plano) {
  const p = plano || {};
  let cap = p.capacidade_inclusa;
  if (cap === undefined || cap === null) cap = p.limite_motoristas;
  const n = typeof cap === 'string' && cap.trim() !== '' ? Number(cap) : cap;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
    return falha(MOTIVOS.CAPACIDADE_INVALIDA, 'Plano sem capacidade inclusa válida.');
  }
  return { ok: true, capacidade_inclusa: n };
}

// Preço do motorista/caminhão EXTRA. NULL/ausente = plano NÃO admite extras
// (autônomo, ou plano de valor fixo): quem passa da capacidade inclusa simplesmente
// não cabe (o recomendador aponta outro plano). Quando presente, precisa ser um
// valor monetário válido e > 0.
function resolverPrecoExtra(plano) {
  const p = plano || {};
  const bruto = p.preco_motorista_extra;
  if (bruto === undefined || bruto === null || bruto === '') {
    return { ok: true, admite_extra: false, extra_centavos: null };
  }
  const c = paraCentavos(bruto);
  if (!c.ok) {
    return falha(MOTIVOS.EXTRA_INVALIDO, 'Preço do motorista extra inválido (máx. 2 casas decimais).');
  }
  if (c.centavos <= 0) {
    return falha(MOTIVOS.EXTRA_INVALIDO, 'O preço do motorista extra deve ser maior que zero.');
  }
  return { ok: true, admite_extra: true, extra_centavos: c.centavos };
}

// Teto de negociação efetivo do plano (global por padrão, sobrescrevível).
function tetoNegociacao(plano, limiteNegociacao) {
  const doPlano = plano && plano.limite_negociacao;
  if (typeof doPlano === 'number' && Number.isInteger(doPlano) && doPlano >= 1) return doPlano;
  if (typeof limiteNegociacao === 'number' && Number.isInteger(limiteNegociacao) && limiteNegociacao >= 1) {
    return limiteNegociacao;
  }
  return LIMITE_NEGOCIACAO_PADRAO;
}

// ─── Núcleo: custo de UM plano para UMA quantidade ───────────────────────────
// Sucesso  → { ok:true, acomoda, requer_negociacao, total, total_centavos,
//              base, extras_qtd, extra_unitario, extras_valor, capacidade_inclusa }
// Falha    → { ok:false, motivo, message }
//
// `acomoda=false` NÃO é erro: significa "este plano não serve para essa
// quantidade" (ex.: autônomo pedindo 3, ou base sem extra estourada). O
// recomendador usa isso para descartar candidatos sem quebrar.
//
// `requer_negociacao=true` (quantidade > teto): total fica null de propósito —
// não se inventa preço fora da tabela.
function calcularCustoPlano({ plano, quantidade, limiteNegociacao } = {}) {
  const q = validarQuantidade(quantidade);
  if (!q.ok) return q;

  const base = paraCentavos(plano && plano.preco_mensal);
  if (!base.ok || base.centavos < 0) {
    return falha(MOTIVOS.BASE_INVALIDA, 'Plano sem preço base válido.');
  }

  const cap = resolverCapacidadeInclusa(plano);
  if (!cap.ok) return cap;

  const extra = resolverPrecoExtra(plano);
  if (!extra.ok) return extra;

  const teto = tetoNegociacao(plano, limiteNegociacao);

  // Acima do teto comercial: sob proposta. Não há valor de tabela.
  if (q.quantidade > teto) {
    return {
      ok: true,
      acomoda: false,
      requer_negociacao: true,
      motivo: MOTIVOS.REQUER_NEGOCIACAO,
      total: null,
      total_centavos: null,
      base: base.centavos / 100,
      capacidade_inclusa: cap.capacidade_inclusa,
      extras_qtd: 0,
      extra_unitario: extra.admite_extra ? extra.extra_centavos / 100 : null,
      extras_valor: 0,
      limite_negociacao: teto,
    };
  }

  // Cabe na base (sem extras).
  if (q.quantidade <= cap.capacidade_inclusa) {
    return {
      ok: true,
      acomoda: true,
      requer_negociacao: false,
      motivo: MOTIVOS.OK,
      total: base.centavos / 100,
      total_centavos: base.centavos,
      base: base.centavos / 100,
      capacidade_inclusa: cap.capacidade_inclusa,
      extras_qtd: 0,
      extra_unitario: extra.admite_extra ? extra.extra_centavos / 100 : null,
      extras_valor: 0,
      limite_negociacao: teto,
    };
  }

  // Passou da capacidade inclusa, mas o plano não admite extras → não acomoda.
  if (!extra.admite_extra) {
    return {
      ok: true,
      acomoda: false,
      requer_negociacao: false,
      motivo: MOTIVOS.EXCEDE_SEM_EXTRA,
      total: null,
      total_centavos: null,
      base: base.centavos / 100,
      capacidade_inclusa: cap.capacidade_inclusa,
      extras_qtd: q.quantidade - cap.capacidade_inclusa,
      extra_unitario: null,
      extras_valor: 0,
      limite_negociacao: teto,
    };
  }

  // Base + extras (tudo em centavos inteiros).
  const extrasQtd = q.quantidade - cap.capacidade_inclusa;
  const extrasCentavos = extrasQtd * extra.extra_centavos;
  const totalCentavos = base.centavos + extrasCentavos;

  return {
    ok: true,
    acomoda: true,
    requer_negociacao: false,
    motivo: MOTIVOS.OK,
    total: totalCentavos / 100,
    total_centavos: totalCentavos,
    base: base.centavos / 100,
    capacidade_inclusa: cap.capacidade_inclusa,
    extras_qtd: extrasQtd,
    extra_unitario: extra.extra_centavos / 100,
    extras_valor: extrasCentavos / 100,
    limite_negociacao: teto,
  };
}

// ─── Snapshot comercial (para congelar na fatura, migration 030 + 038) ───────
// Espelha a composição do preço no ato da cobrança. NÃO é I/O — só o objeto.
// Congela também a RECOMENDAÇÃO (se houve), para trilha de auditoria comercial.
function montarSnapshotComercial({ plano, quantidade, limiteNegociacao, planoRecomendadoId = null }) {
  const custo = calcularCustoPlano({ plano, quantidade, limiteNegociacao });
  if (!custo.ok) return { ok: false, motivo: custo.motivo, message: custo.message };
  return {
    ok: true,
    snapshot: {
      capacidade_contratada_snapshot: Number(quantidade),
      capacidade_inclusa_snapshot: custo.capacidade_inclusa,
      extras_qtd_snapshot: custo.extras_qtd,
      extra_unitario_snapshot: custo.extra_unitario,
      requer_negociacao_snapshot: custo.requer_negociacao === true,
      plano_recomendado_id_snapshot: planoRecomendadoId || null,
    },
  };
}

// ─── Recomendação: qual plano sai mais barato para a quantidade desejada ──────
// PURA. Recebe o catálogo de candidatos já carregado (ex.: planos de empresa
// ativos) e devolve, no formato do prompt:
//   { planoAtual, quantidadeDesejada, valorComExtras, planoRecomendado,
//     valorPlanoRecomendado, economia, requerNegociacao, mensagem, opcoes }
//
// Regra de escolha:
//   * só entram candidatos que ACOMODAM a quantidade (acomoda=true);
//   * vence o MENOR total (comparado em centavos, nunca float);
//   * EMPATE (mesmo total) → vence a maior capacidade_inclusa (mais folga pelo
//     mesmo preço). Isso NÃO muda preço nenhum — é só desempate a favor do
//     cliente, e vem sinalizado (empate=true, economia=0).
//   * `economia` só é > 0 quando o recomendado é ESTRITAMENTE mais barato que o
//     plano atual. Sem plano atual (ou atual não acomoda), economia fica null.
//
// 41+ (acima do teto): requerNegociacao=true e NÃO se elege recomendado — não há
// preço de tabela para comparar.
function recomendarPlano({ planos, quantidade, planoAtualId = null, limiteNegociacao } = {}) {
  const q = validarQuantidade(quantidade);
  if (!q.ok) {
    return { ok: false, motivo: q.motivo, message: q.message };
  }

  const catalogo = Array.isArray(planos) ? planos : [];
  const teto = tetoNegociacao(null, limiteNegociacao);

  // Custo de cada candidato.
  const opcoes = catalogo
    .filter((p) => p && p.id)
    .map((p) => {
      const custo = calcularCustoPlano({ plano: p, quantidade: q.quantidade, limiteNegociacao });
      return {
        plano_id: p.id,
        plano_nome: p.nome != null ? String(p.nome) : null,
        acomoda: custo.ok ? custo.acomoda === true : false,
        requer_negociacao: custo.ok ? custo.requer_negociacao === true : false,
        total: custo.ok ? custo.total : null,
        total_centavos: custo.ok ? custo.total_centavos : null,
        extras_qtd: custo.ok ? custo.extras_qtd : null,
        extra_unitario: custo.ok ? custo.extra_unitario : null,
      };
    });

  // Plano atual (se informado e presente no catálogo).
  const atual = planoAtualId ? opcoes.find((o) => o.plano_id === planoAtualId) : null;
  const valorComExtras = atual && atual.acomoda ? atual.total : null;
  const valorComExtrasCentavos = atual && atual.acomoda ? atual.total_centavos : null;

  // 41+ acima do teto: sob proposta. Recomendação de tabela não se aplica.
  if (q.quantidade > teto) {
    return {
      ok: true,
      planoAtual: planoAtualId || null,
      quantidadeDesejada: q.quantidade,
      valorComExtras,
      planoRecomendado: null,
      valorPlanoRecomendado: null,
      economia: null,
      requerNegociacao: true,
      mensagem:
        `Acima de ${teto} motoristas/caminhões o valor é sob proposta. ` +
        'Fale com o suporte para uma negociação personalizada.',
      opcoes,
    };
  }

  // Candidatos que acomodam, ordenados por total (asc) e, em empate, por maior
  // capacidade inclusa (desempate a favor do cliente — mais folga, mesmo preço).
  const capInclusa = new Map(
    catalogo.filter((p) => p && p.id).map((p) => {
      const cap = resolverCapacidadeInclusa(p);
      return [p.id, cap.ok ? cap.capacidade_inclusa : -1];
    }),
  );
  const elegiveis = opcoes
    .filter((o) => o.acomoda && o.total_centavos != null)
    .sort((a, b) => {
      if (a.total_centavos !== b.total_centavos) return a.total_centavos - b.total_centavos;
      return (capInclusa.get(b.plano_id) || 0) - (capInclusa.get(a.plano_id) || 0);
    });

  const melhor = elegiveis[0] || null;

  if (!melhor) {
    // Nenhum plano de tabela acomoda (todos estouraram sem extra). Trata como
    // caso de negociação/atenção — não inventa preço.
    return {
      ok: true,
      planoAtual: planoAtualId || null,
      quantidadeDesejada: q.quantidade,
      valorComExtras,
      planoRecomendado: null,
      valorPlanoRecomendado: null,
      economia: null,
      requerNegociacao: false,
      mensagem: 'Nenhum plano de tabela acomoda essa quantidade. Verifique com o suporte.',
      opcoes,
    };
  }

  // Economia só existe frente a um plano atual que acomoda.
  let economia = null;
  let empate = false;
  if (valorComExtrasCentavos != null) {
    const diff = valorComExtrasCentavos - melhor.total_centavos;
    economia = diff > 0 ? diff / 100 : 0;
    empate = diff === 0 && melhor.plano_id !== planoAtualId;
  }

  const ehMesmoPlano = melhor.plano_id === planoAtualId;

  let mensagem;
  if (ehMesmoPlano) {
    mensagem = `Seu plano atual já é a opção mais econômica para ${q.quantidade} — ${formatarBRL(melhor.total)}/mês.`;
  } else if (economia != null && economia > 0) {
    mensagem =
      `Migrar para "${melhor.plano_nome}" sai mais barato: ${formatarBRL(melhor.total)}/mês ` +
      `contra ${formatarBRL(valorComExtras)}/mês no plano atual — economia de ${formatarBRL(economia)}/mês.`;
  } else if (empate) {
    mensagem =
      `"${melhor.plano_nome}" custa o mesmo (${formatarBRL(melhor.total)}/mês) e inclui mais ` +
      'capacidade — vale migrar para ter folga sem custo extra.';
  } else {
    mensagem = `Plano recomendado para ${q.quantidade}: "${melhor.plano_nome}" — ${formatarBRL(melhor.total)}/mês.`;
  }

  return {
    ok: true,
    planoAtual: planoAtualId || null,
    quantidadeDesejada: q.quantidade,
    valorComExtras,
    planoRecomendado: melhor.plano_id,
    planoRecomendadoNome: melhor.plano_nome,
    valorPlanoRecomendado: melhor.total,
    economia,
    empate,
    requerNegociacao: false,
    mensagem,
    opcoes,
  };
}

module.exports = {
  LIMITE_NEGOCIACAO_PADRAO,
  MOTIVOS,
  calcularCustoPlano,
  recomendarPlano,
  montarSnapshotComercial,
  // exportados para teste isolado
  validarQuantidade,
  resolverCapacidadeInclusa,
  resolverPrecoExtra,
  tetoNegociacao,
};
