import axios from 'axios';

// Cliente HTTP do Portal do Embarcador — instância SEPARADA de `src/api.ts`.
//
// Isso não é organização de código, é segurança. O `api.ts` interno injeta
// `Authorization: Bearer <auth_token>` em TODA requisição a partir do
// localStorage do painel. Se o portal reusasse aquela instância, um operador da
// transportadora logado no mesmo navegador mandaria a credencial INTERNA para as
// rotas externas — e um embarcador logado mandaria a credencial de portal para
// rotas internas. O backend recusa os dois casos (403), mas o cliente nunca deve
// chegar a tentar: contextos distintos, clientes distintos, chaves distintas.
//
// `withCredentials` fica desligado de propósito: a sessão do portal é
// exclusivamente por Bearer token, e mandar cookies do domínio interno para cá
// só criaria ambiguidade sobre qual credencial está valendo.

export const PORTAL_TOKEN_KEY = 'matopibalog_portal_token';

const portalApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'https://api.matopibalog.com.br',
  withCredentials: false,
  timeout: 30000,
});

portalApi.interceptors.request.use((config) => {
  try {
    const token = localStorage.getItem(PORTAL_TOKEN_KEY);
    if (token) {
      config.headers = config.headers || {};
      (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
    }
  } catch {
    // localStorage indisponível (modo privado/bloqueado): segue sem credencial e
    // o backend responde 401, que a UI trata como "faça login".
  }
  return config;
});

export function guardarTokenPortal(token: string) {
  try { localStorage.setItem(PORTAL_TOKEN_KEY, token); } catch { /* ignora */ }
}

export function limparTokenPortal() {
  try { localStorage.removeItem(PORTAL_TOKEN_KEY); } catch { /* ignora */ }
}

export function lerTokenPortal(): string | null {
  try { return localStorage.getItem(PORTAL_TOKEN_KEY); } catch { return null; }
}

// Mensagem de erro sempre acionável e em português. O backend já devolve texto
// pronto para o usuário externo; aqui só garantimos que nunca cai um "[object
// Object]" ou uma exceção crua na tela (§70/§83).
export function mensagemDeErro(erro: unknown, padrao = 'Não foi possível concluir a operação. Tente novamente.'): string {
  const resposta = (erro as { response?: { data?: { message?: string } } })?.response;
  const doServidor = resposta?.data?.message;
  if (typeof doServidor === 'string' && doServidor.trim()) return doServidor;
  const rede = (erro as { code?: string })?.code;
  if (rede === 'ECONNABORTED') return 'A conexão demorou demais. Verifique sua internet e tente novamente.';
  if (!resposta) return 'Não foi possível falar com o servidor. Verifique sua internet e tente novamente.';
  return padrao;
}

export function codigoDoErro(erro: unknown): string | null {
  const codigo = (erro as { response?: { data?: { code?: string } } })?.response?.data?.code;
  return typeof codigo === 'string' ? codigo : null;
}

export default portalApi;
