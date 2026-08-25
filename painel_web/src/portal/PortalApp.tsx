import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { PortalAuthProvider, usePortalAuth } from './PortalAuthContext';
import PortalLayout from './PortalLayout';
import PortalLogin from './PortalLogin';
import PortalAtivarConvite from './PortalAtivarConvite';
import PortalInicio from './PortalInicio';
import PortalNovaSolicitacao from './PortalNovaSolicitacao';
import PortalOperacao from './PortalOperacao';
import PortalLista from './PortalLista';
import PortalDocumentos from './PortalDocumentos';
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

// Compatibilidade das URLs antigas (§49). O link que um embarcador salvou ou
// recebeu por mensagem antes da renomeação continua funcionando — ele não tem
// como saber que "operacoes" virou "pedidos". Redireciona preservando o id e a
// querystring, então `?acao=corrigir` e `?enviada=1` sobrevivem.
function RedirecionarDetalheAntigo() {
  const { id = '' } = useParams();
  const busca = typeof window !== 'undefined' ? window.location.search : '';
  return <Navigate to={`/portal/embarcador/pedidos/${id}${busca}`} replace />;
}

export default function PortalApp() {
  return (
    <PortalAuthProvider>
      <Routes>
        <Route path="entrar" element={<PortalLogin />} />
        <Route path="convite" element={<PortalAtivarConvite />} />

        <Route element={<PortalProtegido><PortalLayout /></PortalProtegido>}>
          <Route index element={<PortalInicio />} />

          <Route path="pedidos" element={<PortalLista modo="pedidos" />} />
          <Route path="pedidos/novo" element={<PortalNovaSolicitacao />} />
          <Route path="pedidos/:id" element={<PortalOperacao />} />
          <Route path="transportes" element={<PortalLista modo="transportes" />} />
          <Route path="documentos" element={<PortalDocumentos />} />

          {/* Rotas anteriores — mantidas só como redirecionamento. */}
          <Route path="solicitacoes" element={<Navigate to="/portal/embarcador/pedidos" replace />} />
          <Route path="solicitacoes/nova" element={<Navigate to="/portal/embarcador/pedidos/novo" replace />} />
          <Route path="operacoes" element={<Navigate to="/portal/embarcador/transportes" replace />} />
          <Route path="operacoes/:id" element={<RedirecionarDetalheAntigo />} />
        </Route>

        <Route path="*" element={<Navigate to="/portal/embarcador" replace />} />
      </Routes>
    </PortalAuthProvider>
  );
}
