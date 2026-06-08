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

export default api;
