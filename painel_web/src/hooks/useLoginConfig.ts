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
          const changed: Record<string, any> = {};

          if (d.loginLogo !== undefined && !localStorage.getItem('choferlog_login_logo')) {
            localStorage.setItem('choferlog_login_logo', d.loginLogo);
            changed.loginLogo = d.loginLogo;
          }
          if (d.loginLogoScale !== undefined && !localStorage.getItem('choferlog_login_logo_scale')) {
            localStorage.setItem('choferlog_login_logo_scale', d.loginLogoScale.toString());
            changed.loginLogoScale = d.loginLogoScale;
          }
          if (d.loginLogoY !== undefined && !localStorage.getItem('choferlog_login_logo_y')) {
            localStorage.setItem('choferlog_login_logo_y', d.loginLogoY.toString());
            changed.loginLogoY = d.loginLogoY;
          }

          if (d.loginBg !== undefined && !localStorage.getItem('choferlog_login_bg')) {
            localStorage.setItem('choferlog_login_bg', d.loginBg);
            changed.loginBg = d.loginBg;
          }
          if (d.loginBgScale !== undefined && !localStorage.getItem('choferlog_login_bg_scale')) {
            localStorage.setItem('choferlog_login_bg_scale', d.loginBgScale.toString());
            changed.loginBgScale = d.loginBgScale;
          }
          if (d.loginBgY !== undefined && !localStorage.getItem('choferlog_login_bg_y')) {
            localStorage.setItem('choferlog_login_bg_y', d.loginBgY.toString());
            changed.loginBgY = d.loginBgY;
          }

          if (d.cardScale !== undefined && !localStorage.getItem('choferlog_card_scale')) {
            localStorage.setItem('choferlog_card_scale', d.cardScale.toString());
            changed.cardScale = d.cardScale;
          }
          if (d.cardX !== undefined && !localStorage.getItem('choferlog_card_x')) {
            localStorage.setItem('choferlog_card_x', d.cardX.toString());
            changed.cardX = d.cardX;
          }
          if (d.cardY !== undefined && !localStorage.getItem('choferlog_card_y')) {
            localStorage.setItem('choferlog_card_y', d.cardY.toString());
            changed.cardY = d.cardY;
          }
          if (d.cardColor !== undefined && !localStorage.getItem('choferlog_card_color')) {
            localStorage.setItem('choferlog_card_color', d.cardColor);
            changed.cardColor = d.cardColor;
          }
          if (d.cardOpacity !== undefined && !localStorage.getItem('choferlog_card_opacity')) {
            localStorage.setItem('choferlog_card_opacity', d.cardOpacity.toString());
            changed.cardOpacity = d.cardOpacity;
          }

          if (d.footerText !== undefined && !localStorage.getItem('choferlog_login_footer')) {
            localStorage.setItem('choferlog_login_footer', d.footerText);
            changed.footerText = d.footerText;
          }
          if (d.contactPhone !== undefined && !localStorage.getItem('choferlog_contact_phone')) {
            localStorage.setItem('choferlog_contact_phone', d.contactPhone);
            changed.contactPhone = d.contactPhone;
          }
          if (d.contactEmail !== undefined && !localStorage.getItem('choferlog_contact_email')) {
            localStorage.setItem('choferlog_contact_email', d.contactEmail);
            changed.contactEmail = d.contactEmail;
          }
          if (d.footerColor !== undefined && !localStorage.getItem('choferlog_footer_color')) {
            localStorage.setItem('choferlog_footer_color', d.footerColor);
            changed.footerColor = d.footerColor;
          }
          if (d.footerOpacity !== undefined && !localStorage.getItem('choferlog_footer_opacity')) {
            localStorage.setItem('choferlog_footer_opacity', d.footerOpacity.toString());
            changed.footerOpacity = d.footerOpacity;
          }
          if (d.footerFontSize !== undefined && !localStorage.getItem('choferlog_footer_font_size')) {
            localStorage.setItem('choferlog_footer_font_size', d.footerFontSize.toString());
            changed.footerFontSize = d.footerFontSize;
          }
          if (d.footerBold !== undefined && !localStorage.getItem('choferlog_footer_bold')) {
            localStorage.setItem('choferlog_footer_bold', d.footerBold.toString());
            changed.footerBold = d.footerBold;
          }
          if (d.footerFontFamily !== undefined && !localStorage.getItem('choferlog_footer_font_family')) {
            localStorage.setItem('choferlog_footer_font_family', d.footerFontFamily);
            changed.footerFontFamily = d.footerFontFamily;
          }
          if (d.footerWidth !== undefined && !localStorage.getItem('choferlog_footer_width')) {
            localStorage.setItem('choferlog_footer_width', d.footerWidth.toString());
            changed.footerWidth = d.footerWidth;
          }
          if (d.footerHeight !== undefined && !localStorage.getItem('choferlog_footer_height')) {
            localStorage.setItem('choferlog_footer_height', d.footerHeight.toString());
            changed.footerHeight = d.footerHeight;
          }

          if (d.inputBgColor !== undefined && !localStorage.getItem('choferlog_input_bg')) {
            localStorage.setItem('choferlog_input_bg', d.inputBgColor);
            changed.inputBgColor = d.inputBgColor;
          }
          if (d.inputBorderColor !== undefined && !localStorage.getItem('choferlog_input_border')) {
            localStorage.setItem('choferlog_input_border', d.inputBorderColor);
            changed.inputBorderColor = d.inputBorderColor;
          }

          if (Object.keys(changed).length > 0) {
            setConfig(prev => ({ ...prev, ...changed }));
          }
        }
      })
      .catch((err) => {
        console.error('Erro ao buscar configuracoes publicas:', err);
      });
  }, []);

  return config;
}
