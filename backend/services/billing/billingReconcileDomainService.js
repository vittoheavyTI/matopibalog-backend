// Motor PURO de reconciliação de billing (macrofrente 3A-2, §23/§51).
//
// Compara o estado LOCAL (mapeamentos/faturas) com o estado REMOTO (provider) e
// devolve a lista de DIVERGÊNCIAS + ações de reparo idempotentes. O mesmo motor é
// usado pela reconciliação automática e pelo "sincronizar" manual (contingência):
// não há duas lógicas diferentes.
//
// Detecta:
//   - customer mapping ausente (Asaas tem customer, local não gravou);
//   - assinatura ausente/divergente;
//   - cobrança local faltando (charge existe no provider, não localmente);
//   - status defasado (webhook perdido);
//   - mapeamento local apontando para objeto inexistente no provider.

function acaoReparo(tipo, detalhe = {}) {
  return { tipo, ...detalhe };
}

// Recebe:
//   local  : { asaas_customer_id, asaas_subscription_id, faturas: [{ asaas_payment_id, status }] }
//   remoto : { customer: {id}|null, subscription: {id,status}|null, charges: [{id,status}] }
// Devolve { divergencias: [...], acoes: [...], ok: bool }.
function reconciliar({ local = {}, remoto = {} } = {}) {
  const divergencias = [];
  const acoes = [];

  const localCustomer = local.asaas_customer_id || null;
  const remotoCustomer = remoto.customer?.id || null;

  // 1) Customer: provider tem, local não gravou → reparar mapping.
  if (remotoCustomer && !localCustomer) {
    divergencias.push('customer_mapping_ausente');
    acoes.push(acaoReparo('gravar_customer_mapping', { customer_id: remotoCustomer }));
  }
  // Local aponta para customer inexistente no provider.
  if (localCustomer && remoto.customer === null) {
    divergencias.push('customer_local_orfao');
    acoes.push(acaoReparo('recriar_customer'));
  }

  // 2) Subscription: provider tem, local não → reparar mapping.
  const localSub = local.asaas_subscription_id || null;
  const remotoSub = remoto.subscription?.id || null;
  if (remotoSub && !localSub) {
    divergencias.push('subscription_mapping_ausente');
    acoes.push(acaoReparo('gravar_subscription_mapping', { subscription_id: remotoSub }));
  }
  if (localSub && remoto.subscription === null) {
    divergencias.push('subscription_local_orfa');
    acoes.push(acaoReparo('recriar_subscription'));
  }
  // Status de assinatura divergente (ex.: cancelada no provider, ativa local).
  if (localSub && remotoSub && remoto.subscription?.status && remoto.subscription.status !== 'ACTIVE') {
    divergencias.push('subscription_status_divergente');
    acoes.push(acaoReparo('atualizar_subscription_status', { status: remoto.subscription.status }));
  }

  // 3) Cobranças: charge existe no provider mas não localmente → importar.
  const faturasLocais = Array.isArray(local.faturas) ? local.faturas : [];
  const idsLocais = new Set(faturasLocais.map((f) => f && f.asaas_payment_id).filter(Boolean));
  const chargesRemotas = Array.isArray(remoto.charges) ? remoto.charges : [];
  for (const c of chargesRemotas) {
    if (!c || !c.id) continue;
    if (!idsLocais.has(c.id)) {
      divergencias.push('cobranca_local_faltando');
      acoes.push(acaoReparo('importar_cobranca', { payment_id: c.id, status: c.status || null }));
      continue;
    }
    // Status defasado (webhook perdido): provider mais avançado que o local.
    const localFatura = faturasLocais.find((f) => f && f.asaas_payment_id === c.id);
    if (localFatura && c.status && localFatura.status && !mesmoNivel(localFatura.status, c.status)) {
      divergencias.push('status_defasado');
      acoes.push(acaoReparo('sincronizar_status_cobranca', { payment_id: c.id, status_remoto: c.status }));
    }
  }

  return { divergencias, acoes, ok: divergencias.length === 0 };
}

// Comparação grosseira de "mesmo nível" entre status local e status remoto Asaas.
function mesmoNivel(statusLocal, statusRemoto) {
  const pagoLocal = ['pago', 'confirmado', 'recebido'].includes(String(statusLocal).toLowerCase());
  const pagoRemoto = ['RECEIVED', 'CONFIRMED'].includes(String(statusRemoto).toUpperCase());
  if (pagoLocal && pagoRemoto) return true;
  const pendLocal = ['pendente'].includes(String(statusLocal).toLowerCase());
  const pendRemoto = ['PENDING', 'AWAITING_RISK_ANALYSIS'].includes(String(statusRemoto).toUpperCase());
  if (pendLocal && pendRemoto) return true;
  const vencLocal = ['vencido'].includes(String(statusLocal).toLowerCase());
  const vencRemoto = ['OVERDUE'].includes(String(statusRemoto).toUpperCase());
  if (vencLocal && vencRemoto) return true;
  return false;
}

module.exports = { reconciliar, mesmoNivel };
