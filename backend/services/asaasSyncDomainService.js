// backend/services/asaasSyncDomainService.js
// MEGA-FRENTE Fechamento Comercial + Sync Asaas — FASE 4: regras PURAS do SYNC
// automático de assinatura Asaas (SANDBOX). Sem I/O: não toca banco, não fala com
// o Asaas — mesmo estilo testável dos outros *DomainService. A rota/job faz as
// leituras/escritas e a chamada HTTP; aqui só mora a DECISÃO.
//
// PREMISSA (não reinterpretar): Matopiba é a FONTE DA VERDADE do valor mensal;
// o Asaas é processador. O valor-alvo da assinatura é derivado do plano pelo
// backend. O Asaas não tem plano global → sync no nível de assinatura por empresa.
//
// FORWARD-ONLY e SEGURO:
//   * o sync ajusta o VALOR FUTURO da assinatura (próximas cobranças). NÃO altera
//     fatura já paga nem recalcula fatura emitida — isso é feito fora daqui e é
//     proibido por hard stop;
//   * idempotente: se o valor da assinatura já é o alvo, a ação é 'pular';
//   * cadastro incompleto → 'erro' (não cria reserva órfã);
//   * SANDBOX-only: o gate de ambiente é responsabilidade da rota/serviço de I/O
//     (bloquearSeNaoSandbox), ANTES de qualquer chamada ao Asaas.

const STATUS = Object.freeze({ PENDENTE: 'pendente', SINCRONIZADO: 'sincronizado', ERRO: 'erro' });

// Estados de conta elegíveis a ter assinatura sincronizada (cobráveis).
const STATUS_COBRAVEL = new Set(['ativo', 'trial']);

const ACAO = Object.freeze({
  CRIAR: 'criar',                 // sem assinatura → criar sandbox
  ATUALIZAR_VALOR: 'atualizar_valor', // assinatura existe, valor divergente → atualizar
  PULAR: 'pular',                 // já sincronizado / isento / não cobrável
  ERRO: 'erro',                   // cadastro incompleto / dado inválido
});

const MOTIVOS = Object.freeze({
  OK: 'ok',
  SEM_PLANO: 'sem_plano',
  PLANO_GRATUITO: 'plano_gratuito',
  NAO_COBRAVEL: 'status_nao_cobravel',
  CADASTRO_INCOMPLETO: 'cadastro_incompleto',
  JA_SINCRONIZADO: 'ja_sincronizado',
  REQUER_NEGOCIACAO: 'plano_requer_negociacao',
});

// Compara dois valores monetários em CENTAVOS inteiros (evita ruído de float).
function mesmoValor(a, b) {
  if (a == null || b == null) return false;
  return Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
}

// Valor-alvo da assinatura de uma empresa. Autoridade: o backend, a partir do
// plano. Por padrão é plano.preco_mensal (a BASE — mesma base da recorrência
// atual). `valorExplicito` permite ao chamador passar um valor já derivado
// (ex.: base + extras contratados), quando essa cobrança existir.
// Retorna { ok, valor } — valor null quando não há o que cobrar.
function valorAlvoDaEmpresa({ plano, valorExplicito } = {}) {
  if (valorExplicito != null) {
    const v = Number(valorExplicito);
    if (Number.isFinite(v) && v > 0) return { ok: true, valor: v };
    return { ok: true, valor: null };
  }
  const preco = Number(plano && plano.preco_mensal);
  if (!Number.isFinite(preco) || preco <= 0) return { ok: true, valor: null };
  return { ok: true, valor: preco };
}

// Decide o que o sync deve FAZER para uma empresa AGORA.
// Retorna { acao, motivo, valorAlvo }.
//
// Parâmetros:
//   empresa           → { id, status, asaas_subscription_id, cadastro_completo? }
//   plano             → { preco_mensal, requer_negociacao }
//   valorSincronizado → último valor aplicado no Asaas (de asaas_sync_estado) | null
//   valorAssinaturaAtual → value atual da assinatura no Asaas, se conhecido | null
//   valorExplicito    → valor-alvo já derivado (opcional; senão usa plano.preco_mensal)
//   cadastroCompleto  → boolean (o serviço de I/O sabe validar cpf/cnpj/email)
function avaliarSync({ empresa, plano, valorSincronizado = null, valorAssinaturaAtual = null, valorExplicito, cadastroCompleto = true } = {}) {
  if (!empresa || !empresa.id) {
    return { acao: ACAO.ERRO, motivo: MOTIVOS.CADASTRO_INCOMPLETO, valorAlvo: null };
  }

  // Conta não cobrável (suspenso/expirado/bloqueado/…): não sincroniza.
  if (!STATUS_COBRAVEL.has(empresa.status)) {
    return { acao: ACAO.PULAR, motivo: MOTIVOS.NAO_COBRAVEL, valorAlvo: null };
  }

  // Sem plano → nada a sincronizar.
  if (!plano || !plano.id && plano.preco_mensal == null && !plano.requer_negociacao) {
    // (plano pode vir só com preco_mensal; a checagem de gratuito abaixo cobre o resto)
  }

  // Plano sob negociação: fora do self-service; o valor não é de tabela.
  // Não sincroniza automaticamente (evita cobrar "sob proposta").
  if (plano && plano.requer_negociacao === true) {
    return { acao: ACAO.PULAR, motivo: MOTIVOS.REQUER_NEGOCIACAO, valorAlvo: null };
  }

  const alvo = valorAlvoDaEmpresa({ plano, valorExplicito });
  if (alvo.valor == null) {
    // Sem plano pago / gratuito / isento → nada a sincronizar.
    return { acao: ACAO.PULAR, motivo: plano && plano.preco_mensal != null ? MOTIVOS.PLANO_GRATUITO : MOTIVOS.SEM_PLANO, valorAlvo: null };
  }

  // Sem assinatura ainda → precisa criar (mas só se o cadastro estiver completo;
  // senão registra erro sem criar reserva órfã).
  if (!empresa.asaas_subscription_id) {
    if (!cadastroCompleto) return { acao: ACAO.ERRO, motivo: MOTIVOS.CADASTRO_INCOMPLETO, valorAlvo: alvo.valor };
    return { acao: ACAO.CRIAR, motivo: MOTIVOS.OK, valorAlvo: alvo.valor };
  }

  // Já tem assinatura. Se o valor já bate (com o que sincronizamos OU com o valor
  // atual conhecido da assinatura) → idempotente, pular.
  const referencia = valorAssinaturaAtual != null ? valorAssinaturaAtual : valorSincronizado;
  if (referencia != null && mesmoValor(referencia, alvo.valor)) {
    return { acao: ACAO.PULAR, motivo: MOTIVOS.JA_SINCRONIZADO, valorAlvo: alvo.valor };
  }

  // Valor divergente → atualizar o valor futuro da assinatura (forward-only).
  return { acao: ACAO.ATUALIZAR_VALOR, motivo: MOTIVOS.OK, valorAlvo: alvo.valor };
}

// Dado um plano que MUDOU (preço/capacidade/extra), quais empresas precisam entrar
// na fila? As que estão nesse plano e são cobráveis. PURA: recebe a lista já lida.
function empresasAfetadasPorPlano({ empresas = [], planoId } = {}) {
  if (!planoId) return [];
  return empresas
    .filter((e) => e && e.plano_id === planoId && STATUS_COBRAVEL.has(e.status) && e.arquivada_em == null)
    .map((e) => e.id);
}

// Monta o registro de estado (upsert em asaas_sync_estado) para marcar 'pendente'.
function montarEstadoPendente({ empresaId, motivo, valorAlvo = null, asaasSubscriptionId = null }) {
  return {
    empresa_id: empresaId,
    status: STATUS.PENDENTE,
    motivo: motivo || null,
    valor_alvo: valorAlvo != null ? Number(valorAlvo) : null,
    asaas_subscription_id: asaasSubscriptionId || null,
    atualizado_em: new Date().toISOString(),
  };
}

// Monta o registro de estado após um resultado de processamento.
function montarEstadoResultado({ empresaId, ok, valorAlvo = null, valorSincronizado = null, erro = null, asaasSubscriptionId = null, tentativasAtual = 0 }) {
  return {
    empresa_id: empresaId,
    status: ok ? STATUS.SINCRONIZADO : STATUS.ERRO,
    valor_alvo: valorAlvo != null ? Number(valorAlvo) : null,
    valor_sincronizado: ok && valorSincronizado != null ? Number(valorSincronizado) : (ok ? (valorAlvo != null ? Number(valorAlvo) : null) : null),
    ultimo_erro: ok ? null : (erro != null ? String(erro) : 'erro'),
    asaas_subscription_id: asaasSubscriptionId || null,
    tentativas: (Number(tentativasAtual) || 0) + 1,
    atualizado_em: new Date().toISOString(),
  };
}

// Monta a linha de auditoria (append em asaas_sync_tentativas). SEM segredo/PII.
function montarTentativa({ empresaId, acao, valorAntes = null, valorDepois = null, resultado, erro = null, asaasSubscriptionId = null, ambiente = 'sandbox' }) {
  const resumo = `sub=${asaasSubscriptionId || '-'} value=${valorDepois != null ? Number(valorDepois) : '-'}`;
  return {
    empresa_id: empresaId,
    acao,
    valor_antes: valorAntes != null ? Number(valorAntes) : null,
    valor_depois: valorDepois != null ? Number(valorDepois) : null,
    resultado,
    ambiente,
    payload_resumo: resumo,
    erro: erro != null ? String(erro) : null,
  };
}

module.exports = {
  STATUS,
  ACAO,
  MOTIVOS,
  STATUS_COBRAVEL,
  mesmoValor,
  valorAlvoDaEmpresa,
  avaliarSync,
  empresasAfetadasPorPlano,
  montarEstadoPendente,
  montarEstadoResultado,
  montarTentativa,
};
