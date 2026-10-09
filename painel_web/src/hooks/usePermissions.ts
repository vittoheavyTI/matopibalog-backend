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
      // R1A: MISSING_EFFECTIVE_PERMISSIONS=DENY
      // role='admin' não confere autoridade de permissão. Sem permissões efetivas V9 hidratadas,
      // nega acesso a capabilities da UI por padrão (exceto super-admin).
      return false;
    }
    return eff[key] === true;
  };

  const canAny = (...keys: string[]) => keys.some((k) => can(k));

  return { can, canAny, isSuper, template: user?.permission_template ?? null };
}
