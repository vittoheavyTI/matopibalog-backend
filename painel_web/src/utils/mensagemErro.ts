// Normalizador central de mensagens de erro para exibição ao usuário.
//
// Objetivo: NUNCA vazar texto cru do Axios ("Request failed with status code 401",
// "Network Error") nem detalhe técnico (stack, SQL, constraint) na tela. A regra é:
//   1. sem resposta HTTP  → falha de rede/servidor fora do ar;
//   2. com resposta       → priorizar a mensagem em português que o backend já envia
//      (chave `message`; ou `error` no contrato de token) — preserva 409 documento
//      duplicado, 422 Asaas, 403 super-admin, etc.;
//   3. sem mensagem no corpo → fallback amigável por categoria de status;
//   4. erro não-HTTP (exceção JS, Supabase) → fallback do chamador.
//
// Este helper NÃO substitui o interceptor de `api.ts` (que trata logout por sessão):
// ele só traduz o erro em texto para exibir; não altera fluxo de autenticação.

// Extrai uma string de mensagem específica do corpo da resposta, se houver.
function mensagemDoCorpo(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const corpo = data as { message?: unknown; error?: unknown };
  if (typeof corpo.message === 'string' && corpo.message.trim()) return corpo.message.trim();
  if (typeof corpo.error === 'string' && corpo.error.trim()) return corpo.error.trim();
  return null;
}

/**
 * Converte qualquer erro (Axios, Supabase, exceção comum) numa mensagem em português
 * segura para exibir ao usuário. Nunca retorna `err.message` cru do Axios.
 *
 * @param err      o erro capturado no catch
 * @param fallback texto amigável quando não há mensagem específica nem categoria conhecida
 */
export function mensagemErro(
  err: unknown,
  fallback = 'Não foi possível concluir a ação. Tente novamente.'
): string {
  const anyErr = err as { isAxiosError?: boolean; response?: { status?: number; data?: unknown } } | undefined;
  const response = anyErr?.response;
  const ehAxios = Boolean(anyErr && anyErr.isAxiosError);

  // 1. Erro Axios SEM resposta = rede/CORS/servidor indisponível ou requisição abortada.
  if (ehAxios && !response) {
    return 'Sem conexão com o servidor. Verifique sua internet e tente novamente.';
  }

  // 2. Mensagem específica do backend (português) tem prioridade máxima.
  const especifica = response ? mensagemDoCorpo(response.data) : null;
  if (especifica) return especifica;

  // 3. Sem mensagem no corpo: fallback amigável por categoria de status HTTP.
  const status = response?.status;
  if (status === 401) return 'Sessão inválida ou credenciais incorretas. Entre novamente.';
  if (status === 403) return 'Você não tem permissão para esta ação.';
  if (status === 404) return 'Recurso não encontrado.';
  if (status === 409) return 'Este registro já existe.';
  if (typeof status === 'number' && status >= 500) {
    return 'O servidor encontrou um erro. Tente novamente em instantes.';
  }

  // 4. Erro não-HTTP (exceção JS, erro do Supabase em inglês, etc.) → fallback do chamador.
  return fallback;
}
