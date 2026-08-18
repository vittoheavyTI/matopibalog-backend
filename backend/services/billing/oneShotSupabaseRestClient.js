// Cliente Supabase MÍNIMO e READ-ONLY para o executor one-shot (CLI).
//
// Motivo (F3A): o `config/supabase` importa `@supabase/supabase-js`, que instancia
// o Realtime (WebSocket/heartbeat). No Windows/Railway CLI isso deixava handles
// abertos e derrubava o processo com `Assertion failed: !(handle->flags &
// UV_HANDLE_CLOSING)` DEPOIS do output do dry-run. Este cliente usa só HTTP REST
// (PostgREST via axios) — SEM Realtime/WebSocket, SEM handles pendurados.
//
// Somente LEITURA. Nunca escreve. A service key vai nos HEADERS (nunca na URL) e
// NUNCA é logada.

const axios = require('axios');

const COLUNAS_EMPRESA = 'id,nome,email_contato,cnpj,asaas_customer_id,asaas_subscription_id,plano_id,commercial_flow_version';

// Fail-closed: sem URL/KEY, aborta antes de qualquer uso.
function resolverEnvRest(env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    const e = new Error('SUPABASE_URL/SUPABASE_SERVICE_KEY ausentes (cliente REST one-shot fail-closed).');
    e.code = 'REST_ENV_AUSENTE';
    throw e;
  }
  return { url: String(url).replace(/\/+$/, ''), key: String(key) };
}

// Headers com a service key — objeto efêmero, nunca logado.
function montarHeaders(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json', ...extra };
}

// Busca a empresa por id (read-only). Retorna o registro ou null. A key vai só
// no header; a URL contém apenas o id (não é dado pessoal completo).
async function buscarEmpresaPorId(id, { env = process.env, http = axios } = {}) {
  const { url, key } = resolverEnvRest(env);
  const endpoint = `${url}/rest/v1/empresas?id=eq.${encodeURIComponent(id)}&select=${COLUNAS_EMPRESA}`;
  const { data } = await http.get(endpoint, { headers: montarHeaders(key) });
  return Array.isArray(data) && data.length ? data[0] : null;
}

// Conta eventos de billing_outbox pendentes/falhados (best-effort). Usa
// Prefer: count=exact + Range 0-0 para ler o total pelo header content-range sem
// baixar linhas. Retorna número (0 se vazio).
async function contarOutboxPendentes({ env = process.env, http = axios } = {}) {
  const { url, key } = resolverEnvRest(env);
  const endpoint = `${url}/rest/v1/billing_outbox?status=in.(pendente,failed)&select=id`;
  const resp = await http.get(endpoint, { headers: montarHeaders(key, { Prefer: 'count=exact', Range: '0-0' }) });
  const headers = resp && resp.headers ? resp.headers : {};
  const cr = headers['content-range'] || headers['Content-Range'];
  if (cr && String(cr).includes('/')) {
    const total = Number(String(cr).split('/').pop());
    if (Number.isFinite(total)) return total;
  }
  return Array.isArray(resp && resp.data) ? resp.data.length : 0;
}

// Conta faturas (read-only). Com empresaId → filtra por empresa; sem → total global.
async function contarFaturas({ empresaId = null, env = process.env, http = axios } = {}) {
  const { url, key } = resolverEnvRest(env);
  const filtro = empresaId ? `empresa_id=eq.${encodeURIComponent(empresaId)}&` : '';
  const endpoint = `${url}/rest/v1/faturas?${filtro}select=id`;
  const resp = await http.get(endpoint, { headers: montarHeaders(key, { Prefer: 'count=exact', Range: '0-0' }) });
  const headers = resp && resp.headers ? resp.headers : {};
  const cr = headers['content-range'] || headers['Content-Range'];
  if (cr && String(cr).includes('/')) {
    const total = Number(String(cr).split('/').pop());
    if (Number.isFinite(total)) return total;
  }
  return Array.isArray(resp && resp.data) ? resp.data.length : 0;
}

module.exports = {
  COLUNAS_EMPRESA,
  resolverEnvRest,
  montarHeaders,
  buscarEmpresaPorId,
  contarOutboxPendentes,
  contarFaturas,
};
