import { useEffect, useState } from 'react';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';

// Status enxuto da contratação do cliente. Usado pela Sidebar (badge de ação
// necessária no item Faturas / Regularização) e pelo Layout (banner). Fail-open:
// erro não polui a navegação. Não consulta para super-admin, que não contrata.
//
// BUG-002 — a autoridade de QUEM pode ver isto é do BACKEND. `/contratacao/status`
// libera para `company.settings.manage` **ou** para empresa `tipo='autonomo'`.
// Este hook filtrava antes por `role === 'admin'`, um critério legado, mais
// estreito e simplesmente DIFERENTE do servidor. A consequência era um beco sem
// saída: o dono de conta autônoma (cujo `role` costuma ser `motorista`) precisava
// assinar o contrato, mas o hook nunca perguntava — então `pendenciaObrigatoria`
// ficava `false` para sempre, o banner do Layout nunca aparecia e a "salvaguarda"
// da Sidebar, escrita exatamente para esse caso, era código morto. O usuário
// obrigado a assinar não tinha caminho nenhum para assinar.
//
// Agora perguntamos e deixamos o servidor decidir: 403 cai no `catch` e o estado
// permanece neutro, que é o mesmo efeito de não perguntar — sem o beco sem saída.
export function useContratacaoStatus() {
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
    if (!user || user.is_super_admin) return;
    let vivo = true;
    api.get('/contratacao/status')
      .then(({ data }) => {
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
  }, [user?.uid, user?.is_super_admin]);

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
