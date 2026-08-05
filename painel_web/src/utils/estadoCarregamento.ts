// Máquina de estados PURA de carregamento de dados (sem React, sem I/O).
// Fonte única para separar explicitamente os estados exigidos pelo protocolo de
// não-regressão: idle, loading, sucesso (com dados), vazio (sucesso sem dados),
// erro (com tipo: timeout/nao_autorizado/proibido/rate_limited/servidor/rede/generico)
// e cancelado (navegação/desmontagem — NÃO é erro).
//
// Regras encodadas (testáveis sem DOM):
//   - erro NUNCA vira "vazio" (estados distintos);
//   - resposta válida vazia é 'vazio', diferente de 'erro';
//   - requisição cancelada NÃO gera erro nem toast;
//   - resposta antiga (reqId menor que o atual) é IGNORADA (não sobrescreve a nova);
//   - após falha com dados anteriores, marca `desatualizado` (nunca "atual" silencioso).

export type Status = 'idle' | 'loading' | 'sucesso' | 'vazio' | 'erro';
export type TipoErro =
  | 'timeout' | 'nao_autorizado' | 'proibido' | 'rate_limited'
  | 'servidor' | 'rede' | 'generico';

export interface ErroCarregamento {
  tipo: TipoErro;
  mensagem: string;
}

export interface EstadoCarregamento<T> {
  status: Status;
  dados: T | null;
  erro: ErroCarregamento | null;
  desatualizado: boolean; // dados anteriores mantidos após falha
  reqId: number;          // id da última requisição aplicada (stale-guard)
}

export function estadoInicial<T>(): EstadoCarregamento<T> {
  return { status: 'idle', dados: null, erro: null, desatualizado: false, reqId: 0 };
}

// Classifica um erro (axios-like) em tipo + mensagem amigável. 'cancelado' é
// sinalizado à parte porque NÃO deve virar estado de erro.
export function classificarErro(e: any): ErroCarregamento | { cancelado: true } {
  const nome = e?.name || '';
  const code = e?.code || '';
  if (e?.cancelado === true || code === 'ERR_CANCELED' || nome === 'CanceledError' || nome === 'AbortError') {
    return { cancelado: true };
  }
  if (code === 'ECONNABORTED' || /timeout/i.test(String(e?.message || ''))) {
    return { tipo: 'timeout', mensagem: 'A solicitação demorou demais. Verifique a conexão e tente novamente.' };
  }
  const st: number | undefined = e?.response?.status;
  if (st === 401) return { tipo: 'nao_autorizado', mensagem: 'Sua sessão expirou. Entre novamente.' };
  if (st === 403) return { tipo: 'proibido', mensagem: 'Você não tem permissão para ver estes dados.' };
  if (st === 429) return { tipo: 'rate_limited', mensagem: 'Muitas requisições. Aguarde alguns instantes e tente novamente.' };
  if (typeof st === 'number' && st >= 500) return { tipo: 'servidor', mensagem: 'Erro no servidor. Tente novamente em instantes.' };
  if (typeof st === 'number' && st >= 400) return { tipo: 'generico', mensagem: 'Não foi possível carregar. Tente novamente.' };
  return { tipo: 'rede', mensagem: 'Falha de conexão. Verifique a internet e tente novamente.' };
}

export type Evento<T> =
  | { tipo: 'iniciar'; reqId: number }
  | { tipo: 'sucesso'; reqId: number; dados: T[]; }
  | { tipo: 'falha'; reqId: number; erro: any };

// Considera "vazio" quando a resposta válida é uma lista sem itens.
function ehVazio<T>(dados: T[] | null): boolean {
  return Array.isArray(dados) && dados.length === 0;
}

export function reduzir<T>(estado: EstadoCarregamento<T[]>, ev: Evento<T>): EstadoCarregamento<T[]> {
  switch (ev.tipo) {
    case 'iniciar':
      // Não descarta dados anteriores (evita "flash" vazio); só marca loading.
      return { ...estado, status: 'loading', erro: null, reqId: ev.reqId };

    case 'sucesso': {
      if (ev.reqId < estado.reqId) return estado; // resposta obsoleta: ignora
      return {
        status: ehVazio(ev.dados) ? 'vazio' : 'sucesso',
        dados: ev.dados,
        erro: null,
        desatualizado: false,
        reqId: ev.reqId,
      };
    }

    case 'falha': {
      if (ev.reqId < estado.reqId) return estado; // resposta obsoleta: ignora
      const cls = classificarErro(ev.erro);
      if ('cancelado' in cls) {
        // Cancelamento por navegação/desmontagem NÃO é erro. Encerra o loading
        // desta requisição sem toast e sem sobrescrever dados.
        return estado.status === 'loading' && ev.reqId >= estado.reqId
          ? { ...estado, status: estado.dados != null ? (ehVazio(estado.dados) ? 'vazio' : 'sucesso') : 'idle' }
          : estado;
      }
      // Erro real: estado 'erro' DISTINTO de 'vazio'. Se havia dados, mantém como
      // desatualizados (nunca some silenciosamente, nunca finge estar atual).
      return {
        status: 'erro',
        dados: estado.dados,
        erro: cls,
        desatualizado: estado.dados != null,
        reqId: ev.reqId,
      };
    }

    default:
      return estado;
  }
}

// Deriva o que a UI deve mostrar. Garante que ERRO e VAZIO nunca coincidam.
export function derivarView<T>(e: EstadoCarregamento<T[]>) {
  return {
    mostrarLoading: e.status === 'loading' && e.dados == null,
    mostrarErro: e.status === 'erro',
    mostrarVazio: e.status === 'vazio',
    mostrarDados: (e.status === 'sucesso') || (e.dados != null && e.status !== 'vazio'),
    desatualizado: e.desatualizado,
    podeTentarNovamente: e.status === 'erro',
    mensagemErro: e.erro?.mensagem || null,
    tipoErro: e.erro?.tipo || null,
  };
}
