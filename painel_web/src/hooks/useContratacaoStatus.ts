import { useEffect, useState } from 'react';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';

// Status enxuto da contratação do cliente (admin de empresa). Usado pela Sidebar
// (item condicional) e pelo Layout (banner de ação necessária). Fail-open: erro
// não polui a navegação. Só consulta para o cliente (não super-admin).
export function useContratacaoStatus() {
  const { user } = useAuth();
  const [pendenciaObrigatoria, setPendenciaObrigatoria] = useState(false);

  useEffect(() => {
    if (user?.is_super_admin || user?.role !== 'admin') return;
    let vivo = true;
    api.get('/contratacao/status')
      .then(({ data }) => { if (vivo) setPendenciaObrigatoria(data?.pendencia_obrigatoria === true); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [user?.is_super_admin, user?.role]);

  return { pendenciaObrigatoria };
}
