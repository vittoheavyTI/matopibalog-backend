import axios from 'axios';

const api = axios.create({
  // Tente adicionar o /api no final do baseURL se suas rotas do backend usam /api
  baseURL: import.meta.env.VITE_API_URL || 'http://matopibalog.com.br/api',
  withCredentials: true, // ESSENCIAL: Isso faz o navegador enviar o Cookie HTTPOnly
});

// Mantemos apenas o interceptor de resposta para avisar o sistema caso o login expire (Erro 401)
api.interceptors.response.use((response) => {
  return response;
}, (error) => {
  if (error.response && error.response.status === 401) {
    // Se o backend disser que o cookie expirou, avisamos o React para voltar pra tela de login
    window.dispatchEvent(new Event('auth:unauthorized'));
  }
  return Promise.reject(error);
});

export default api;
