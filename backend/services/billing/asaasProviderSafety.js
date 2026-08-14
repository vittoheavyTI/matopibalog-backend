const APP_USER_AGENT_BASE = 'MatopibaLog/1.0';

function userAgentFor(environment) {
  const env = String(environment || 'unknown').toLowerCase();
  return `${APP_USER_AGENT_BASE} (Node.js; ${env})`;
}

function asaasHeaders({ apiKey, environment }) {
  return {
    access_token: apiKey,
    'Content-Type': 'application/json',
    'User-Agent': userAgentFor(environment),
  };
}

function canonicalCustomerReference(empresaId) {
  return empresaId ? String(empresaId) : null;
}

function canonicalSubscriptionReference(empresaId) {
  return empresaId ? `matopiba:billing:v1:subscription:monthly:${empresaId}` : null;
}

function canonicalImplantationChargeReference(empresaId) {
  return empresaId ? `matopiba:billing:v1:charge:implantation:${empresaId}` : null;
}

function erroPodeTerCommitado(err) {
  const status = err?.response?.status ?? err?.httpStatus ?? err?.status;
  if (err?.code === 'ETIMEDOUT') return true;
  if (status === 0 || status === 408 || status === 429) return true;
  return typeof status === 'number' && status >= 500;
}

function primeiroItem(data) {
  const lista = Array.isArray(data?.data) ? data.data : [];
  return lista.length ? lista[0] : null;
}

module.exports = {
  APP_USER_AGENT_BASE,
  userAgentFor,
  asaasHeaders,
  canonicalCustomerReference,
  canonicalSubscriptionReference,
  canonicalImplantationChargeReference,
  erroPodeTerCommitado,
  primeiroItem,
};
