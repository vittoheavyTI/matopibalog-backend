import { useAuth } from '../contexts/AuthContext';

// Hook de conveniência para gates de UI baseados nas permissões efetivas V9.
// O backend continua sendo a autoridade real; isto só decide menu/botões.
export function usePermissions() {
  const { user } = useAuth();
  const eff = user?.effective_permissions;
  const isSuper = user?.is_super_admin === true;

  const can = (key: string): boolean => {
    if (isSuper) return true;
    if (!eff) {
      // Fallback compat (dados V9 ausentes): admin legado enxerga tudo do tenant.
      return user?.role === 'admin';
    }
    return eff[key] === true;
  };

  const canAny = (...keys: string[]) => keys.some((k) => can(k));

  return { can, canAny, isSuper, template: user?.permission_template ?? null };
}
