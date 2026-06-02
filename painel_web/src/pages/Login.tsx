import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLoginConfig } from '../hooks/useLoginConfig';
import api from '../api';
import { Truck } from 'lucide-react';

const LOGIN_TEMPLATES = [
  {
    id: 'classico',
    nome: 'Clássico',
    descricao: 'Card centralizado com sombra',
    cardWidth: 380,
    cardPosition: 'center',
    fontSize: 14,
    fontColor: '#333333',
    cardBackground: '#ffffff',
    cardShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
    cardBorder: 'none',
    cardBorderRadius: '1rem',
    buttonColor: '#3b82f6',
  },
  {
    id: 'moderno',
    nome: 'Moderno',
    descricao: 'Card à esquerda com gradiente',
    cardWidth: 420,
    cardPosition: 'left',
    fontSize: 15,
    fontColor: '#1f2937',
    cardBackground: 'rgba(255,255,255,0.95)',
    cardShadow: '0 10px 40px rgba(0,0,0,0.15)',
    cardBorder: 'none',
    cardBorderRadius: '1.5rem',
    buttonColor: '#6366f1',
  },
  {
    id: 'minimalista',
    nome: 'Minimalista',
    descricao: 'Limpo, sem sombra, fundo suave',
    cardWidth: 360,
    cardPosition: 'center',
    fontSize: 14,
    fontColor: '#4b5563',
    cardBackground: '#f9fafb',
    cardShadow: 'none',
    cardBorder: '1px solid #e5e7eb',
    cardBorderRadius: '0.75rem',
    buttonColor: '#10b981',
  },
  {
    id: 'bold',
    nome: 'Bold',
    descricao: 'Card com borda grossa e destaque',
    cardWidth: 400,
    cardPosition: 'center',
    fontSize: 16,
    fontColor: '#111827',
    cardBackground: '#ffffff',
    cardShadow: '0 0 0 4px #3b82f6',
    cardBorder: '2px solid #3b82f6',
    cardBorderRadius: '1rem',
    buttonColor: '#ef4444',
  },
];

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const { user, login } = useAuth();
  const config = useLoginConfig();
  const [ready, setReady] = useState(false);

  const tmpl = LOGIN_TEMPLATES.find(t => t.id === config.loginTemplate) || LOGIN_TEMPLATES[0];

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 10);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (user && user.role === 'admin') {
      navigate('/');
    }
  }, [user, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoadingLocal(true);
    setError('');
    try {
      const response = await api.post('/auth/login', { email, senha: password });
      const { token, user: userData } = response.data;
      login(token, userData);
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Credenciais inválidas.');
    } finally {
      setLoadingLocal(false);
    }
  };

  return (
    <>
    <style>{`
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `}</style>
    <div style={{
      minHeight: '100vh',
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: tmpl.cardPosition === 'left' ? 'flex-start' : 'center',
      background: config.loginBg ? `url(${config.loginBg}) center/cover no-repeat` : '#1a1a2e',
      overflow: 'hidden',
      padding: '16px',
      boxSizing: 'border-box'
      }}>
        {!ready ? (
          <div style={{ width: '100%', maxWidth: '380px', minHeight: '400px' }} />
        ) : (
        <div className="login-card" style={{
          backgroundColor: tmpl.cardBackground,
          width: '100%',
          maxWidth: `${tmpl.cardWidth}px`,
          borderRadius: tmpl.cardBorderRadius,
          boxShadow: tmpl.cardShadow,
          border: tmpl.cardBorder,
          padding: '1.5rem',
          boxSizing: 'border-box',
          margin: tmpl.cardPosition === 'left' ? '0 auto 0 0' : '0 auto',
        }}>
          <div className="flex flex-col items-center" style={{ marginBottom: '24px' }}>
            {config.loginLogo ? (
              <img src={config.loginLogo} alt="Logo" className="object-contain" style={{
                transform: `scale(${config.loginLogoScale / 100}) translateY(${config.loginLogoY}px)`,
                transformOrigin: 'center',
                maxWidth: '100%'
              }} />
            ) : (
              <div className="bg-blue-600 p-3 rounded-full flex items-center justify-center">
                <Truck size={32} className="text-white" />
              </div>
            )}
          </div>

          {error && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm text-center mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div>
            <label style={{ display: 'block', fontSize: `${tmpl.fontSize}px`, fontWeight: '600', lineHeight: '1.5', color: tmpl.fontColor, marginBottom: '6px' }}>E-mail</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              style={{
                width: '100%',
                height: '48px',
                padding: '12px 16px',
                fontSize: `${tmpl.fontSize}px`,
                fontWeight: '400',
                lineHeight: '1.5',
                borderRadius: '10px',
                border: `2px solid ${config.inputBorderColor}`,
                backgroundColor: config.inputBgColor,
                outline: 'none',
                boxSizing: 'border-box',
                color: tmpl.fontColor,
                pointerEvents: 'all',
                position: 'relative',
                zIndex: 10,
              }}
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: `${tmpl.fontSize}px`, fontWeight: '500', lineHeight: '1.5', color: tmpl.fontColor, marginBottom: '8px' }}>Senha</label>
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{
                  width: '100%',
                  height: '48px',
                  padding: '12px 16px',
                  fontSize: `${tmpl.fontSize}px`,
                  fontWeight: '400',
                  lineHeight: '1.5',
                  borderRadius: '10px',
                  border: `2px solid ${config.inputBorderColor}`,
                  backgroundColor: config.inputBgColor,
                  outline: 'none',
                  boxSizing: 'border-box',
                  color: tmpl.fontColor
                }}
                required
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: '18px', padding: '4px' }}>
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loadingLocal}
            style={{
              width: '100%',
              height: '48px',
              padding: '12px 16px',
              fontSize: `${tmpl.fontSize}px`,
              fontWeight: '600',
              lineHeight: '1.5',
              background: tmpl.buttonColor,
              color: 'white',
              border: 'none',
              borderRadius: '10px',
              cursor: loadingLocal ? 'not-allowed' : 'pointer',
              opacity: loadingLocal ? 0.5 : 1
            }}
          >
            {loadingLocal ? 'Entrando...' : 'Entrar'}
          </button>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginTop: '8px' }}>
            <a href="#" style={{ color: '#3b82f6', fontSize: `${tmpl.fontSize}px`, textDecoration: 'none' }} onClick={(e) => { e.preventDefault(); }}>Criar conta</a>
            <a href="#" style={{ color: '#3b82f6', fontSize: `${tmpl.fontSize}px`, textDecoration: 'none' }} onClick={(e) => { e.preventDefault(); }}>Esqueceu a senha?</a>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginTop: '16px' }}>
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: `${tmpl.fontSize}px` }}>Matopiba Log — Painel Administrativo</span>
          </div>
        </form>
        </div>
      )}

      <div className="login-footer" style={{
        position: 'fixed',
        bottom: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: `${config.footerWidth}%`,
        maxWidth: '600px',
        height: 'auto',
        minHeight: '30px',
        textAlign: 'center',
        zIndex: 50
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          flexWrap: 'nowrap',
          fontSize: `${config.footerFontSize}px`,
          fontWeight: config.footerBold ? 'bold' : 'normal',
          fontFamily: config.footerFontFamily,
          color: '#ffffff',
          textShadow: '0 1px 3px rgba(0,0,0,0.3)',
          height: '100%'
        }}>
          {config.contactPhone && <span style={{ whiteSpace: 'nowrap' }}>{config.contactPhone}</span>}
          {config.contactEmail && <span style={{ whiteSpace: 'nowrap' }}>{config.contactEmail}</span>}
          {config.footerText && <span style={{ whiteSpace: 'nowrap' }}>{config.footerText}</span>}
        </div>
      </div>
    </div>
  </>);
};
