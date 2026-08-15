import { useEffect, useState } from 'react';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';

// Status enxuto da contratação do cliente (admin de empresa). Usado pela Sidebar
// (item condicional) e pelo Layout (banner de ação necessária). Fail-open: erro
// não polui a navegação. Só consulta para o cliente (não super-admin).
export function useContratacaoStatus() {
  const { user } = useAuth();
  const [pendenciaObrigatoria, setPendenciaObrigatoria] = useState(false);
  const [trialAtivo, setTrialAtivo] = useState(false);
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [diasRestantes, setDiasRestantes] = useState<number | null>(null);
  const [podeContratar, setPodeContratar] = useState(false);

  useEffect(() => {
    if (user?.is_super_admin || user?.role !== 'admin') return;
    let vivo = true;
    api.get('/contratacao/status')
      .then(({ data }) => {
        if (!vivo) return;
        setPendenciaObrigatoria(data?.pendencia_obrigatoria === true);
        setTrialAtivo(data?.trial_ativo === true);
        setTrialEndsAt(data?.trial_ends_at || null);
        setDiasRestantes(typeof data?.dias_restantes === 'number' ? data.dias_restantes : null);
        setPodeContratar(data?.pode_contratar === true);
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [user?.is_super_admin, user?.role]);

  return { pendenciaObrigatoria, trialAtivo, trialEndsAt, diasRestantes, podeContratar };
}
