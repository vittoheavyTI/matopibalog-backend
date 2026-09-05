import { useEffect, useRef, useState } from 'react';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';

// Status enxuto da contratação do cliente. Usado pela Sidebar (badge de ação
// necessária no item Faturas / Regularização), pelo Layout (banner) e pelo hub de
// Faturas. Fail-open: erro não polui a navegação. Super-admin não contrata.
//
// BUG-002 — a autoridade de QUEM pode ver isto é do BACKEND.
// `/contratacao/status` libera para `company.settings.manage` **ou** para empresa
// `tipo='autonomo'`. Este hook filtrava antes por `role === 'admin'`: um critério
// legado, com autoridade PRÓPRIA e diferente da do servidor.
//
// Correção de escopo, porque a primeira leitura desta auditoria estava errada e não
// vale deixar a história antiga no código: chegou-se a supor um dono de conta
// autônoma "preso" sem caminho para assinar. Isso NÃO acontece no painel web — o
// `ProtectedRoute` já barra todo `role !== 'admin'` antes de qualquer tela, então
// esse usuário nunca chega aqui (ele usa o app). O defeito real era menor e de outra
// natureza: um gate de UI divergente do servidor, e um bloco da Sidebar
// (`role !== 'admin' && contratacaoPendente`) que, por isso, era código MORTO.

export type EstadoContratacao = {
  pendenciaObrigatoria: boolean;
  trialAtivo: boolean;
  trialEndsAt: string | null;
  diasRestantes: number | null;
  podeContratar: boolean;
  trialExpirado: boolean;
  assinaturaPendente: boolean;
  podeDeclinar: boolean;
  planoId: string | null;
  quantidadeContratada: number | null;
};

// S1-HIGH-06 — ESTADO NEUTRO CANÔNICO.
//
// "Não sei nada sobre a contratação" precisa ser um valor explícito, e não a soma
// de dez `useState` que alguém tem de lembrar de zerar um a um. Como objeto único,
// o reset é atômico: ou o estado inteiro é o que o servidor disse, ou é neutro.
export const ESTADO_CONTRATACAO_NEUTRO: EstadoContratacao = Object.freeze({
  pendenciaObrigatoria: false,
  trialAtivo: false,
  trialEndsAt: null,
  diasRestantes: null,
  podeContratar: false,
  trialExpirado: false,
  assinaturaPendente: false,
  podeDeclinar: false,
  planoId: null,
  quantidadeContratada: null,
});

function mapearResposta(data: Record<string, unknown> | null | undefined): EstadoContratacao {
  return {
    pendenciaObrigatoria: data?.pendencia_obrigatoria === true,
    trialAtivo: data?.trial_ativo === true,
    trialEndsAt: (data?.trial_ends_at as string) || null,
    diasRestantes: typeof data?.dias_restantes === 'number' ? data.dias_restantes : null,
    podeContratar: data?.pode_contratar === true,
    trialExpirado: data?.trial_expirado === true,
    assinaturaPendente: data?.assinatura_pendente === true,
    podeDeclinar: data?.pode_declinar === true,
    planoId: (data?.plano_id as string) || null,
    quantidadeContratada: typeof data?.quantidade_contratada === 'number' ? data.quantidade_contratada : null,
  };
}

// §14 — Layout, Sidebar e MinhasFaturas usam este hook, e cada montagem disparava o
// SEU próprio `GET /contratacao/status`: três requisições idênticas e simultâneas
// por carga de página.
//
// A correção é deliberadamente pequena: dedupe do que está EM VOO, não cache de
// resultado. Montagens concorrentes compartilham a mesma promessa; assim que ela
// termina, o registro é descartado e a próxima montagem busca de novo. Um cache de
// resultado economizaria mais, mas introduziria estado velho depois de assinar um
// contrato ou trocar de conta — trocar uma GET por um dado desatualizado no gate
// comercial seria um péssimo negócio.
//
// S1-HIGH-06 — a chave do dedupe é o CONTEXTO, não só o usuário. Só `uid` não serve
// para uma autoridade tenant-aware: dois contextos do mesmo usuário em empresas
// diferentes compartilhariam a mesma promessa, e o segundo receberia a resposta do
// primeiro. A chave é `uid:empresa_id`.
let requisicaoEmVoo: { chave: string; promessa: Promise<unknown> } | null = null;

function buscarStatusDeduplicado(chave: string): Promise<unknown> {
  if (requisicaoEmVoo && requisicaoEmVoo.chave === chave) return requisicaoEmVoo.promessa;
  const promessa = api.get('/contratacao/status')
    .then(({ data }) => data)
    .finally(() => {
      if (requisicaoEmVoo && requisicaoEmVoo.chave === chave) requisicaoEmVoo = null;
    });
  requisicaoEmVoo = { chave, promessa };
  return promessa;
}

/** Só para testes: zera o registro de requisição em voo entre cenários. */
export function _resetDedupeContratacao() {
  requisicaoEmVoo = null;
}

// §10 — `enabled`: com a matriz de autoridade conhecida (`useAreaAuthority`), não
// faz sentido disparar uma requisição que já se sabe que o backend vai negar. O
// hook continua fail-open (403 → estado neutro), mas quem não tem autoridade de
// contratação simplesmente não pergunta.
export function useContratacaoStatus({ enabled = true }: { enabled?: boolean } = {}): EstadoContratacao {
  const { user } = useAuth();
  const [estado, setEstado] = useState<EstadoContratacao>(ESTADO_CONTRATACAO_NEUTRO);

  // Chave do contexto ATIVO. `null` quando não há nada a consultar — e é
  // exatamente essa transição para `null` que precisa zerar o estado.
  const chaveAtiva = enabled && user && !user.is_super_admin
    ? `${user.uid || 'anonimo'}:${user.empresa_id || 'sem-empresa'}`
    : null;

  // S1-HIGH-06 — guarda contra resposta OBSOLETA. Uma requisição do contexto A pode
  // resolver depois de o contexto já ter virado B (ou de a autoridade ter sido
  // perdida). Sem isto, a resposta antiga repopularia o estado e o banner/badge de
  // um tenant apareceria em cima de outro. O `vivo` anterior protegia só a
  // desmontagem; aqui a comparação é com a chave que ainda vale no commit.
  const chaveAtivaRef = useRef<string | null>(chaveAtiva);
  chaveAtivaRef.current = chaveAtiva;

  useEffect(() => {
    // AUTHORITY_LOSS_RESETS_CONTRACT_STATE — perder autoridade, deslogar, virar
    // super-admin ou trocar de tenant volta o estado ao neutro IMEDIATAMENTE, sem
    // esperar requisição nenhuma. O caminho perigoso é o contrário: manter em
    // memória um "contrato pendente" de um contexto que já não vale.
    if (!chaveAtiva) {
      setEstado(ESTADO_CONTRATACAO_NEUTRO);
      return;
    }

    // Contexto novo: enquanto a resposta não chega, o estado do contexto anterior
    // não pode continuar na tela.
    setEstado(ESTADO_CONTRATACAO_NEUTRO);

    const chaveDaRequisicao = chaveAtiva;
    buscarStatusDeduplicado(chaveDaRequisicao)
      .then((data) => {
        if (chaveAtivaRef.current !== chaveDaRequisicao) return; // resposta obsoleta
        setEstado(mapearResposta(data as Record<string, unknown>));
      })
      .catch(() => { /* fail-open: permanece neutro */ });
  }, [chaveAtiva]);

  return estado;
}
