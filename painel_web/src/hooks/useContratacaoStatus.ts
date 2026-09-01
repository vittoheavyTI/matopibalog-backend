import { useEffect, useState } from 'react';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';

// Status enxuto da contratação do cliente. Usado pela Sidebar (badge de ação
// necessária no item Faturas / Regularização) e pelo Layout (banner). Fail-open:
// erro não polui a navegação. Não consulta para super-admin, que não contrata.
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
//
// Agora perguntamos e deixamos o servidor decidir: 403 cai no `catch` e o estado
// permanece neutro — mesma UI de antes, sem uma segunda autoridade inventada aqui.
// §14 — Layout, Sidebar e MinhasFaturas usam este hook, e cada montagem disparava
// o SEU próprio `GET /contratacao/status`: três requisições idênticas e simultâneas
// por carga de página.
//
// A correção é deliberadamente pequena: dedupe do que está EM VOO, não cache de
// resultado. Montagens concorrentes compartilham a mesma promessa; assim que ela
// termina, o registro é descartado e a próxima montagem busca de novo. Um cache de
// resultado economizaria mais, mas introduziria estado velho depois de assinar um
// contrato ou trocar de conta — trocar uma GET por um dado desatualizado no gate
// comercial seria um péssimo negócio.
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

// §10 — `enabled`: com a matriz de autoridade conhecida (`useAreaAuthority`), não
// faz sentido disparar uma requisição que já se sabe que o backend vai negar. O
// hook continua fail-open (403 → estado neutro), mas quem não tem autoridade de
// contratação simplesmente não pergunta. O dedupe em voo permanece.
export function useContratacaoStatus({ enabled = true }: { enabled?: boolean } = {}) {
  const { user } = useAuth();
  const [pendenciaObrigatoria, setPendenciaObrigatoria] = useState(false);
  const [trialAtivo, setTrialAtivo] = useState(false);
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [diasRestantes, setDiasRestantes] = useState<number | null>(null);
  const [podeContratar, setPodeContratar] = useState(false);
  const [trialExpirado, setTrialExpirado] = useState(false);
  const [assinaturaPendente, setAssinaturaPendente] = useState(false);
  const [podeDeclinar, setPodeDeclinar] = useState(false);
  const [planoId, setPlanoId] = useState<string | null>(null);
  const [quantidadeContratada, setQuantidadeContratada] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (!user || user.is_super_admin) return;
    let vivo = true;
    buscarStatusDeduplicado(user.uid || 'anonimo')
      .then((data: any) => {
        if (!vivo) return;
        setPendenciaObrigatoria(data?.pendencia_obrigatoria === true);
        setTrialAtivo(data?.trial_ativo === true);
        setTrialEndsAt(data?.trial_ends_at || null);
        setDiasRestantes(typeof data?.dias_restantes === 'number' ? data.dias_restantes : null);
        setPodeContratar(data?.pode_contratar === true);
        setTrialExpirado(data?.trial_expirado === true);
        setAssinaturaPendente(data?.assinatura_pendente === true);
        setPodeDeclinar(data?.pode_declinar === true);
        setPlanoId(data?.plano_id || null);
        setQuantidadeContratada(typeof data?.quantidade_contratada === 'number' ? data.quantidade_contratada : null);
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [user?.uid, user?.is_super_admin, enabled]);

  return {
    pendenciaObrigatoria,
    trialAtivo,
    trialEndsAt,
    diasRestantes,
    podeContratar,
    trialExpirado,
    assinaturaPendente,
    podeDeclinar,
    planoId,
    quantidadeContratada,
  };
}
