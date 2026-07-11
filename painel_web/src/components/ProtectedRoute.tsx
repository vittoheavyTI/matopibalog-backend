import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading, logout } = useAuth();

  if (loading) return null;

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== 'admin') {
    // Não-admin (ex.: motorista) fica bloqueado no painel web, mas precisa de uma
    // saída explícita: sem isto a sessão permanece ativa e o usuário fica preso
    // (o Login redireciona quem está autenticado de volta para "/"). O botão usa
    // o logout oficial (logout('manual') → setUser(null)), que sempre encerra a
    // sessão e leva a /login pelo fluxo já existente, mesmo se o POST falhar.
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-sm px-4">
          <h2 className="text-2xl font-bold text-red-600 mb-2">Acesso Negado</h2>
          <p className="text-gray-600 mb-1">Apenas administradores podem acessar o painel web.</p>
          <p className="text-gray-500 text-sm mb-6">Motoristas devem utilizar o aplicativo Matopiba Log.</p>
          <button
            type="button"
            onClick={() => logout('manual')}
            className="inline-flex items-center justify-center rounded-lg bg-green-700 px-5 py-2.5 font-semibold text-white transition hover:bg-green-800 focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-offset-2 cursor-pointer"
          >
            Sair e voltar ao login
          </button>
        </div>
      </div>
    );
  }

  // Senha temporária: bloqueia qualquer rota interna até a troca obrigatória.
  // Vale para super-admin, admin comum e auxiliar — todos passam por aqui antes
  // de renderizar o Layout (e o SuperAdminRoute aninhado). A rota /trocar-senha
  // fica FORA do ProtectedRoute, então não entra em loop de redirecionamento.
  if (user.senha_temporaria) {
    return <Navigate to="/trocar-senha" replace />;
  }

  // Termos LGPD pendentes: bloqueia o painel até o usuário aceitar os termos.
  // Fica DEPOIS de senha_temporaria, então se o usuário tem ambos, primeiro troca
  // a senha, depois (se ainda houver pendências) é redirecionado para /termos-pendentes.
  // A rota /termos-pendentes fica FORA do ProtectedRoute, evitando loop.
  if (user.termos_pendentes) {
    return <Navigate to="/termos-pendentes" replace />;
  }

  return <>{children}</>;
};
