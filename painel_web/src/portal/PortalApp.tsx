import { Navigate, Route, Routes } from 'react-router-dom';
import { PortalAuthProvider, usePortalAuth } from './PortalAuthContext';
import PortalLayout from './PortalLayout';
import PortalLogin from './PortalLogin';
import PortalAtivarConvite from './PortalAtivarConvite';
import PortalInicio from './PortalInicio';
import PortalNovaSolicitacao from './PortalNovaSolicitacao';
import PortalOperacao from './PortalOperacao';
import PortalLista from './PortalLista';
import { Carregando } from './PortalUI';

// Árvore de rotas do Portal do Embarcador, isolada da árvore interna.
//
// O isolamento é o ponto: este componente tem seu PRÓPRIO provider de sessão e
// seu próprio cliente HTTP. Um operador da transportadora logado no painel não
// "vira" um embarcador ao navegar para cá, e vice-versa — as duas sessões
// coexistem no mesmo navegador sem se misturar (§26).

function PortalProtegido({ children }: { children: React.ReactNode }) {
  const { carregando, autenticado } = usePortalAuth();
  // Espera a restauração da sessão antes de decidir. Redirecionar durante o
  // carregamento jogaria para o login quem já está autenticado.
  if (carregando) return <Carregando rotulo="Carregando seu portal…" />;
  if (!autenticado) return <Navigate to="/portal/embarcador/entrar" replace />;
  return <>{children}</>;
}

export default function PortalApp() {
  return (
    <PortalAuthProvider>
      <Routes>
        <Route path="entrar" element={<PortalLogin />} />
        <Route path="convite" element={<PortalAtivarConvite />} />

        <Route element={<PortalProtegido><PortalLayout /></PortalProtegido>}>
          <Route index element={<PortalInicio />} />
          <Route path="solicitacoes" element={<PortalLista modo="solicitacoes" />} />
          <Route path="solicitacoes/nova" element={<PortalNovaSolicitacao />} />
          <Route path="operacoes" element={<PortalLista modo="operacoes" />} />
          <Route path="operacoes/:id" element={<PortalOperacao />} />
        </Route>

        <Route path="*" element={<Navigate to="/portal/embarcador" replace />} />
      </Routes>
    </PortalAuthProvider>
  );
}
