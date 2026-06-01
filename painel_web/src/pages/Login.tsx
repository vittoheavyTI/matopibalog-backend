import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLoginConfig } from '../hooks/useLoginConfig';
import api from '../api';
import { Truck } from 'lucide-react';

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
      justifyContent: 'center',
      background: config.loginBg ? `url(${config.loginBg}) center/cover no-repeat` : '#1a1a2e',
      overflow: 'hidden',
      padding: '16px',
      boxSizing: 'border-box'
    }}>
      {!ready ? (
        <div style={{ width: '100%', maxWidth: '380px', minHeight: '400px' }} />
      ) : (
      <div className="login-card" style={{
        transform: `translateX(${config.cardX}px) translateY(${config.cardY}px)`,
        backgroundColor: `rgba(${parseInt(config.cardColor.replace('#','').substring(0,2),16)}, ${parseInt(config.cardColor.replace('#','').substring(2,4),16)}, ${parseInt(config.cardColor.replace('#','').substring(4,6),16)}, ${config.cardOpacity / 100})`,
        width: `${config.cardWidth}px`,
        maxWidth: '100%',
        borderRadius: '1rem',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
        padding: '1.5rem',
        boxSizing: 'border-box'
      }}>
        <div className="flex flex-col items-center mb-6">
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

        <form onSubmit={handleLogin} className="flex flex-col gap-4" style={{ fontFamily: config.cardFontFamily }}>
          <div>
            <label style={{ display: 'block', fontSize: `${config.cardFontSize}px`, fontWeight: '600', lineHeight: '1.5', color: config.cardFontColor, marginBottom: '6px' }}>E-mail</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              style={{
                width: '100%',
                height: '48px',
                padding: '12px 16px',
                fontSize: `${config.cardFontSize}px`,
                fontWeight: '400',
                lineHeight: '1.5',
                borderRadius: '10px',
                border: `2px solid ${config.inputBorderColor}`,
                backgroundColor: config.inputBgColor,
                outline: 'none',
                boxSizing: 'border-box',
                color: config.cardFontColor,
                pointerEvents: 'all',
                position: 'relative',
                zIndex: 10,
              }}
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: `${config.cardFontSize}px`, fontWeight: '500', lineHeight: '1.5', color: config.cardFontColor, marginBottom: '8px' }}>Senha</label>
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{
                  width: '100%',
                  height: '48px',
                  padding: '12px 16px',
                  fontSize: `${config.cardFontSize}px`,
                  fontWeight: '400',
                  lineHeight: '1.5',
                  borderRadius: '10px',
                  border: `2px solid ${config.inputBorderColor}`,
                  backgroundColor: config.inputBgColor,
                  outline: 'none',
                  boxSizing: 'border-box',
                  color: config.cardFontColor
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
              fontSize: `${config.cardFontSize}px`,
              fontWeight: '600',
              lineHeight: '1.5',
              background: '#3b82f6',
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
            <a href="#" style={{ color: '#3b82f6', fontSize: `${config.cardFontSize}px`, textDecoration: 'none' }} onClick={(e) => { e.preventDefault(); }}>Criar conta</a>
            <a href="#" style={{ color: '#3b82f6', fontSize: `${config.cardFontSize}px`, textDecoration: 'none' }} onClick={(e) => { e.preventDefault(); }}>Esqueceu a senha?</a>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginTop: '16px' }}>
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: `${config.cardFontSize}px` }}>Matopiba Log — Painel Administrativo</span>
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
        background: config.footerColor + Math.round(config.footerOpacity * 2.55).toString(16).padStart(2, '0'),
        borderRadius: '8px',
        padding: '8px 16px',
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
