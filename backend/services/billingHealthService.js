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

const { categoriaCompativelComTipo } = require('../utils/planoCategoria');

const STATUS_ABERTO = new Set(['pendente', 'vencido']);

function soData(v) {
  if (!v) return null;
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

// planoDe: a empresa pode vir com planos como objeto (join) ou array.
function categoriaDoPlano(empresa) {
  const p = empresa && empresa.planos;
  const plano = Array.isArray(p) ? p[0] : p;
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

  for (const e of empresas) {
    if (e.status === 'suspenso') {
      if (!abertasPorEmpresa.has(e.id)) {
        suspensas_sem_fatura.push({ id: e.id, nome: e.nome, tipo: e.tipo, suspension_reason: e.suspension_reason });
      }
      if (pagasPorEmpresa.has(e.id)) {
        // Sinal do bug de reativação (deveria ser 0 após #298).
        suspensas_com_fatura_paga.push({ id: e.id, nome: e.nome, suspension_reason: e.suspension_reason });
      }
    }
    const cat = categoriaDoPlano(e);
    if (cat != null && !categoriaCompativelComTipo(e.tipo, cat)) {
      categoria_incompativel.push({ id: e.id, nome: e.nome, tipo: e.tipo, categoria: cat });
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
      webhook_por_status,
    },
  };
}

module.exports = { resumirBillingHealth };
