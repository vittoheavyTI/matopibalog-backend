import { useState, useEffect } from 'react';

const defaultConfig = {
  loginLogo: null as string | null,
  loginLogoScale: 100,
  loginLogoY: 0,
  loginBg: null as string | null,
  loginBgScale: 100,
  loginBgY: 0,
  cardScale: 100,
  cardX: 0,
  cardY: 0,
  cardColor: '#ffffff',
  cardOpacity: 100,
  footerText: '',
  contactPhone: '',
  contactEmail: '',
  footerColor: '#ffffff',
  footerOpacity: 70,
  footerFontSize: 14,
  footerBold: false,
  footerFontFamily: 'Arial',
  footerWidth: 80,
  footerHeight: 60,
  inputBgColor: '#ffffff',
  inputBorderColor: '#e5e7eb',
};

export function useLoginConfig() {
  const [config, setConfig] = useState(defaultConfig);

  useEffect(() => {
    const savedConfig = {
      loginLogo: localStorage.getItem('choferlog_login_logo'),
      loginLogoScale: Number(localStorage.getItem('choferlog_login_logo_scale')) || 100,
      loginLogoY: Number(localStorage.getItem('choferlog_login_logo_y')) || 0,
      loginBg: localStorage.getItem('choferlog_login_bg'),
      loginBgScale: Number(localStorage.getItem('choferlog_login_bg_scale')) || 100,
      loginBgY: Number(localStorage.getItem('choferlog_login_bg_y')) || 0,
      cardScale: Number(localStorage.getItem('choferlog_card_scale')) || 100,
      cardX: Number(localStorage.getItem('choferlog_card_x')) || 0,
      cardY: Number(localStorage.getItem('choferlog_card_y')) || 0,
      cardColor: localStorage.getItem('choferlog_card_color') || '#ffffff',
      cardOpacity: Number(localStorage.getItem('choferlog_card_opacity')) || 100,
      footerText: localStorage.getItem('choferlog_login_footer') || '',
      contactPhone: localStorage.getItem('choferlog_contact_phone') || '',
      contactEmail: localStorage.getItem('choferlog_contact_email') || '',
      footerColor: localStorage.getItem('choferlog_footer_color') || '#ffffff',
      footerOpacity: Number(localStorage.getItem('choferlog_footer_opacity')) || 70,
      footerFontSize: Number(localStorage.getItem('choferlog_footer_font_size')) || 14,
      footerBold: localStorage.getItem('choferlog_footer_bold') === 'true',
      footerFontFamily: localStorage.getItem('choferlog_footer_font_family') || 'Arial',
      footerWidth: Number(localStorage.getItem('choferlog_footer_width')) || 80,
      footerHeight: Number(localStorage.getItem('choferlog_footer_height')) || 60,
      inputBgColor: localStorage.getItem('choferlog_input_bg') || '#ffffff',
      inputBorderColor: localStorage.getItem('choferlog_input_border') || '#e5e7eb',
    };
    setConfig(savedConfig);
  }, []);

  return config;
}
