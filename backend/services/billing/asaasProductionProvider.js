// Adapter REAL do Asaas production.
//
// Este arquivo nao decide se production pode escrever. Ele so implementa o mesmo
// contrato do provider sandbox. A construcao dele fica atras de
// billingProductionGate, que exige flag, runner, allowlist, segredo e operacao
// elegivel. Sem gate aprovado, o orquestrador nunca instancia este provider.

const HOST_PRODUCTION = 'api.asaas.com';
const BASE_PRODUCTION = 'https://api.asaas.com/v3';

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
    this._headers = { access_token: config.apiKey, 'Content-Type': 'application/json' };
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
    const lista = data?.data || [];
    return lista.length ? { id: lista[0].id } : null;
  }

  async createCustomer({ empresa } = {}) {
    const ref = empresa?.id || null;
    const existente = await this._acharCustomerPorRef(ref);
    if (existente) return { id: existente.id };
    const data = await this._post('/customers', {
      name: empresa?.nome || 'Cliente',
      cpfCnpj: empresa?.cnpj || undefined,
      email: empresa?.email_contato || undefined,
      externalReference: ref || undefined,
    });
    return { id: data.id };
  }

  async createSubscription({ customerId, value, nextDueDate, cycle = 'MONTHLY', externalReference } = {}) {
    const data = await this._post('/subscriptions', {
      customer: customerId,
      billingType: 'PIX',
      value: Number(value) || 0,
      nextDueDate,
      cycle,
      externalReference: externalReference || undefined,
    });
    return { id: data.id, nextDueDate: data.nextDueDate || nextDueDate, status: data.status || 'ACTIVE' };
  }

  async createCharge({ customerId, value, dueDate, description, externalReference } = {}) {
    const data = await this._post('/payments', {
      customer: customerId,
      billingType: 'PIX',
      value: Number(value) || 0,
      dueDate,
      description: description || undefined,
      externalReference: externalReference || undefined,
    });
    return { id: data.id, status: data.status || 'PENDING', value: data.value, dueDate: data.dueDate || dueDate };
  }

  async updateSubscription({ subscriptionId, value } = {}) {
    const data = await this._http.put(`${this._base}/subscriptions/${subscriptionId}`, { value: Number(value) || 0 }, { headers: this._headers })
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
