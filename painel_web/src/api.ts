import axios from 'axios';

const api = axios.create({
  // Tente adicionar o /api no final do baseURL se suas rotas do backend usam /api
  baseURL: import.meta.env.VITE_API_URL || 'https://matopibalog-backend-production.up.railway.app',
  withCredentials: false, // Não depender de cookie; usaremos Bearer token em Authorization
});

// Envia Authorization: Bearer <token> em todas as requisições quando presente
api.interceptors.request.use((config) => {
  try {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers = config.headers || {};
      (config.headers as any).Authorization = `Bearer ${token}`;
    }
  } catch (e) {
    // ignore
  }
  return config;
});

// Mantemos apenas o interceptor de resposta para avisar o sistema caso o login expire (Erro 401)
api.interceptors.response.use((response) => {
  return response;
}, (error) => {
  if (error.response && error.response.status === 401) {
    const url: string = error.config?.url ?? '';
    if (!url.includes('/auth/me') && !url.includes('/auth/login')) {
      window.dispatchEvent(new Event('auth:unauthorized'));
    }
  }
  return Promise.reject(error);
});

/**
 * Gera um identificador único por tentativa de envio, usado para idempotência de
 * lançamentos (despesa/abastecimento/vale). O backend deduplica por
 * (motorista_id, client_request_id), então o mesmo envio/retry deve reusar o
 * mesmo id e um novo lançamento deve receber um id novo.
 *
 * Sem dependência externa: usa crypto.randomUUID() quando disponível (contexto
 * seguro/HTTPS) e cai para um UUID v4 montado com crypto.getRandomValues.
 */
export function newClientRequestId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  // Versão (4) e variante (10xx) conforme RFC 4122.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default api;
