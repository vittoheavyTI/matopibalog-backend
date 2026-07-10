import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { mensagemErro } from '../utils/mensagemErro';
import { Truck, Eye, EyeOff } from 'lucide-react';

export const RedefinirSenha: React.FC = () => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sessionReady, setSessionReady] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Detecta tokens diretamente no hash da URL (fluxo Supabase recovery)
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.replace('#', ''));
    const type = params.get('type');
    const accessToken = params.get('access_token');

    if (type === 'recovery' && accessToken) {
      supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: params.get('refresh_token') || '',
      }).then(({ error }) => {
        if (error) {
          setError('Link expirado ou inválido. Solicite um novo e-mail de recuperação.');
          setSessionReady(true);
        } else {
          setSessionReady(true);
        }
      });
      return;
    }

    // Fallback: aguarda evento do Supabase (caso já tenha sessão ativa)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setSessionReady(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        setSessionReady(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setMessage('Senha redefinida com sucesso! Redirecionando para o login...');
      setTimeout(() => navigate('/login'), 3000);
    } catch (err: any) {
      setError(mensagemErro(err, 'Não foi possível redefinir a senha. O link pode ter expirado — solicite um novo e-mail de recuperação.'));
    } finally {
      setLoading(false);
    }
  };

  if (!sessionReady) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a2e', padding: '16px' }}>
        <div style={{ background: '#fff', borderRadius: '1rem', padding: '2rem', maxWidth: '400px', width: '100%', textAlign: 'center', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
            <div style={{ background: '#3b82f6', padding: '12px', borderRadius: '50%' }}>
              <Truck size={32} color="#ffffff" />
            </div>
          </div>
          <p style={{ color: '#6b7280', fontSize: '14px', margin: '0 0 8px' }}>Verificando link de recuperação...</p>
          <p style={{ color: '#9ca3af', fontSize: '12px', margin: 0 }}>
            Link expirado?{' '}
            <button
              onClick={() => navigate('/login')}
              style={{ color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontSize: '12px', padding: 0 }}
            >
              Voltar ao login
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a2e', padding: '16px' }}>
      <div style={{ background: '#fff', borderRadius: '1rem', padding: '2rem', maxWidth: '400px', width: '100%', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '24px' }}>
          <div style={{ background: '#3b82f6', padding: '12px', borderRadius: '50%' }}>
            <Truck size={32} color="#ffffff" />
          </div>
        </div>

        <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#111827', textAlign: 'center', margin: '0 0 8px' }}>Nova senha</h1>
        <p style={{ fontSize: '14px', color: '#6b7280', textAlign: 'center', margin: '0 0 24px' }}>Digite e confirme sua nova senha.</p>

        {message && (
          <div style={{ background: '#f0fdf4', color: '#16a34a', padding: '12px', borderRadius: '8px', fontSize: '14px', marginBottom: '16px' }}>
            {message}
          </div>
        )}
        {error && (
          <div style={{ background: '#fef2f2', color: '#dc2626', padding: '12px', borderRadius: '8px', fontSize: '14px', marginBottom: '16px' }}>
            {error}
          </div>
        )}

        {error && (
          <button
            type="button"
            onClick={() => navigate('/login')}
            style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: '14px', cursor: 'pointer', padding: '4px 0', textAlign: 'center', textDecoration: 'underline' }}
          >
            Voltar ao login
          </button>
        )}

        {!message && !error && (
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
                required
                minLength={6}
                style={{ width: '100%', height: '48px', padding: '12px 16px', fontSize: '14px', borderRadius: '10px', border: '2px solid #e5e7eb', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{ width: '100%', height: '48px', background: loading ? '#9ca3af' : '#3b82f6', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: '600', fontSize: '14px', cursor: loading ? 'not-allowed' : 'pointer' }}
            >
              {loading ? 'Salvando...' : 'Salvar nova senha'}
            </button>

            <button
              type="button"
              onClick={() => navigate('/login')}
              style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: '13px', cursor: 'pointer', padding: '4px 0', textAlign: 'center' }}
            >
              Voltar ao login
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
