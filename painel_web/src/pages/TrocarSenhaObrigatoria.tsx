import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../api';
import { Truck, Eye, EyeOff } from 'lucide-react';

// Tela de troca OBRIGATÓRIA de senha para usuário já logado com senha_temporaria=true.
// Diferente de RedefinirSenha.tsx (que é o fluxo de recuperação por e-mail via Supabase),
// esta usa o backend autenticado (POST /auth/trocar-senha), que zera senha_temporaria.
export const TrocarSenhaObrigatoria: React.FC = () => {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (loading) return null;
  // Não logado → login. Sem senha temporária → não há o que trocar aqui (evita ficar preso).
  if (!user) return <Navigate to="/login" replace />;
  if (!user.senha_temporaria) return <Navigate to="/" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setError('A nova senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.post('/auth/trocar-senha', { nova_senha: password });
      // Atualiza o contexto: senha_temporaria=false libera o acesso ao painel.
      login({ ...user, senha_temporaria: false });
      navigate('/', { replace: true });
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erro ao trocar a senha. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a2e', padding: '16px' }}>
      <div style={{ background: '#fff', borderRadius: '1rem', padding: '2rem', maxWidth: '400px', width: '100%', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '24px' }}>
          <div style={{ background: '#3b82f6', padding: '12px', borderRadius: '50%' }}>
            <Truck size={32} color="#ffffff" />
          </div>
        </div>

        <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#111827', textAlign: 'center', margin: '0 0 8px' }}>Defina sua senha</h1>
        <p style={{ fontSize: '14px', color: '#6b7280', textAlign: 'center', margin: '0 0 24px' }}>
          Por segurança, você precisa trocar a senha temporária antes de acessar o sistema.
        </p>

        {error && (
          <div style={{ background: '#fef2f2', color: '#dc2626', padding: '12px', borderRadius: '8px', fontSize: '14px', marginBottom: '16px' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
              Nova senha
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={6}
                style={{ width: '100%', height: '48px', padding: '12px 48px 12px 16px', fontSize: '14px', borderRadius: '10px', border: '2px solid #e5e7eb', outline: 'none', boxSizing: 'border-box' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', alignItems: 'center', padding: '4px' }}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
              Confirmar nova senha
            </label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={6}
              style={{ width: '100%', height: '48px', padding: '12px 16px', fontSize: '14px', borderRadius: '10px', border: '2px solid #e5e7eb', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            style={{ width: '100%', height: '48px', background: submitting ? '#9ca3af' : '#3b82f6', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: '600', fontSize: '14px', cursor: submitting ? 'not-allowed' : 'pointer' }}
          >
            {submitting ? 'Salvando...' : 'Salvar e acessar'}
          </button>
        </form>
      </div>
    </div>
  );
};
