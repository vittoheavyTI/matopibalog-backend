import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) return null;

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-red-600 mb-2">Acesso Negado</h2>
          <p className="text-gray-600">Apenas administradores podem acessar o painel web.</p>
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
