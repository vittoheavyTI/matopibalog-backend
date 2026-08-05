import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { SuperAdminRoute } from './components/SuperAdminRoute';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Motoristas } from './pages/Motoristas';
import { Relatorios } from './pages/Relatorios';
import Rentabilidade from './pages/Rentabilidade';
import { AcertoMotoristas } from './pages/AcertoMotoristas';
import { TorreControle } from './pages/TorreControle';
import { GerenciamentoViagens } from './pages/GerenciamentoViagens';
import { ResumoMotorista } from './pages/ResumoMotorista';
import { Usuarios } from './pages/Usuarios';
import { Configuracoes } from './pages/Configuracoes';
import { Integracoes } from './pages/Integracoes';
import { PainelVisaoGeral } from './pages/PainelVisaoGeral';
import { PainelEmpresas } from './pages/PainelEmpresas';
import { PainelPlanos } from './pages/PainelPlanos';
import { PainelFuncionalidades } from './pages/PainelFuncionalidades';
import { PainelPromocoes } from './pages/PainelPromocoes';
import { PainelMotoristas } from './pages/PainelMotoristas';
import { PainelRelatorios } from './pages/PainelRelatorios';
import { PainelFinanceiro } from './pages/PainelFinanceiro';
import { PainelNotificacoes } from './pages/PainelNotificacoes';
import { PainelTermosLGPD } from './pages/PainelTermosLGPD';
import { PlanosPublicos } from './pages/PlanosPublicos';
import { CadastroPublico } from './pages/CadastroPublico';
import { EmailConfirmado } from './pages/EmailConfirmado';
import { MinhasFaturas } from './pages/MinhasFaturas';
import { Contratacao } from './pages/Contratacao';
import { RedefinirSenha } from './pages/RedefinirSenha';
import { TrocarSenhaObrigatoria } from './pages/TrocarSenhaObrigatoria';
import { TermosPendentes } from './pages/TermosPendentes';

const AppRoutes = () => {
  const { loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('type=recovery') && hash.includes('access_token=')) {
      navigate(`/reset-password${hash}`, { replace: true });
    }
  }, [navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<RedefinirSenha />} />
      {/* Troca obrigatória para usuário logado com senha_temporaria=true.
          Fica FORA do ProtectedRoute (alvo do redirecionamento); a guarda de
          sessão é feita dentro do próprio componente. */}
      <Route path="/trocar-senha" element={<TrocarSenhaObrigatoria />} />
      {/* Termos LGPD pendentes: fica FORA do ProtectedRoute para evitar loop.
          A guarda de sessão + redirecionamento é feita no ProtectedRoute e
          no próprio componente. */}
      <Route path="/termos-pendentes" element={<TermosPendentes />} />
      <Route path="/planos" element={<PlanosPublicos />} />
      <Route path="/cadastro" element={<CadastroPublico />} />
      <Route path="/confirmado" element={<EmailConfirmado />} />
      
      <Route path="/" element={
        <ProtectedRoute>
          <Layout />
        </ProtectedRoute>
      }>
        <Route index element={<Dashboard />} />
        <Route path="motoristas" element={<Motoristas />} />
        <Route path="relatorios" element={<Relatorios />} />
        <Route path="relatorios/viagens" element={<GerenciamentoViagens />} />
        <Route path="relatorios/resumo" element={<ResumoMotorista />} />
        <Route path="relatorios/rentabilidade" element={<Rentabilidade />} />
        <Route path="relatorios/acerto-motoristas" element={<AcertoMotoristas />} />
        <Route path="relatorios/torre-controle" element={<TorreControle />} />
        <Route path="admins" element={<Usuarios />} />
        <Route path="painel-administrativo">
          <Route index element={<Navigate to="visao-geral" replace />} />
          <Route path="visao-geral" element={<SuperAdminRoute><PainelVisaoGeral /></SuperAdminRoute>} />
          <Route path="empresas" element={<SuperAdminRoute><PainelEmpresas /></SuperAdminRoute>} />
          <Route path="planos" element={<SuperAdminRoute><ErrorBoundary><PainelPlanos /></ErrorBoundary></SuperAdminRoute>} />
          <Route path="funcionalidades" element={<SuperAdminRoute><ErrorBoundary><PainelFuncionalidades /></ErrorBoundary></SuperAdminRoute>} />
          <Route path="promocoes" element={<SuperAdminRoute><ErrorBoundary><PainelPromocoes /></ErrorBoundary></SuperAdminRoute>} />
          <Route path="assinaturas" element={<Navigate to="../financeiro?aba=assinaturas" replace />} />
          <Route path="usuarios" element={<SuperAdminRoute><Usuarios /></SuperAdminRoute>} />
          <Route path="motoristas" element={<SuperAdminRoute><PainelMotoristas /></SuperAdminRoute>} />
          <Route path="relatorios" element={<SuperAdminRoute><PainelRelatorios /></SuperAdminRoute>} />
          <Route path="financeiro" element={<SuperAdminRoute><PainelFinanceiro /></SuperAdminRoute>} />
          {/* Config. Sistema virou a aba "Sistema" dentro de Configurações. Rota antiga
              redireciona para não quebrar links salvos. */}
          <Route path="configuracoes" element={<Navigate to="/configuracoes" replace />} />
          <Route path="notificacoes" element={<SuperAdminRoute><PainelNotificacoes /></SuperAdminRoute>} />
          <Route path="termos-lgpd" element={<SuperAdminRoute><PainelTermosLGPD /></SuperAdminRoute>} />
          <Route path="faturas" element={<Navigate to="../financeiro?aba=faturas" replace />} />
        </Route>
        <Route path="integracoes" element={<SuperAdminRoute><Integracoes /></SuperAdminRoute>} />
        <Route path="contratacao" element={<Contratacao />} />
        <Route path="minhas-faturas" element={<MinhasFaturas />} />
        <Route path="configuracoes" element={<Configuracoes />} />
      </Route>

      <Route path="/viagens" element={<Navigate to="/relatorios/viagens" replace />} />
      <Route path="/resumo" element={<Navigate to="/relatorios/resumo" replace />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppRoutes />
      </Router>
    </AuthProvider>
  );
}

export default App;
