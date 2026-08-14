// Adapter REAL do Asaas production.
//
// Este arquivo nao decide se production pode escrever. Ele so implementa o mesmo
// contrato do provider sandbox. A construcao dele fica atras de
// billingProductionGate, que exige flag, runner, allowlist, segredo e operacao
// elegivel. Sem gate aprovado, o orquestrador nunca instancia este provider.

const HOST_PRODUCTION = 'api.asaas.com';
const BASE_PRODUCTION = 'https://api.asaas.com/v3';
const {
  asaasHeaders,
  canonicalCustomerReference,
  AsaasCommitUncertainError,
  erroPodeTerCommitado,
  primeiroItem,
} = require('./asaasProviderSafety');

function ehProduction({ environment, baseURL } = {}) {
  const envOk = String(environment || '').toLowerCase() === 'production';
  let host = '';
  try { host = new URL(baseURL || '').hostname; } catch { host = ''; }
  return envOk && host === HOST_PRODUCTION;
}

class AsaasProductionProvider {
  constructor({ config, http } = {}) {
    if (!ehProduction(config)) {
      throw new Error('AsaasProductionProvider recusado: environment/host nao e production inequivoco (fail-closed).');
    }
    if (!config.apiKey) {
      throw new Error('AsaasProductionProvider: apiKey production ausente.');
    }
    this._http = http;
    this._base = config.baseURL || BASE_PRODUCTION;
    this._headers = asaasHeaders({ apiKey: config.apiKey, environment: 'production' });
    this._commitUncertainRefs = new Set();
    this.environment = 'production';
  }

  async _post(path, body) {
    const { data } = await this._http.post(`${this._base}${path}`, body, { headers: this._headers });
    return data;
  }

  async _get(path) {
    try {
      const { data } = await this._http.get(`${this._base}${path}`, { headers: this._headers });
      return data;
    } catch (e) {
      if (e?.response?.status === 404) return null;
      throw e;
    }
  }

  async _acharCustomerPorRef(ref) {
    if (!ref) return null;
    const data = await this._get(`/customers?externalReference=${encodeURIComponent(ref)}`);
    const item = primeiroItem(data);
    return item ? { id: item.id } : null;
  }

  async _acharSubscriptionPorRef(ref) {
    if (!ref) return null;
    const data = await this._get(`/subscriptions?externalReference=${encodeURIComponent(ref)}`);
    const item = primeiroItem(data);
    return item ? {
      id: item.id,
      nextDueDate: item.nextDueDate || null,
      status: item.status || 'ACTIVE',
      value: item.value,
    } : null;
  }

  async _acharChargePorRef(ref) {
    if (!ref) return null;
    const data = await this._get(`/payments?externalReference=${encodeURIComponent(ref)}`);
    const item = primeiroItem(data);
    return item ? {
      id: item.id,
      status: item.status || 'PENDING',
      value: item.value,
      dueDate: item.dueDate || null,
    } : null;
  }

  _chaveIncerta(resource, ref) {
    return `${resource}:${ref || ''}`;
  }

  async _reconciliarCommitIncerto({ resource, externalReference, lookup, cause }) {
    const chave = this._chaveIncerta(resource, externalReference);
    this._commitUncertainRefs.add(chave);
    const delays = [0, 25, 100];
    for (const delay of delays) {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      const item = await lookup();
      if (item) {
        this._commitUncertainRefs.delete(chave);
        return { ...item, reconciled: true };
      }
    }
    throw new AsaasCommitUncertainError({ resource, externalReference, cause });
  }

  async _bloquearNovoPostSeCommitIncerto(resource, externalReference, lookup) {
    const chave = this._chaveIncerta(resource, externalReference);
    if (!this._commitUncertainRefs.has(chave)) return null;
    const item = await lookup();
    if (item) {
      this._commitUncertainRefs.delete(chave);
      return item;
    }
    throw new AsaasCommitUncertainError({ resource, externalReference });
  }

  async createCustomer({ empresa } = {}) {
    const ref = canonicalCustomerReference(empresa?.id);
    const existente = await this._acharCustomerPorRef(ref);
    if (existente) return { id: existente.id };
    const pendente = await this._bloquearNovoPostSeCommitIncerto('customer', ref, () => this._acharCustomerPorRef(ref));
    if (pendente) return { id: pendente.id };
    try {
      const data = await this._post('/customers', {
        name: empresa?.nome || 'Cliente',
        cpfCnpj: empresa?.cnpj || undefined,
        email: empresa?.email_contato || undefined,
        externalReference: ref || undefined,
      });
      return { id: data.id };
    } catch (err) {
      if (erroPodeTerCommitado(err)) {
        const reconciliado = await this._reconciliarCommitIncerto({
          resource: 'customer',
          externalReference: ref,
          lookup: () => this._acharCustomerPorRef(ref),
          cause: err,
        });
        return { id: reconciliado.id, reconciled: true };
      }
      throw err;
    }
  }

  async createSubscription({ customerId, value, nextDueDate, cycle = 'MONTHLY', externalReference } = {}) {
    if (!externalReference) throw new Error('AsaasProductionProvider: externalReference obrigatorio para subscription.');
    const existente = await this._acharSubscriptionPorRef(externalReference);
    if (existente) return existente;
    const pendente = await this._bloquearNovoPostSeCommitIncerto('subscription', externalReference, () => this._acharSubscriptionPorRef(externalReference));
    if (pendente) return pendente;
    try {
      const data = await this._post('/subscriptions', {
        customer: customerId,
        billingType: 'PIX',
        value: Number(value) || 0,
        nextDueDate,
        cycle,
        externalReference,
      });
      return { id: data.id, nextDueDate: data.nextDueDate || nextDueDate, status: data.status || 'ACTIVE' };
    } catch (err) {
      if (erroPodeTerCommitado(err)) {
        return this._reconciliarCommitIncerto({
          resource: 'subscription',
          externalReference,
          lookup: () => this._acharSubscriptionPorRef(externalReference),
          cause: err,
        });
      }
      throw err;
    }
  }

  async createCharge({ customerId, value, dueDate, description, externalReference } = {}) {
    if (!externalReference) throw new Error('AsaasProductionProvider: externalReference obrigatorio para charge.');
    const existente = await this._acharChargePorRef(externalReference);
    if (existente) return existente;
    const pendente = await this._bloquearNovoPostSeCommitIncerto('charge', externalReference, () => this._acharChargePorRef(externalReference));
    if (pendente) return pendente;
    try {
      const data = await this._post('/payments', {
        customer: customerId,
        billingType: 'PIX',
        value: Number(value) || 0,
        dueDate,
        description: description || undefined,
        externalReference,
      });
      return { id: data.id, status: data.status || 'PENDING', value: data.value, dueDate: data.dueDate || dueDate };
    } catch (err) {
      if (erroPodeTerCommitado(err)) {
        return this._reconciliarCommitIncerto({
          resource: 'charge',
          externalReference,
          lookup: () => this._acharChargePorRef(externalReference),
          cause: err,
        });
      }
      throw err;
    }
  }

  async updateSubscription({ subscriptionId, value } = {}) {
    const data = await this._http.put(`${this._base}/subscriptions/${subscriptionId}`, { value: Number(value) || 0, updatePendingPayments: false }, { headers: this._headers })
      .then((r) => r.data);
    return { id: subscriptionId, value: data?.value ?? value, status: data?.status || null };
  }

  async cancelSubscription({ subscriptionId } = {}) {
    const data = await this._http.delete(`${this._base}/subscriptions/${subscriptionId}`, { headers: this._headers })
      .then((r) => r.data)
      .catch((e) => (e?.response?.status === 404 ? { deleted: true } : Promise.reject(e)));
    return { id: subscriptionId, status: 'CANCELLED', deleted: data?.deleted !== false };
  }

  async cancelComponent({ componentId } = {}) {
    const data = await this._http.delete(`${this._base}/payments/${componentId}`, { headers: this._headers })
      .then((r) => r.data)
      .catch((e) => (e?.response?.status === 404 ? { deleted: true } : Promise.reject(e)));
    return { id: componentId, status: 'CANCELLED', deleted: data?.deleted !== false };
  }

  async getCustomer(id) { return this._get(`/customers/${id}`); }
  async getSubscription(id) { return this._get(`/subscriptions/${id}`); }
  async getCharge(id) { return this._get(`/payments/${id}`); }
}

module.exports = { AsaasProductionProvider, ehProduction, HOST_PRODUCTION, BASE_PRODUCTION };
