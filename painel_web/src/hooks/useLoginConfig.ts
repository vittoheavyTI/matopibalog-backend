import { useState, useEffect } from 'react';
import api from '../api';

interface LoginConfig {
  loginLogo: string | null;
  loginLogoScale: number;
  loginLogoY: number;
  loginBg: string | null;
  loginBgScale: number;
  loginBgY: number;
  loginTemplate: string;
  footerText: string;
  contactPhone: string;
  contactEmail: string;
  footerColor: string;
  footerOpacity: number;
  footerFontSize: number;
  footerBold: boolean;
  footerFontFamily: string;
  footerWidth: number;
  footerHeight: number;
  inputBgColor: string;
  inputBorderColor: string;
}

function readFromLS(): LoginConfig {
  return {
    loginLogo: localStorage.getItem('choferlog_login_logo') || null,
    loginLogoScale: Number(localStorage.getItem('choferlog_login_logo_scale')) || 100,
    loginLogoY: Number(localStorage.getItem('choferlog_login_logo_y')) || 0,
    loginBg: localStorage.getItem('choferlog_login_bg') || null,
    loginBgScale: Number(localStorage.getItem('choferlog_login_bg_scale')) || 100,
    loginBgY: Number(localStorage.getItem('choferlog_login_bg_y')) || 0,
    loginTemplate: localStorage.getItem('choferlog_login_template') || 'classico',
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
}

function writeToLS(data: Record<string, any>) {
  const map: Record<string, string> = {
    loginLogo: 'choferlog_login_logo',
    loginLogoScale: 'choferlog_login_logo_scale',
    loginLogoY: 'choferlog_login_logo_y',
    loginBg: 'choferlog_login_bg',
    loginBgScale: 'choferlog_login_bg_scale',
    loginBgY: 'choferlog_login_bg_y',
    loginTemplate: 'choferlog_login_template',
    footerText: 'choferlog_login_footer',
    contactPhone: 'choferlog_contact_phone',
    contactEmail: 'choferlog_contact_email',
    footerColor: 'choferlog_footer_color',
    footerOpacity: 'choferlog_footer_opacity',
    footerFontSize: 'choferlog_footer_font_size',
    footerBold: 'choferlog_footer_bold',
    footerFontFamily: 'choferlog_footer_font_family',
    footerWidth: 'choferlog_footer_width',
    footerHeight: 'choferlog_footer_height',
    inputBgColor: 'choferlog_input_bg',
    inputBorderColor: 'choferlog_input_border',
  };
  for (const [key, lsKey] of Object.entries(map)) {
    if (data[key] !== undefined && data[key] !== null) {
      localStorage.setItem(lsKey, String(data[key]));
    }
  }
  if (data.company) localStorage.setItem('choferlog_company', JSON.stringify(data.company));
  if (data.printers) localStorage.setItem('choferlog_printers', JSON.stringify(data.printers));
}

export function useLoginConfig() {
  const [config, setConfig] = useState<LoginConfig>(readFromLS);

  useEffect(() => {
    api.get('/configuracoes/public')
      .then((response) => {
        const data = response.data;
        if (data && Object.keys(data).length > 0) {
          writeToLS(data);
          setConfig(readFromLS());
        }
      })
      .catch(() => {});
  }, []);

  return config;
}
