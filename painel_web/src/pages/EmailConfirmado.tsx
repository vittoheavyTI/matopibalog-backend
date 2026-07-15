import React from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle } from 'lucide-react';

// Página de destino do link de confirmação de e-mail (Supabase Redirect URL →
// /confirmado). Não faz chamada: o Supabase já confirmou o e-mail antes de
// redirecionar. Aqui só damos o feedback e o CTA para o login.
export const EmailConfirmado: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8 text-center">
        <div className="flex justify-center mb-4">
          <CheckCircle className="text-green-600" size={56} />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">E-mail confirmado!</h1>
        <p className="text-gray-500 mb-6">
          Seu e-mail foi confirmado com sucesso. Agora é só entrar para começar a
          usar o Matopiba Log.
        </p>
        <Link
          to="/login"
          className="inline-block w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors"
        >
          Ir para o login
        </Link>
      </div>
    </div>
  );
};
