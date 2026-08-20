import type { ReactNode } from 'react';
import { usePermissions } from '../hooks/usePermissions';

// P2 — guarda de rota por permissão efetiva. Bloqueia acesso direto por URL a quem
// não tem a capability (não basta esconder no Sidebar). O backend continua a
// autoridade real (403); isto evita renderizar a tela protegida no cliente.
export function PermissionRoute({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = usePermissions();
  if (!can(permission)) {
    return (
      <div className="p-8 max-w-lg mx-auto text-center">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Acesso restrito</h2>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Você não tem permissão para acessar esta área. Fale com um administrador da sua empresa
          para receber a permissão necessária.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
