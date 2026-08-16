import { useEffect, useMemo, useState } from 'react';
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

// Governança do super-admin é DERIVADA do usuário (sem I/O e sem estado): todos os
// entitlements liberados. Constante estável para não recriar a cada render.
const GOVERNANCA_SUPER_ADMIN: PortalGovernanca = {
  permissoes: {},
  entitlements: {
    estrutura_operacional: { codigo: 'estrutura_operacional', permitido: true },
    integracoes_erp: { codigo: 'integracoes_erp', permitido: true },
    acesso_corporativo_sso: { codigo: 'acesso_corporativo_sso', permitido: true },
  },
};

export function usePortalGovernanca() {
  const { user } = useAuth();
  const isSuper = user?.is_super_admin === true;
  const [buscado, setBuscado] = useState<PortalGovernanca | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Super-admin não busca (derivado por useMemo). Sem usuário, nada a buscar.
    if (!user || isSuper) return undefined;
    let vivo = true;
    setLoading(true);
    api.get('/configuracoes/portal-governanca')
      .then(({ data }) => { if (vivo) setBuscado(data); })
      .catch(() => { if (vivo) setBuscado(null); })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [user, isSuper]);

  const governanca = useMemo(
    () => (isSuper ? GOVERNANCA_SUPER_ADMIN : buscado),
    [isSuper, buscado]
  );

  return { governanca, loading };
}
