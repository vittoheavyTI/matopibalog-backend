import { useEffect, useState } from 'react';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';

export type PortalEntitlement = {
  codigo: string;
  permitido: boolean;
  origem?: string | null;
  disponibilidade?: string | null;
  motivo?: string | null;
  proxima_acao?: string | null;
};

export type PortalGovernanca = {
  permissoes: Record<string, boolean>;
  entitlements: {
    estrutura_operacional?: PortalEntitlement;
    integracoes_erp?: PortalEntitlement;
    acesso_corporativo_sso?: PortalEntitlement;
  };
  integracoes?: {
    erp?: { configurado: boolean; modo: string };
    sso?: { configurado: boolean; modo: string };
  };
};

export function usePortalGovernanca() {
  const { user } = useAuth();
  const [governanca, setGovernanca] = useState<PortalGovernanca | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user || user.is_super_admin) {
      setGovernanca(user?.is_super_admin ? {
        permissoes: {},
        entitlements: {
          estrutura_operacional: { codigo: 'estrutura_operacional', permitido: true },
          integracoes_erp: { codigo: 'integracoes_erp', permitido: true },
          acesso_corporativo_sso: { codigo: 'acesso_corporativo_sso', permitido: true },
        },
      } : null);
      return undefined;
    }
    let vivo = true;
    setLoading(true);
    api.get('/configuracoes/portal-governanca')
      .then(({ data }) => { if (vivo) setGovernanca(data); })
      .catch(() => { if (vivo) setGovernanca(null); })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [user?.uid, user?.is_super_admin]);

  return { governanca, loading };
}
