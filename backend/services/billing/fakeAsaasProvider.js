// Fake provider de billing (Asaas) — 100% em memória, SEM rede (§44).
//
// Implementa o MESMO contrato que o adapter real do Asaas exporá, para que os
// testes/E2E offline exercitem todo o fluxo (customer, subscription, charge,
// webhook, retry, timeout, 429, 500, evento duplicado, fora de ordem, cancel)
// sem tocar em Asaas real. Determinístico: ids sequenciais.
//
// Contrato do provider (fake e real conformam):
//   createCustomer({ empresa }) -> { id }
//   createSubscription({ customerId, value, nextDueDate, cycle, externalReference }) -> { id, nextDueDate, status }
//   createCharge({ customerId, value, dueDate, description, externalReference }) -> { id, status, value, dueDate }
//   cancelSubscription({ subscriptionId }) -> { id, status:'CANCELLED' }
//   getCustomer(id) / getSubscription(id) / getCharge(id) -> objeto | null
//   emitWebhook(chargeId, event) -> body no formato do webhook Asaas

class FakeAsaasError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'FakeAsaasError';
    this.httpStatus = status;
  }
}

class FakeAsaasProvider {
  // faults: { failTimes?: number, status?: 429|500|0, onlyFor?: Set<string> }
  //   simula N falhas transitórias antes de suceder (retry testável).
  constructor(opts = {}) {
    this.customers = new Map();
    this.subscriptions = new Map();
    this.charges = new Map();
    this._seq = { cus: 0, sub: 0, pay: 0, evt: 0 };
    this._faults = opts.faults ? { ...opts.faults, _count: 0 } : null;
    this.calls = { createCustomer: 0, createSubscription: 0, createCharge: 0, cancelSubscription: 0, updateSubscription: 0, cancelComponent: 0 };
  }

  _id(kind) {
    this._seq[kind] += 1;
    return `${kind}_${String(this._seq[kind]).padStart(6, '0')}`;
  }

  // Falha transitória controlada para testar retry/backoff (§22).
  _maybeFault(op) {
    if (!this._faults) return;
    if (this._faults.onlyFor && !this._faults.onlyFor.has(op)) return;
    if (this._faults._count >= (this._faults.failTimes || 0)) return;
    this._faults._count += 1;
    const status = this._faults.status ?? 500;
    if (status === 0) {
      const e = new FakeAsaasError(0, 'timeout simulado');
      e.code = 'ETIMEDOUT';
      throw e;
    }
    throw new FakeAsaasError(status, `falha transitória simulada (${status})`);
  }

  async createCustomer({ empresa } = {}) {
    this.calls.createCustomer += 1;
    this._maybeFault('createCustomer');
    const id = this._id('cus');
    const obj = { id, name: empresa?.nome || 'cliente', externalReference: empresa?.id || null };
    this.customers.set(id, obj);
    return { id };
  }

  async createSubscription({ customerId, value, nextDueDate, cycle = 'MONTHLY', externalReference } = {}) {
    this.calls.createSubscription += 1;
    this._maybeFault('createSubscription');
    if (!this.customers.has(customerId)) throw new FakeAsaasError(400, 'customer inexistente');
    const id = this._id('sub');
    const obj = { id, customer: customerId, value: Number(value) || 0, nextDueDate, cycle, status: 'ACTIVE', externalReference: externalReference || null };
    this.subscriptions.set(id, obj);
    return { id, nextDueDate, status: 'ACTIVE' };
  }

  async createCharge({ customerId, value, dueDate, description, externalReference } = {}) {
    this.calls.createCharge += 1;
    this._maybeFault('createCharge');
    if (!this.customers.has(customerId)) throw new FakeAsaasError(400, 'customer inexistente');
    const id = this._id('pay');
    const obj = { id, customer: customerId, value: Number(value) || 0, dueDate, description: description || null, status: 'PENDING', externalReference: externalReference || null };
    this.charges.set(id, obj);
    return { id, status: 'PENDING', value: obj.value, dueDate };
  }

  async cancelSubscription({ subscriptionId } = {}) {
    this.calls.cancelSubscription += 1;
    this._maybeFault('cancelSubscription');
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return { id: subscriptionId, status: 'CANCELLED', deleted: true }; // idempotente
    sub.status = 'CANCELLED';
    return { id: subscriptionId, status: 'CANCELLED' };
  }

  // Atualiza o valor de uma assinatura (convergência de plano alterado).
  async updateSubscription({ subscriptionId, value } = {}) {
    this.calls.updateSubscription += 1;
    this._maybeFault('updateSubscription');
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) throw new FakeAsaasError(404, 'subscription inexistente');
    sub.value = Number(value) || 0;
    return { id: subscriptionId, value: sub.value, status: sub.status };
  }

  // Cancela um componente/cobrança de add-on (convergência de add-on removido).
  async cancelComponent({ componentId } = {}) {
    this.calls.cancelComponent += 1;
    this._maybeFault('cancelComponent');
    const charge = this.charges.get(componentId);
    if (charge) charge.status = 'CANCELLED';
    return { id: componentId, status: 'CANCELLED' };
  }

  async getCustomer(id) { return this.customers.get(id) || null; }
  async getSubscription(id) { return this.subscriptions.get(id) || null; }
  async getCharge(id) { return this.charges.get(id) || null; }

  // Simula a transição de status de uma cobrança (paga/confirmada/vencida) e
  // devolve o BODY do webhook correspondente, no formato do Asaas.
  emitWebhook(chargeId, event) {
    const charge = this.charges.get(chargeId);
    if (!charge) throw new FakeAsaasError(404, 'charge inexistente');
    const mapaStatus = {
      PAYMENT_CREATED: 'PENDING',
      PAYMENT_CONFIRMED: 'CONFIRMED',
      PAYMENT_RECEIVED: 'RECEIVED',
      PAYMENT_OVERDUE: 'OVERDUE',
      PAYMENT_DELETED: 'DELETED',
      PAYMENT_REFUNDED: 'REFUNDED',
    };
    if (mapaStatus[event]) charge.status = mapaStatus[event];
    this._seq.evt += 1;
    return {
      id: `evt_${String(this._seq.evt).padStart(6, '0')}`,
      event,
      payment: {
        id: charge.id,
        status: charge.status,
        value: charge.value,
        dueDate: charge.dueDate,
        subscription: charge.subscription || null,
        customer: charge.customer,
      },
    };
  }
}

module.exports = { FakeAsaasProvider, FakeAsaasError };
