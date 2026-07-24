// backend/services/billingHealthService.js
// Go-live billing — PR2: agregação PURA de saúde do billing. Sem I/O: recebe as
// listas já lidas (faturas, empresas, eventos de webhook) e devolve um retrato
// dos sinais que precisam de olho antes/depois do go-live. A rota
// GET /painel-admin/billing-health faz só as leituras e chama esta função.
//
// Nenhum sinal aqui "conserta" nada — é observabilidade read-only. Cada bloco
// responde a uma pergunta de operação:
//   * faturas_sem_asaas_id      → reservas órfãs (cobrança local sem Asaas);
//   * faturas_abertas_sem_link  → cliente não tem como pagar;
//   * vencidas                  → inadimplência a acompanhar;
//   * duplicidade               → mesma empresa/origem/período > 1 (nunca deve ocorrer);
//   * suspensas_sem_fatura      → conta travada sem caminho de regularização;
//   * suspensas_com_fatura_paga → sinal do bug de reativação (deveria ser 0);
//   * webhook_com_erro          → eventos Asaas não processados;
//   * categoria_incompativel    → autônomo em plano de empresa (ou vice-versa).
//
// SINAIS INFORMATIVOS (não derrubam `ok` — não são "billing quebrado agora", mas
// merecem olho antes do go-live e na operação diária):
//   * empresa_sem_plano             → conta ativa/trial sem plano vinculado (não há o que cobrar);
//   * plano_inativo_ou_arquivado    → conta aponta para plano inativo/arquivado (recorrência pula);
//   * trial_vencido_sem_fatura      → trial vencido ainda sem fatura de regularização (transitório);
//   * assinatura_asaas_ativa        → contas com asaas_subscription_id (o motor recorrente as pula);
//   * suspension_reason_inconsistente → conta suspensa sem motivo registrado (auditoria).
// A decisão de mantê-los FORA de `ok` é deliberada: `ok` só fica vermelho para
// falha crítica e acionável, para o painel não "gritar" por situação esperada.

const { categoriaCompativelComTipo } = require('../utils/planoCategoria');

const STATUS_ABERTO = new Set(['pendente', 'vencido']);
// Estados de conta que a plataforma espera vir a cobrar (logo, precisam de plano).
const STATUS_COBRAVEL_ESPERADO = new Set(['ativo', 'trial']);
// Motivos de suspensão reconhecidos — espelham o CHECK da migration 024
// (empresas_suspension_reason_check). O banco já recusa string fora deste conjunto,
// então a ÚNICA inconsistência possível em runtime é a ausência de motivo (NULL/'').
const SUSPENSION_REASONS_CONHECIDOS = new Set([
  'financial', 'administrative', 'security', 'legacy_unknown',
]);

function soData(v) {
  if (!v) return null;
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

// planoDe: a empresa pode vir com planos como objeto (join) ou array. Devolve o
// plano resolvido (ou null quando não há vínculo).
function planoDe(empresa) {
  const p = empresa && empresa.planos;
  const plano = Array.isArray(p) ? p[0] : p;
  return plano || null;
}

function categoriaDoPlano(empresa) {
  const plano = planoDe(empresa);
  return plano ? plano.categoria : null;
}

function resumirBillingHealth({ faturas = [], empresas = [], webhookEvents = [], hoje = new Date() } = {}) {
  const hojeStr = soData(hoje) || new Date().toISOString().slice(0, 10);

  const totais = {
    total: faturas.length,
    pagas: 0,
    total_pago: 0,
    abertas: 0,
  };

  // Sinal CRÍTICO: reserva órfã só é problema operacional quando a fatura está
  // ABERTA (pendente/vencido) — o cliente não tem como pagar. Uma órfã já
  // cancelada é inofensiva (ex.: soft-cancel da migration 034) e vai para um
  // contador informativo à parte, sem poluir o alerta principal.
  const faturas_sem_asaas_id = [];          // abertas sem asaas_id (crítico)
  const faturas_canceladas_sem_asaas_id = []; // canceladas/terminais sem asaas_id (informativo)
  const faturas_abertas_sem_link = [];
  const vencidas = [];
  const chavesPeriodo = new Map(); // "empresa|origem|periodo" → contagem

  for (const f of faturas) {
    if (f.status === 'pago') {
      totais.pagas += 1;
      totais.total_pago += Number(f.valor) || 0;
    }
    if (STATUS_ABERTO.has(f.status)) totais.abertas += 1;

    if (!f.asaas_id) {
      const registro = { id: f.id, empresa_id: f.empresa_id, status: f.status, origem: f.origem };
      if (STATUS_ABERTO.has(f.status)) faturas_sem_asaas_id.push(registro);
      else faturas_canceladas_sem_asaas_id.push(registro); // pago/cancelado/estornado
    }
    if (STATUS_ABERTO.has(f.status) && !f.invoice_url && !f.bank_slip_url) {
      faturas_abertas_sem_link.push({ id: f.id, empresa_id: f.empresa_id, status: f.status });
    }
    const due = soData(f.due_date);
    if (STATUS_ABERTO.has(f.status) && due && due < hojeStr) {
      vencidas.push({ id: f.id, empresa_id: f.empresa_id, due_date: due, valor: Number(f.valor) || 0 });
    }
    // Duplicidade só faz sentido para faturas com origem+período (recorrente/regularizacao).
    if (f.origem && f.periodo_referencia) {
      const chave = `${f.empresa_id}|${f.origem}|${soData(f.periodo_referencia)}`;
      chavesPeriodo.set(chave, (chavesPeriodo.get(chave) || 0) + 1);
    }
  }
  totais.total_pago = Number(totais.total_pago.toFixed(2));

  const duplicidade = [];
  for (const [chave, qtd] of chavesPeriodo) {
    if (qtd > 1) {
      const [empresa_id, origem, periodo_referencia] = chave.split('|');
      duplicidade.push({ empresa_id, origem, periodo_referencia, qtd });
    }
  }

  // Índice de faturas abertas por empresa (para suspensas sem fatura).
  const abertasPorEmpresa = new Set(
    faturas.filter((f) => STATUS_ABERTO.has(f.status)).map((f) => f.empresa_id)
  );
  const pagasPorEmpresa = new Set(
    faturas.filter((f) => f.status === 'pago').map((f) => f.empresa_id)
  );

  const suspensas_sem_fatura = [];
  const suspensas_com_fatura_paga = [];
  const categoria_incompativel = [];
  // Sinais informativos (não entram no `ok`).
  const empresa_sem_plano = [];
  const plano_inativo_ou_arquivado = [];
  const trial_vencido_sem_fatura = [];
  const assinatura_asaas_ativa = [];
  const suspension_reason_inconsistente = [];
  // Arquivadas: fora do escrutínio operacional (contas de teste tiradas da
  // operação). Contadas à parte, nunca como problema. Quando uma conta de teste é
  // arquivada, ela para de poluir suspensas_sem_fatura/categoria/etc.
  const arquivadas = [];
  const arquivadas_com_fatura_paga = [];

  for (const e of empresas) {
    // arquivada_em só existe após a migration 036; antes disso é undefined e
    // nenhuma empresa entra aqui (comportamento idêntico ao de hoje).
    if (e.arquivada_em != null) {
      arquivadas.push({ id: e.id, nome: e.nome, tipo: e.tipo });
      if (pagasPorEmpresa.has(e.id)) arquivadas_com_fatura_paga.push({ id: e.id, nome: e.nome });
      continue; // não conta em nenhum outro sinal operacional
    }

    if (e.status === 'suspenso') {
      if (!abertasPorEmpresa.has(e.id)) {
        suspensas_sem_fatura.push({ id: e.id, nome: e.nome, tipo: e.tipo, suspension_reason: e.suspension_reason });
      }
      if (pagasPorEmpresa.has(e.id)) {
        // Sinal do bug de reativação (deveria ser 0 após #298).
        suspensas_com_fatura_paga.push({ id: e.id, nome: e.nome, suspension_reason: e.suspension_reason });
      }
      // Suspensa sem motivo registrado: o banco (CHECK da 024) só aceita motivos
      // válidos ou NULL, então "inconsistente" aqui é exatamente a ausência de motivo.
      if (!e.suspension_reason || !SUSPENSION_REASONS_CONHECIDOS.has(String(e.suspension_reason))) {
        suspension_reason_inconsistente.push({ id: e.id, nome: e.nome, suspension_reason: e.suspension_reason || null });
      }
    }

    const plano = planoDe(e);

    const cat = plano ? plano.categoria : null;
    if (cat != null && !categoriaCompativelComTipo(e.tipo, cat)) {
      categoria_incompativel.push({ id: e.id, nome: e.nome, tipo: e.tipo, categoria: cat });
    }

    // Conta que a plataforma espera vir a cobrar precisa de um plano vinculado.
    if (STATUS_COBRAVEL_ESPERADO.has(e.status)) {
      if (!plano && e.plano_id == null) {
        empresa_sem_plano.push({ id: e.id, nome: e.nome, tipo: e.tipo, status: e.status });
      }
      // Plano vinculado porém inativo/arquivado: a recorrência PULA essa conta
      // (faturaRecorrenteDomainService trata ativo=false/arquivado_em como inválido).
      if (plano && (plano.ativo === false || plano.arquivado_em != null)) {
        plano_inativo_ou_arquivado.push({
          id: e.id, nome: e.nome, status: e.status,
          plano_nome: plano.nome || null,
          plano_ativo: plano.ativo !== false,
          plano_arquivado: plano.arquivado_em != null,
        });
      }
    }

    // Trial vencido ainda sem fatura de regularização (o job expirarTrials gera).
    const trialFim = soData(e.trial_ends_at);
    if (e.status === 'trial' && trialFim && trialFim < hojeStr && !abertasPorEmpresa.has(e.id)) {
      trial_vencido_sem_fatura.push({ id: e.id, nome: e.nome, trial_ends_at: trialFim });
    }

    // Contas com assinatura Asaas: informativo — o motor recorrente as pula de
    // propósito (a própria assinatura cobra). Útil antes do go-live de recorrência.
    if (e.asaas_subscription_id) {
      assinatura_asaas_ativa.push({ id: e.id, nome: e.nome, asaas_subscription_id: e.asaas_subscription_id });
    }
  }

  // Webhook: contagem por status e lista de eventos com erro.
  const webhook_por_status = {};
  const webhook_com_erro = [];
  for (const ev of webhookEvents) {
    const st = ev.status || 'desconhecido';
    webhook_por_status[st] = (webhook_por_status[st] || 0) + 1;
    if (ev.status === 'failed' || (ev.last_error && ev.status !== 'processed' && ev.status !== 'ignored')) {
      webhook_com_erro.push({ event_type: ev.event_type, status: ev.status, last_error: ev.last_error, asaas_payment_id: ev.asaas_payment_id });
    }
  }

  const ok =
    faturas_sem_asaas_id.length === 0 &&
    faturas_abertas_sem_link.length === 0 &&
    duplicidade.length === 0 &&
    suspensas_com_fatura_paga.length === 0 &&
    webhook_com_erro.length === 0 &&
    categoria_incompativel.length === 0;

  return {
    ok,
    gerado_em: new Date().toISOString(),
    totais,
    contadores: {
      faturas_sem_asaas_id: faturas_sem_asaas_id.length,
      faturas_canceladas_sem_asaas_id: faturas_canceladas_sem_asaas_id.length, // informativo
      faturas_abertas_sem_link: faturas_abertas_sem_link.length,
      vencidas: vencidas.length,
      duplicidade: duplicidade.length,
      suspensas_sem_fatura: suspensas_sem_fatura.length,
      suspensas_com_fatura_paga: suspensas_com_fatura_paga.length,
      webhook_com_erro: webhook_com_erro.length,
      categoria_incompativel: categoria_incompativel.length,
      // Informativos (não afetam `ok`).
      empresa_sem_plano: empresa_sem_plano.length,
      plano_inativo_ou_arquivado: plano_inativo_ou_arquivado.length,
      trial_vencido_sem_fatura: trial_vencido_sem_fatura.length,
      assinatura_asaas_ativa: assinatura_asaas_ativa.length,
      suspension_reason_inconsistente: suspension_reason_inconsistente.length,
      arquivadas: arquivadas.length,
      arquivadas_com_fatura_paga: arquivadas_com_fatura_paga.length,
    },
    detalhes: {
      faturas_sem_asaas_id,
      faturas_canceladas_sem_asaas_id,
      faturas_abertas_sem_link,
      vencidas,
      duplicidade,
      suspensas_sem_fatura,
      suspensas_com_fatura_paga,
      webhook_com_erro,
      categoria_incompativel,
      empresa_sem_plano,
      plano_inativo_ou_arquivado,
      trial_vencido_sem_fatura,
      assinatura_asaas_ativa,
      suspension_reason_inconsistente,
      arquivadas,
      arquivadas_com_fatura_paga,
      webhook_por_status,
    },
  };
}

module.exports = { resumirBillingHealth };
