import { useState, useEffect } from 'react';
import api from '../api';

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

const getInitialConfig = () => {
  if (typeof window === 'undefined') return defaultConfig;

  if (!localStorage.getItem('choferlog_card_scale')) localStorage.setItem('choferlog_card_scale', '100');
  if (!localStorage.getItem('choferlog_card_x')) localStorage.setItem('choferlog_card_x', '0');
  if (!localStorage.getItem('choferlog_card_y')) localStorage.setItem('choferlog_card_y', '0');
  if (!localStorage.getItem('choferlog_card_color')) localStorage.setItem('choferlog_card_color', '#ffffff');
  if (!localStorage.getItem('choferlog_card_opacity')) localStorage.setItem('choferlog_card_opacity', '100');
  if (!localStorage.getItem('choferlog_footer_color')) localStorage.setItem('choferlog_footer_color', '#ffffff');
  if (!localStorage.getItem('choferlog_footer_opacity')) localStorage.setItem('choferlog_footer_opacity', '70');
  if (!localStorage.getItem('choferlog_footer_font_size')) localStorage.setItem('choferlog_footer_font_size', '14');
  if (!localStorage.getItem('choferlog_footer_bold')) localStorage.setItem('choferlog_footer_bold', 'false');
  if (!localStorage.getItem('choferlog_footer_font_family')) localStorage.setItem('choferlog_footer_font_family', 'Arial');
  if (!localStorage.getItem('choferlog_footer_width')) localStorage.setItem('choferlog_footer_width', '80');
  if (!localStorage.getItem('choferlog_footer_height')) localStorage.setItem('choferlog_footer_height', '60');
  if (!localStorage.getItem('choferlog_input_bg')) localStorage.setItem('choferlog_input_bg', '#ffffff');
  if (!localStorage.getItem('choferlog_input_border')) localStorage.setItem('choferlog_input_border', '#e5e7eb');

  return {
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
};

export function useLoginConfig() {
  const [config, setConfig] = useState(getInitialConfig);

  useEffect(() => {
    api.get('/configuracoes/public')
      .then((response) => {
        const d = response.data;
        if (d && Object.keys(d).length > 0) {
          if (d.loginLogo !== undefined) {
            if (d.loginLogo) localStorage.setItem('choferlog_login_logo', d.loginLogo);
            else localStorage.removeItem('choferlog_login_logo');
          }
          if (d.loginLogoScale !== undefined) localStorage.setItem('choferlog_login_logo_scale', d.loginLogoScale.toString());
          if (d.loginLogoY !== undefined) localStorage.setItem('choferlog_login_logo_y', d.loginLogoY.toString());
          
          if (d.loginBg !== undefined) {
            if (d.loginBg) localStorage.setItem('choferlog_login_bg', d.loginBg);
            else localStorage.removeItem('choferlog_login_bg');
          }
          if (d.loginBgScale !== undefined) localStorage.setItem('choferlog_login_bg_scale', d.loginBgScale.toString());
          if (d.loginBgY !== undefined) localStorage.setItem('choferlog_login_bg_y', d.loginBgY.toString());
          
          if (d.cardScale !== undefined) localStorage.setItem('choferlog_card_scale', d.cardScale.toString());
          if (d.cardX !== undefined) localStorage.setItem('choferlog_card_x', d.cardX.toString());
          if (d.cardY !== undefined) localStorage.setItem('choferlog_card_y', d.cardY.toString());
          if (d.cardColor !== undefined) localStorage.setItem('choferlog_card_color', d.cardColor);
          if (d.cardOpacity !== undefined) localStorage.setItem('choferlog_card_opacity', d.cardOpacity.toString());
          
          if (d.footerText !== undefined) localStorage.setItem('choferlog_login_footer', d.footerText);
          if (d.contactPhone !== undefined) localStorage.setItem('choferlog_contact_phone', d.contactPhone);
          if (d.contactEmail !== undefined) localStorage.setItem('choferlog_contact_email', d.contactEmail);
          if (d.footerColor !== undefined) localStorage.setItem('choferlog_footer_color', d.footerColor);
          if (d.footerOpacity !== undefined) localStorage.setItem('choferlog_footer_opacity', d.footerOpacity.toString());
          if (d.footerFontSize !== undefined) localStorage.setItem('choferlog_footer_font_size', d.footerFontSize.toString());
          if (d.footerBold !== undefined) localStorage.setItem('choferlog_footer_bold', d.footerBold.toString());
          if (d.footerFontFamily !== undefined) localStorage.setItem('choferlog_footer_font_family', d.footerFontFamily);
          if (d.footerWidth !== undefined) localStorage.setItem('choferlog_footer_width', d.footerWidth.toString());
          if (d.footerHeight !== undefined) localStorage.setItem('choferlog_footer_height', d.footerHeight.toString());
          
          if (d.inputBgColor !== undefined) localStorage.setItem('choferlog_input_bg', d.inputBgColor);
          if (d.inputBorderColor !== undefined) localStorage.setItem('choferlog_input_border', d.inputBorderColor);

          setConfig({
            loginLogo: d.loginLogo || null,
            loginLogoScale: Number(d.loginLogoScale) || 100,
            loginLogoY: Number(d.loginLogoY) || 0,
            loginBg: d.loginBg || null,
            loginBgScale: Number(d.loginBgScale) || 100,
            loginBgY: Number(d.loginBgY) || 0,
            cardScale: Number(d.cardScale) || 100,
            cardX: Number(d.cardX) || 0,
            cardY: Number(d.cardY) || 0,
            cardColor: d.cardColor || '#ffffff',
            cardOpacity: Number(d.cardOpacity) || 100,
            footerText: d.footerText || '',
            contactPhone: d.contactPhone || '',
            contactEmail: d.contactEmail || '',
            footerColor: d.footerColor || '#ffffff',
            footerOpacity: Number(d.footerOpacity) || 70,
            footerFontSize: Number(d.footerFontSize) || 14,
            footerBold: d.footerBold === true || d.footerBold === 'true',
            footerFontFamily: d.footerFontFamily || 'Arial',
            footerWidth: Number(d.footerWidth) || 80,
            footerHeight: Number(d.footerHeight) || 60,
            inputBgColor: d.inputBgColor || '#ffffff',
            inputBorderColor: d.inputBorderColor || '#e5e7eb',
          });
        }
      })
      .catch((err) => {
        console.error('Erro ao buscar configuracoes publicas:', err);
      });
  }, []);

  return config;
}
