// Cliente RECONCILE read-only do Asaas production (F3B-2).
//
// APENAS GET: busca customer/charge por externalReference para diagnosticar o
// estado após uma tentativa que falhou (ex.: HTTP 400). NUNCA faz POST/PUT/DELETE,
// NUNCA cria/edita nada. Independente do gate de ESCRITA (leitura é segura), mas
// exige o ASAAS_API_KEY presente — sem ele, devolve { secret_present:false } para
// o núcleo sinalizar "rodar via Railway".
//
// A apiKey vai só no header (nunca na URL/log). Base fixa em production.

const axios = require('axios');

const BASE_PRODUCTION = 'https://api.asaas.com/v3';

function headers(apiKey) {
  return { access_token: apiKey, 'Content-Type': 'application/json', 'User-Agent': 'MatopibaLog/1.0 (Node.js; reconcile)' };
}

function primeiro(data) {
  const lista = Array.isArray(data && data.data) ? data.data : [];
  return lista.length ? lista[0] : null;
}

async function getPorRef(http, base, path, ref, apiKey) {
  try {
    const { data } = await http.get(`${base}${path}?externalReference=${encodeURIComponent(ref)}`, { headers: headers(apiKey) });
    return primeiro(data);
  } catch (e) {
    if (e && e.response && e.response.status === 404) return null;
    throw e;
  }
}

// Reconcilia (read-only) o customer (por empresaId) e a charge (por chargeRef).
async function reconciliar({ empresaId, chargeRef, env = process.env, http = axios, base = BASE_PRODUCTION } = {}) {
  const apiKey = env.ASAAS_API_KEY;
  if (!apiKey) return { secret_present: false };

  const cust = await getPorRef(http, base, '/customers', String(empresaId), apiKey);
  const chg = await getPorRef(http, base, '/payments', String(chargeRef), apiKey);

  return {
    secret_present: true,
    customer: cust ? { id: cust.id } : null,
    charge: chg ? { id: chg.id, status: chg.status || null, value: chg.value ?? null, billingType: chg.billingType || null } : null,
  };
}

module.exports = { BASE_PRODUCTION, reconciliar };
