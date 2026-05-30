import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../api';
import { Truck } from 'lucide-react';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [loginLogo, setLoginLogo] = useState<string | null>(null);
  const [loginLogoScale, setLoginLogoScale] = useState(100);
  const [loginLogoY, setLoginLogoY] = useState(0);
  const [loginBg, setLoginBg] = useState<string | null>(null);
  const [cardScale, setCardScale] = useState(100);
  const [cardX, setCardX] = useState(0);
  const [cardY, setCardY] = useState(0);
  const [cardColor, setCardColor] = useState('#ffffff');
  const [cardOpacity, setCardOpacity] = useState(100);
  const [footerText, setFooterText] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [footerColor, setFooterColor] = useState('#ffffff');
  const [footerOpacity, setFooterOpacity] = useState(70);
  const [footerFontSize, setFooterFontSize] = useState(14);
  const [footerBold, setFooterBold] = useState(false);
  const [footerFontFamily, setFooterFontFamily] = useState('Arial');
  const [footerWidth, setFooterWidth] = useState(80);
  const [footerHeight, setFooterHeight] = useState(60);
  const [isResizingFooter, setIsResizingFooter] = useState(false);
  const footerResizeRef = useRef({ startX: 0, startY: 0, startWidth: 80, startHeight: 60, edge: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [inputBgColor, setInputBgColor] = useState('#ffffff');
  const [inputBorderColor, setInputBorderColor] = useState('#e5e7eb');
  const [configLoaded, setConfigLoaded] = useState(false);
  const navigate = useNavigate();
  const { user, login } = useAuth();

  useEffect(() => {
    if (user && user.role === 'admin') {
      navigate('/');
    }
  }, [user, navigate]);

  useEffect(() => {
    const loadLocal = (key: string) => localStorage.getItem(key);
    const loadNum = (key: string, def: number) => { const v = loadLocal(key); return v ? Number(v) : def; };

    setLoginLogo(loadLocal('choferlog_login_logo'));
    setLoginLogoScale(loadNum('choferlog_login_logo_scale', 100));
    setLoginLogoY(loadNum('choferlog_login_logo_y', 0));
    setLoginBg(loadLocal('choferlog_login_bg'));
    setFooterText(loadLocal('choferlog_login_footer') || '');
    setCardScale(loadNum('choferlog_card_scale', 100));
    setCardX(loadNum('choferlog_card_x', 0));
    setCardY(loadNum('choferlog_card_y', 0));
    setCardColor(loadLocal('choferlog_card_color') || '#ffffff');
    setCardOpacity(loadNum('choferlog_card_opacity', 100));
    setContactPhone(loadLocal('choferlog_contact_phone') || '');
    setContactEmail(loadLocal('choferlog_contact_email') || '');
    setFooterColor(loadLocal('choferlog_footer_color') || '#ffffff');
    setFooterOpacity(loadNum('choferlog_footer_opacity', 70));
    setFooterFontSize(loadNum('choferlog_footer_font_size', 14));
    setFooterBold(loadLocal('choferlog_footer_bold') === 'true');
    setFooterFontFamily(loadLocal('choferlog_footer_font_family') || 'Arial');
    setFooterWidth(loadNum('choferlog_footer_width', 80));
    setFooterHeight(loadNum('choferlog_footer_height', 60));
    setInputBgColor(loadLocal('choferlog_input_bg') || '#ffffff');
    setInputBorderColor(loadLocal('choferlog_input_border') || '#e5e7eb');
    setConfigLoaded(true);

    api.get('/configuracoes/public').then((response) => {
      const d = response.data;
      if (!d || !d.loginLogo) return;
      if (d.loginLogo) setLoginLogo(d.loginLogo);
      if (d.loginLogoScale != null) setLoginLogoScale(Number(d.loginLogoScale));
      if (d.loginLogoY != null) setLoginLogoY(Number(d.loginLogoY));
      if (d.loginBg) setLoginBg(d.loginBg);
      if (d.footerText != null) setFooterText(d.footerText);
      if (d.contactPhone != null) setContactPhone(d.contactPhone);
      if (d.contactEmail != null) setContactEmail(d.contactEmail);
      if (d.cardScale != null) setCardScale(Number(d.cardScale));
      if (d.cardX != null) setCardX(Number(d.cardX));
      if (d.cardY != null) setCardY(Number(d.cardY));
      if (d.cardColor) setCardColor(d.cardColor);
      if (d.cardOpacity != null) setCardOpacity(Number(d.cardOpacity));
      if (d.footerColor) setFooterColor(d.footerColor);
      if (d.footerOpacity != null) setFooterOpacity(Number(d.footerOpacity));
      if (d.footerFontSize != null) setFooterFontSize(Number(d.footerFontSize));
      if (d.footerBold != null) setFooterBold(Boolean(d.footerBold));
      if (d.footerFontFamily) setFooterFontFamily(d.footerFontFamily);
      if (d.footerWidth != null) setFooterWidth(Number(d.footerWidth));
      if (d.footerHeight != null) setFooterHeight(Number(d.footerHeight));
      if (d.inputBgColor) setInputBgColor(d.inputBgColor);
      if (d.inputBorderColor) setInputBorderColor(d.inputBorderColor);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingFooter) return;
      const deltaX = e.clientX - footerResizeRef.current.startX;
      const deltaY = e.clientY - footerResizeRef.current.startY;

      let newWidth = footerResizeRef.current.startWidth;
      let newHeight = footerResizeRef.current.startHeight;

      if (footerResizeRef.current.edge === 'right' || footerResizeRef.current.edge === 'corner') {
        const previewWidth = window.innerWidth;
        newWidth = Math.min(95, Math.max(30, footerResizeRef.current.startWidth + (deltaX / previewWidth) * 100));
      }

      if (footerResizeRef.current.edge === 'bottom' || footerResizeRef.current.edge === 'corner') {
        newHeight = Math.min(150, Math.max(30, footerResizeRef.current.startHeight + deltaY));
      }

      setFooterWidth(Math.round(newWidth));
      setFooterHeight(Math.round(newHeight));
    };
    const handleMouseUp = () => {
      if (isResizingFooter) {
        localStorage.setItem('choferlog_footer_width', footerWidth.toString());
        localStorage.setItem('choferlog_footer_height', footerHeight.toString());
        setIsResizingFooter(false);
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingFooter, footerWidth, footerHeight]);

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
      background: loginBg ? `url(${loginBg}) center/cover no-repeat` : '#1a1a2e',
      overflow: 'hidden',
      padding: '16px',
      boxSizing: 'border-box'
    }}>
      {!configLoaded ? (
        <div style={{
          width: '100%',
          maxWidth: '380px',
          minHeight: '400px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <div style={{
            width: '32px',
            height: '32px',
            border: '3px solid rgba(255,255,255,0.2)',
            borderTopColor: '#ffffff',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite'
          }} />
        </div>
      ) : (
      <div className="login-card" style={{
        transform: `translateX(${cardX}px) translateY(${cardY}px) scale(${cardScale / 100})`,
        backgroundColor: `rgba(${parseInt(cardColor.replace('#','').substring(0,2),16)}, ${parseInt(cardColor.replace('#','').substring(2,4),16)}, ${parseInt(cardColor.replace('#','').substring(4,6),16)}, ${cardOpacity / 100})`,
        width: '100%',
        maxWidth: '380px',
        borderRadius: '1rem',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
        padding: '1.5rem',
        boxSizing: 'border-box'
      }}>
        <div className="flex flex-col items-center mb-6">
          {loginLogo ? (
            <img src={loginLogo} alt="Logo" className="object-contain" style={{
              transform: `scale(${loginLogoScale / 100}) translateY(${loginLogoY}px)`,
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
            <label style={{ display: 'block', fontSize: '16px', fontWeight: '500', fontFamily: 'Arial, sans-serif', lineHeight: '1.5', color: '#ffffff', marginBottom: '8px' }}>E-mail</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                width: '100%',
                height: '48px',
                padding: '12px 16px',
                fontSize: '16px',
                fontWeight: '400',
                fontFamily: 'Arial, sans-serif',
                lineHeight: '1.5',
                borderRadius: '10px',
                border: `2px solid ${inputBorderColor}`,
                backgroundColor: inputBgColor,
                outline: 'none',
                boxSizing: 'border-box',
                color: '#333'
              }}
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '16px', fontWeight: '500', fontFamily: 'Arial, sans-serif', lineHeight: '1.5', color: '#ffffff', marginBottom: '8px' }}>Senha</label>
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{
                  width: '100%',
                  height: '48px',
                  padding: '12px 16px',
                  fontSize: '16px',
                  fontWeight: '400',
                  fontFamily: 'Arial, sans-serif',
                  lineHeight: '1.5',
                  borderRadius: '10px',
                  border: `2px solid ${inputBorderColor}`,
                  backgroundColor: inputBgColor,
                  outline: 'none',
                  boxSizing: 'border-box',
                  color: '#333'
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
              fontSize: '16px',
              fontWeight: '600',
              fontFamily: 'Arial, sans-serif',
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
            <a href="#" style={{ color: '#3b82f6', fontSize: '14px', fontFamily: 'Arial, sans-serif', textDecoration: 'none' }} onClick={(e) => { e.preventDefault(); /* navigate to criar conta */ }}>Criar conta</a>
            <a href="#" style={{ color: '#3b82f6', fontSize: '14px', fontFamily: 'Arial, sans-serif', textDecoration: 'none' }} onClick={(e) => { e.preventDefault(); /* navigate to esqueceu senha */ }}>Esqueceu a senha?</a>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginTop: '16px' }}>
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '14px', fontFamily: 'Arial, sans-serif' }}>Matopiba Log — Painel Administrativo</span>
          </div>
        </form>
      </div>
      )}



      <div className="login-footer" style={{
        position: 'fixed',
        bottom: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: `${footerWidth}%`,
        maxWidth: '600px',
        maxHeight: `${footerHeight}px`,
        background: footerColor + Math.round(footerOpacity * 2.55).toString(16).padStart(2, '0'),
        borderRadius: '8px',
        padding: '8px 16px',
        textAlign: 'center',
        overflow: 'hidden',
        cursor: isResizingFooter ? 'grabbing' : 'default',
        transition: isResizingFooter ? 'none' : 'width 0.1s, maxHeight 0.1s',
        zIndex: 50
      }}>
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            flexWrap: 'nowrap',
            fontSize: `${footerFontSize}px`,
            fontWeight: footerBold ? 'bold' : 'normal',
            fontFamily: footerFontFamily,
            color: '#ffffff',
            textShadow: '0 1px 3px rgba(0,0,0,0.3)',
            height: '100%'
          }}>
            {contactPhone && <span style={{ whiteSpace: 'nowrap' }}>{contactPhone}</span>}
            {contactEmail && <span style={{ whiteSpace: 'nowrap' }}>{contactEmail}</span>}
            {footerText && <span style={{ whiteSpace: 'nowrap' }}>{footerText}</span>}
          </div>

          <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '8px', cursor: 'ew-resize', zIndex: 10 }}
            onMouseDown={(e) => { e.stopPropagation(); setIsResizingFooter(true); footerResizeRef.current = { startX: e.clientX, startY: e.clientY, startWidth: footerWidth, startHeight: footerHeight, edge: 'right' }; }}
          />
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '8px', cursor: 'ns-resize', zIndex: 10 }}
            onMouseDown={(e) => { e.stopPropagation(); setIsResizingFooter(true); footerResizeRef.current = { startX: e.clientX, startY: e.clientY, startWidth: footerWidth, startHeight: footerHeight, edge: 'bottom' }; }}
          />
          <div style={{ position: 'absolute', right: 0, bottom: 0, width: '12px', height: '12px', cursor: 'nwse-resize', zIndex: 10 }}
            onMouseDown={(e) => { e.stopPropagation(); setIsResizingFooter(true); footerResizeRef.current = { startX: e.clientX, startY: e.clientY, startWidth: footerWidth, startHeight: footerHeight, edge: 'corner' }; }}
          />
        </div>
      </div>
    </div>
  </>);
};
