// Domínio PURO da situação comercial de uma empresa (sem I/O).
//
// Fonte ÚNICA da verdade sobre "em que estado comercial a conta está e o que ela
// pode fazer". Backend (gate/rotas), painel e app consomem ESTE cálculo — a regra
// não é reimplementada em três lugares (era o problema apontado na auditoria).
//
// Recebe um snapshot já carregado pelo chamador e devolve situação canônica +
// ações permitidas + dados de trial + pagamentos iniciais. Não fala com banco,
// não fala com Asaas, não lê relógio global (o `agora` entra como parâmetro) —
// por isso é exaustivamente testável.
//
// REGRA DE PRODUTO (macrofrente Fechamento Comercial):
//   - Trial é GRATUITO: nenhuma cobrança durante o período de teste.
//   - Trial começa só quando o contrato obrigatório está plenamente assinado.
//   - Fim do trial NÃO cobra automaticamente: exige decisão explícita do cliente.
//   - "Não continuar" NÃO gera dívida (≠ inadimplência).
//   - "Continuar" gera cobranças; liberação só após todos os pagamentos iniciais.
//   - Contas ANTIGAS (fluxo legado) não são afetadas retroativamente.
//   - Bloqueio administrativo/segurança/jurídico NUNCA é removido por pagamento.

const FLOW_V2 = 'v2';

// Situações canônicas. Evitam combinações contraditórias (ex.: "trial" + "suspenso").
const SITUACAO = Object.freeze({
  AGUARDANDO_ASSINATURA: 'aguardando_assinatura',
  TRIAL_ATIVO: 'trial_ativo',
  TRIAL_EXPIRANDO: 'trial_expirando',
  TRIAL_EXPIRADO_AGUARDANDO_DECISAO: 'trial_expirado_aguardando_decisao',
  TRIAL_ENCERRADO_SEM_CONTRATACAO: 'trial_encerrado_sem_contratacao',
  CONVERSAO_AGUARDANDO_PAGAMENTO: 'conversao_aguardando_pagamento',
  ATIVA: 'ativa',
  SUSPENSA_FINANCEIRAMENTE: 'suspensa_financeiramente',
  BLOQUEADA_ADMINISTRATIVAMENTE: 'bloqueada_administrativamente',
  CANCELADA: 'cancelada',
  // Contas do fluxo antigo: reportadas à parte para que a nova regra NÃO as atinja.
  LEGADO: 'legado',
});

// Motivos de bloqueio que pagamento nunca dissolve.
const MOTIVOS_BLOQUEIO_DURO = new Set(['administrativo', 'seguranca', 'fraude', 'juridico']);

// Contrato considerado plenamente concluído (libera o trial).
const CONTRATO_CONCLUIDO = new Set(['plenamente_assinado', 'assinado', 'aceito_manualmente']);

// Ações "tudo negado exceto consulta" — base para estados de bloqueio.
function apenasConsulta(extra = {}) {
  return {
    consultar: true,
    operar_escrita: false,
    assinar_contrato: false,
    converter: false,
    regularizar: false,
    ...extra,
  };
}

function toDate(v) {
  if (v instanceof Date) return v;
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function diasEntre(deData, ateData) {
  const MS_DIA = 24 * 60 * 60 * 1000;
  return Math.ceil((ateData.getTime() - deData.getTime()) / MS_DIA);
}

// Monta a lista de pagamentos iniciais OBRIGATÓRIOS a partir do snapshot comercial,
// conciliando com as faturas iniciais já existentes (por `origem`). Implantação só
// entra quando > 0. Implantação e mensalidade são SEPARADAS (nunca somadas numa
// cobrança só).
function montarPagamentosIniciais({ snapshot, faturasIniciais }) {
  const faturas = Array.isArray(faturasIniciais) ? faturasIniciais : [];
  const statusPorOrigem = (origem) => {
    // "pago" vence qualquer outra; senão o primeiro não-cancelado; senão 'ausente'.
    const daOrigem = faturas.filter((f) => f && f.origem === origem && f.status !== 'cancelado');
    if (daOrigem.some((f) => f.status === 'pago')) return 'pago';
    if (daOrigem.length > 0) return daOrigem[0].status || 'pendente';
    return 'ausente';
  };

  const necessarios = [];
  const valorImplantacao = Number(snapshot?.valor_implantacao || 0);
  if (Number.isFinite(valorImplantacao) && valorImplantacao > 0) {
    necessarios.push({ tipo: 'implantacao', valor: valorImplantacao, status: statusPorOrigem('implantacao') });
  }
  const valorMensal = Number(snapshot?.valor_mensal || 0);
  necessarios.push({ tipo: 'mensalidade', valor: valorMensal, status: statusPorOrigem('mensalidade') });

  const confirmados = necessarios.filter((p) => p.status === 'pago');
  const pendentes = necessarios.filter((p) => p.status !== 'pago');
  const valorPendente = Number(pendentes.reduce((acc, p) => acc + Number(p.valor || 0), 0).toFixed(2));
  const todosPagos = necessarios.length > 0 && pendentes.length === 0;

  return { necessarios, confirmados, valorPendente, todosPagos };
}

// Núcleo. Recebe o snapshot e devolve a situação canônica.
//   input.empresa   : { status, commercial_flow_version, trial_started_at, trial_ends_at,
//                       converted_at, decisao_pos_trial, bloqueio_motivo }
//   input.contrato  : { status, obrigatorio } | null  (contrato obrigatório vigente)
//   input.snapshot  : snapshot da proposta (valor_mensal, valor_implantacao, trial_dias, ...)
//   input.faturasIniciais : [{ origem, status, valor }]
//   input.agora     : Date | ISO (default: relógio real)
//   input.diasAvisoTrial : limiar para "expirando" (default 3)
function avaliarSituacaoComercial(input = {}) {
  const empresa = input.empresa || {};
  const contrato = input.contrato || null;
  const snapshot = input.snapshot || null;
  const agora = toDate(input.agora) || new Date();
  const diasAviso = Number.isFinite(input.diasAvisoTrial) ? input.diasAvisoTrial : 3;

  const trialStart = toDate(empresa.trial_started_at);
  const trialEnds = toDate(empresa.trial_ends_at);
  const diasRestantes = trialEnds ? diasEntre(agora, trialEnds) : null;

  const pagamentos = montarPagamentosIniciais({ snapshot, faturasIniciais: input.faturasIniciais });

  const base = {
    situacao: null,
    legado: false,
    acoes: apenasConsulta(),
    motivo: null,
    trial_started_at: trialStart ? trialStart.toISOString() : null,
    trial_ends_at: trialEnds ? trialEnds.toISOString() : null,
    dias_restantes: diasRestantes,
    decisao_pos_trial: empresa.decisao_pos_trial || null,
    pagamentos_necessarios: pagamentos.necessarios,
    pagamentos_confirmados: pagamentos.confirmados,
    valor_pendente: pagamentos.valorPendente,
    proxima_acao: null,
  };

  // 1) Bloqueio duro (administrativo/segurança/fraude/jurídico): tem prioridade
  //    absoluta e pagamento nunca remove.
  if (empresa.status === 'bloqueado' || MOTIVOS_BLOQUEIO_DURO.has(empresa.bloqueio_motivo)) {
    return { ...base, situacao: SITUACAO.BLOQUEADA_ADMINISTRATIVAMENTE, motivo: empresa.bloqueio_motivo || 'administrativo', acoes: apenasConsulta(), proxima_acao: 'contatar_suporte' };
  }

  // 2) Cancelada.
  if (empresa.status === 'cancelada' || empresa.status === 'cancelado') {
    return { ...base, situacao: SITUACAO.CANCELADA, motivo: 'cancelada', acoes: apenasConsulta(), proxima_acao: 'nenhuma' };
  }

  // 3) Conta LEGADA: não aplicamos a nova regra. Reportamos o estado de forma
  //    compatível com o comportamento atual (consulta sempre; escrita conforme o
  //    status legado). O backend segue usando o gate existente para essas contas.
  if (empresa.commercial_flow_version !== FLOW_V2) {
    const status = empresa.status;
    const escritaLegadaOk = status === 'ativo' || (status === 'trial' && (!trialEnds || agora < trialEnds));
    return {
      ...base,
      situacao: SITUACAO.LEGADO,
      legado: true,
      motivo: `legado:${status || 'desconhecido'}`,
      acoes: {
        consultar: true,
        operar_escrita: escritaLegadaOk,
        assinar_contrato: false,
        converter: false,
        regularizar: !escritaLegadaOk,
      },
      proxima_acao: escritaLegadaOk ? 'operar' : 'regularizar',
    };
  }

  // 4) Fluxo NOVO (v2).

  // 4.a) Contrato obrigatório pendente de assinatura → bloqueia escrita, libera assinatura.
  const contratoConcluido = contrato && CONTRATO_CONCLUIDO.has(contrato.status);
  const temContratoObrigatorioPendente = contrato && contrato.obrigatorio === true && !contratoConcluido && contrato.status !== 'cancelado';
  if (temContratoObrigatorioPendente) {
    return { ...base, situacao: SITUACAO.AGUARDANDO_ASSINATURA, motivo: 'contrato_obrigatorio_pendente', acoes: apenasConsulta({ assinar_contrato: true }), proxima_acao: 'assinar_contrato' };
  }

  // 4.b) Suspensão financeira (inadimplência pós-ativação) → bloqueia escrita, libera regularização.
  if (empresa.status === 'suspenso' || empresa.bloqueio_motivo === 'financeiro') {
    return { ...base, situacao: SITUACAO.SUSPENSA_FINANCEIRAMENTE, motivo: 'inadimplencia', acoes: apenasConsulta({ regularizar: true }), proxima_acao: 'regularizar' };
  }

  // 4.c) Já convertida: ativa se todos os pagamentos iniciais estão pagos;
  //      senão continua aguardando pagamento.
  if (empresa.converted_at) {
    if (pagamentos.todosPagos) {
      return { ...base, situacao: SITUACAO.ATIVA, motivo: 'convertida', acoes: { consultar: true, operar_escrita: true, assinar_contrato: false, converter: false, regularizar: false }, proxima_acao: 'operar' };
    }
    return { ...base, situacao: SITUACAO.CONVERSAO_AGUARDANDO_PAGAMENTO, motivo: 'pagamentos_iniciais_pendentes', acoes: apenasConsulta({ regularizar: true }), proxima_acao: 'pagar_iniciais' };
  }

  // 4.d) Trial. Só existe trial se o contrato foi concluído (o backend só grava
  //      trial_ends_at após a assinatura). Sem contrato concluído e sem trial,
  //      a conta ainda está aguardando assinatura.
  if (!contratoConcluido && !trialEnds) {
    return { ...base, situacao: SITUACAO.AGUARDANDO_ASSINATURA, motivo: 'trial_nao_iniciado', acoes: apenasConsulta({ assinar_contrato: true }), proxima_acao: 'assinar_contrato' };
  }

  if (trialEnds && agora < trialEnds) {
    const expirando = diasRestantes !== null && diasRestantes <= diasAviso;
    return {
      ...base,
      situacao: expirando ? SITUACAO.TRIAL_EXPIRANDO : SITUACAO.TRIAL_ATIVO,
      motivo: 'trial_gratuito',
      // Durante o trial: operação liberada, NENHUMA cobrança.
      acoes: { consultar: true, operar_escrita: true, assinar_contrato: false, converter: false, regularizar: false },
      proxima_acao: expirando ? 'avaliar_continuacao' : 'operar',
    };
  }

  // 4.e) Trial expirado: decisão explícita do cliente comanda.
  const decisao = empresa.decisao_pos_trial;
  if (decisao === 'continuar') {
    // Optou por continuar mas ainda não pagou tudo.
    return { ...base, situacao: SITUACAO.CONVERSAO_AGUARDANDO_PAGAMENTO, decisao_pos_trial: 'continuar', motivo: 'pagamentos_iniciais_pendentes', acoes: apenasConsulta({ regularizar: true }), proxima_acao: 'pagar_iniciais' };
  }
  if (decisao === 'nao_continuar') {
    // Sem dívida. Distinto de inadimplência. Pode voltar atrás e converter.
    return { ...base, situacao: SITUACAO.TRIAL_ENCERRADO_SEM_CONTRATACAO, decisao_pos_trial: 'nao_continuar', motivo: 'cliente_optou_nao_continuar', acoes: apenasConsulta({ converter: true }), proxima_acao: 'reconsiderar_continuacao' };
  }
  // Sem decisão registrada.
  return { ...base, situacao: SITUACAO.TRIAL_EXPIRADO_AGUARDANDO_DECISAO, decisao_pos_trial: 'pendente', motivo: 'trial_vencido_sem_decisao', acoes: apenasConsulta({ converter: true }), proxima_acao: 'decidir_continuacao' };
}

module.exports = {
  SITUACAO,
  FLOW_V2,
  MOTIVOS_BLOQUEIO_DURO,
  CONTRATO_CONCLUIDO,
  montarPagamentosIniciais,
  avaliarSituacaoComercial,
};
