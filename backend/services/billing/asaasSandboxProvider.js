// Adapter REAL do Asaas — restrito a SANDBOX (macrofrente 3A-2, §3).
//
// Implementa o MESMO contrato do fakeAsaasProvider, para que o orquestrador e os
// testes usem um único motor. Fail-closed para PRODUÇÃO: recusa construir se o
// environment/host não for inequivocamente sandbox.
//
// Documentação oficial (contrato técnico usado — registrado, não copiado):
//   Base URL sandbox : https://sandbox.asaas.com/api/v3
//   Auth             : header `access_token: <API key sandbox>`
//   POST /customers            → { id, ... }
//   POST /subscriptions        → { id, nextDueDate, status, ... }
//   POST /payments             → { id, status, value, dueDate, ... }
//   DELETE /subscriptions/:id  → { deleted, id }
//   GET  /customers/:id | /subscriptions/:id | /payments/:id
//   Dedup: usamos `externalReference` + busca prévia para evitar duplicatas.
//
// NÃO loga API key / Authorization / payload sensível.

const HOST_SANDBOX = 'sandbox.asaas.com';
const BASE_SANDBOX = 'https://sandbox.asaas.com/api/v3';

function ehSandbox({ environment, baseURL } = {}) {
  const envOk = String(environment || '').toLowerCase() === 'sandbox';
  const hostOk = typeof baseURL === 'string' && baseURL.includes(HOST_SANDBOX);
  // Bloqueio explícito: qualquer indício de produção reprova.
  const pareceProducao = typeof baseURL === 'string' && /(^|\.)api\.asaas\.com/.test(baseURL);
  return envOk && hostOk && !pareceProducao;
}

class AsaasSandboxProvider {
  // config: { environment:'sandbox', baseURL, apiKey }; http: cliente axios-like.
  constructor({ config, http } = {}) {
    if (!ehSandbox(config)) {
      throw new Error('AsaasSandboxProvider recusado: environment/host não é sandbox inequívoco (fail-closed).');
    }
    if (!config.apiKey) {
      throw new Error('AsaasSandboxProvider: apiKey sandbox ausente.');
    }
    this._http = http;
    this._base = config.baseURL || BASE_SANDBOX;
    this._headers = { access_token: config.apiKey, 'Content-Type': 'application/json' };
    this.environment = 'sandbox';
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

  // Busca customer sintético por externalReference (dedup antes de criar).
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

  async cancelSubscription({ subscriptionId } = {}) {
    const data = await this._http.delete(`${this._base}/subscriptions/${subscriptionId}`, { headers: this._headers })
      .then((r) => r.data)
      .catch((e) => (e?.response?.status === 404 ? { deleted: true } : Promise.reject(e)));
    return { id: subscriptionId, status: 'CANCELLED', deleted: data?.deleted !== false };
  }

  async getCustomer(id) { return this._get(`/customers/${id}`); }
  async getSubscription(id) { return this._get(`/subscriptions/${id}`); }
  async getCharge(id) { return this._get(`/payments/${id}`); }
}

module.exports = { AsaasSandboxProvider, ehSandbox, HOST_SANDBOX, BASE_SANDBOX };
