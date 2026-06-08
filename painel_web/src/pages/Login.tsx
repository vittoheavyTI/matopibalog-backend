import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLoginConfig } from '../hooks/useLoginConfig';
import api from '../api';
import { Truck, Eye, EyeOff } from 'lucide-react';

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

// Calcula se o texto deve ser branco ou escuro com base na cor de fundo
function getContrastTextColor(hexColor: string): string {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#1f2937' : '#ffffff';
}

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Modal esqueceu a senha
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotMessage, setForgotMessage] = useState('');
  const [forgotError, setForgotError] = useState('');

  const navigate = useNavigate();
  const { user, login } = useAuth();
  const { configLoading, ...config } = useLoginConfig();

  const tmpl = LOGIN_TEMPLATES.find(t => t.id === config.loginTemplate) || LOGIN_TEMPLATES[0];
  const footerTextColor = getContrastTextColor(config.footerColor);
  const footerBgWithOpacity = config.footerColor + Math.round(config.footerOpacity * 2.55).toString(16).padStart(2, '0');
  const paddingHorizontal = Math.round(8 + (config.footerWidth - 20) * 52 / 80);

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
      const { user: rawUser, token } = response.data;
      // Save token for future requests (Bearer)
      try { localStorage.setItem('auth_token', token); } catch (e) {}
      login({ ...rawUser, fotoUrl: rawUser.foto_url });
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Credenciais inválidas.');
    } finally {
      setLoadingLocal(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail.trim()) return;
    setForgotLoading(true);
    setForgotError('');
    setForgotMessage('');
    try {
      await api.post('/auth/esqueceu-senha', { email: forgotEmail });
      setForgotMessage('Se este e-mail estiver cadastrado, você receberá as instruções em breve.');
    } catch (err: any) {
      const detalhe = err.response?.data?.detalhe;
      const base = 'Erro ao enviar. Tente novamente.';
      setForgotError(detalhe ? `${base} (${detalhe})` : base);
    } finally {
      setForgotLoading(false);
    }
  };

  const cardMargin = tmpl.cardPosition === 'left'
    ? '0 auto 0 48px'
    : '0 auto';

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .login-card { animation: fadeIn 0.2s ease-out; }
        .modal-overlay { animation: fadeIn 0.15s ease-out; }
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
        boxSizing: 'border-box',
      }}>
        {configLoading ? (
          <div style={{ width: '100%', maxWidth: '380px', minHeight: '400px' }} />
        ) : (
          <div className="login-card" style={{
            backgroundColor: tmpl.cardBackground,
            width: '100%',
            maxWidth: `${tmpl.cardWidth}px`,
            borderRadius: tmpl.cardBorderRadius,
            boxShadow: tmpl.cardShadow,
            border: tmpl.cardBorder,
            padding: '2rem',
            boxSizing: 'border-box',
            margin: cardMargin,
          }}>
            {/* Logo */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '24px' }}>
              {config.loginLogo ? (
                <img
                  src={config.loginLogo}
                  alt="Logo"
                  style={{
                    transform: `scale(${config.loginLogoScale / 100}) translateY(${config.loginLogoY}px)`,
                    transformOrigin: 'center',
                    maxWidth: '100%',
                    maxHeight: '80px',
                    objectFit: 'contain',
                  }}
                />
              ) : (
                <div style={{ background: tmpl.buttonColor, padding: '12px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Truck size={32} color="#ffffff" />
                </div>
              )}
            </div>

            {/* Erro */}
            {error && (
              <div style={{ background: '#fef2f2', color: '#dc2626', padding: '12px', borderRadius: '8px', fontSize: '14px', textAlign: 'center', marginBottom: '16px' }}>
                {error}
              </div>
            )}

            {/* Formulário */}
            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: `${tmpl.fontSize}px`, fontWeight: '600', color: tmpl.fontColor, marginBottom: '6px' }}>
                  E-mail
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                  style={{
                    width: '100%',
                    height: '48px',
                    padding: '12px 16px',
                    fontSize: `${tmpl.fontSize}px`,
                    borderRadius: '10px',
                    border: `2px solid ${config.inputBorderColor}`,
                    backgroundColor: config.inputBgColor,
                    outline: 'none',
                    boxSizing: 'border-box',
                    color: tmpl.fontColor,
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: `${tmpl.fontSize}px`, fontWeight: '600', color: tmpl.fontColor, marginBottom: '6px' }}>
                  Senha
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    style={{
                      width: '100%',
                      height: '48px',
                      padding: '12px 48px 12px 16px',
                      fontSize: `${tmpl.fontSize}px`,
                      borderRadius: '10px',
                      border: `2px solid ${config.inputBorderColor}`,
                      backgroundColor: config.inputBgColor,
                      outline: 'none',
                      boxSizing: 'border-box',
                      color: tmpl.fontColor,
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '4px', display: 'flex', alignItems: 'center' }}
                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loadingLocal}
                style={{
                  width: '100%',
                  height: '48px',
                  fontSize: `${tmpl.fontSize}px`,
                  fontWeight: '600',
                  background: loadingLocal ? '#9ca3af' : tmpl.buttonColor,
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  cursor: loadingLocal ? 'not-allowed' : 'pointer',
                  transition: 'background 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
              >
                {loadingLocal && (
                  <span style={{ width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                )}
                {loadingLocal ? 'Entrando...' : 'Entrar'}
              </button>

              <div style={{ display: 'flex', justifyContent: 'center', gap: '24px', marginTop: '4px' }}>
                <button
                  type="button"
                  onClick={() => navigate('/cadastro')}
                  style={{ background: 'none', border: 'none', color: tmpl.buttonColor, fontSize: `${tmpl.fontSize}px`, cursor: 'pointer', padding: 0, textDecoration: 'underline', textUnderlineOffset: '3px' }}
                >
                  Criar conta
                </button>
                <button
                  type="button"
                  onClick={() => { setShowForgotModal(true); setForgotEmail(email); setForgotMessage(''); setForgotError(''); }}
                  style={{ background: 'none', border: 'none', color: tmpl.buttonColor, fontSize: `${tmpl.fontSize}px`, cursor: 'pointer', padding: 0, textDecoration: 'underline', textUnderlineOffset: '3px' }}
                >
                  Esqueceu a senha?
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Rodapé */}
        {(config.contactPhone || config.contactEmail || config.footerText) && (
          <div style={{
            position: 'fixed',
            bottom: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'fit-content',
            maxWidth: '90vw',
            background: footerBgWithOpacity,
            borderRadius: '8px',
            padding: `8px ${paddingHorizontal}px`,
            textAlign: 'center',
            zIndex: 50,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              flexWrap: 'wrap',
              fontSize: `${config.footerFontSize}px`,
              fontWeight: config.footerBold ? 'bold' : 'normal',
              fontFamily: config.footerFontFamily,
              color: footerTextColor,
            }}>
              {config.contactPhone && <span style={{ whiteSpace: 'nowrap' }}>{config.contactPhone}</span>}
              {config.contactEmail && <span style={{ whiteSpace: 'nowrap' }}>{config.contactEmail}</span>}
              {config.footerText && <span style={{ whiteSpace: 'nowrap' }}>{config.footerText}</span>}
            </div>
          </div>
        )}
      </div>

      {/* Modal — Esqueceu a senha */}
      {showForgotModal && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowForgotModal(false); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
        >
          <div style={{ background: '#ffffff', borderRadius: '16px', width: '100%', maxWidth: '400px', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #f3f4f6' }}>
              <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#111827', margin: 0 }}>Recuperar senha</h2>
              <p style={{ fontSize: '13px', color: '#6b7280', margin: '4px 0 0' }}>Digite seu e-mail para receber as instruções.</p>
            </div>

            <form onSubmit={handleForgotPassword} style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {forgotMessage && (
                <div style={{ background: '#f0fdf4', color: '#16a34a', padding: '10px 14px', borderRadius: '8px', fontSize: '13px' }}>
                  {forgotMessage}
                </div>
              )}
              {forgotError && (
                <div style={{ background: '#fef2f2', color: '#dc2626', padding: '10px 14px', borderRadius: '8px', fontSize: '13px' }}>
                  {forgotError}
                </div>
              )}
              {!forgotMessage && (
                <>
                  <input
                    type="email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="seu@email.com"
                    required
                    style={{ width: '100%', height: '44px', padding: '10px 14px', fontSize: '14px', borderRadius: '10px', border: '2px solid #e5e7eb', outline: 'none', boxSizing: 'border-box' }}
                  />
                  <button
                    type="submit"
                    disabled={forgotLoading}
                    style={{ width: '100%', height: '44px', background: forgotLoading ? '#9ca3af' : '#3b82f6', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: '600', fontSize: '14px', cursor: forgotLoading ? 'not-allowed' : 'pointer' }}
                  >
                    {forgotLoading ? 'Enviando...' : 'Enviar instruções'}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setShowForgotModal(false)}
                style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: '13px', cursor: 'pointer', padding: '4px 0', textAlign: 'center' }}
              >
                {forgotMessage ? 'Fechar' : 'Cancelar'}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
