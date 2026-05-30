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
          const merged: Record<string, any> = {};

          if (d.loginLogo !== undefined) {
            if (d.loginLogo) localStorage.setItem('choferlog_login_logo', d.loginLogo);
            else localStorage.removeItem('choferlog_login_logo');
            merged.loginLogo = d.loginLogo;
          }
          if (d.loginLogoScale !== undefined) {
            localStorage.setItem('choferlog_login_logo_scale', d.loginLogoScale.toString());
            merged.loginLogoScale = d.loginLogoScale;
          }
          if (d.loginLogoY !== undefined) {
            localStorage.setItem('choferlog_login_logo_y', d.loginLogoY.toString());
            merged.loginLogoY = d.loginLogoY;
          }
          if (d.loginBg !== undefined) {
            if (d.loginBg) localStorage.setItem('choferlog_login_bg', d.loginBg);
            else localStorage.removeItem('choferlog_login_bg');
            merged.loginBg = d.loginBg;
          }
          if (d.loginBgScale !== undefined) {
            localStorage.setItem('choferlog_login_bg_scale', d.loginBgScale.toString());
            merged.loginBgScale = d.loginBgScale;
          }
          if (d.loginBgY !== undefined) {
            localStorage.setItem('choferlog_login_bg_y', d.loginBgY.toString());
            merged.loginBgY = d.loginBgY;
          }
          if (d.cardScale !== undefined) {
            localStorage.setItem('choferlog_card_scale', d.cardScale.toString());
            merged.cardScale = d.cardScale;
          }
          if (d.cardX !== undefined) {
            localStorage.setItem('choferlog_card_x', d.cardX.toString());
            merged.cardX = d.cardX;
          }
          if (d.cardY !== undefined) {
            localStorage.setItem('choferlog_card_y', d.cardY.toString());
            merged.cardY = d.cardY;
          }
          if (d.cardColor !== undefined) {
            localStorage.setItem('choferlog_card_color', d.cardColor);
            merged.cardColor = d.cardColor;
          }
          if (d.cardOpacity !== undefined) {
            localStorage.setItem('choferlog_card_opacity', d.cardOpacity.toString());
            merged.cardOpacity = d.cardOpacity;
          }
          if (d.footerText !== undefined) {
            localStorage.setItem('choferlog_login_footer', d.footerText);
            merged.footerText = d.footerText;
          }
          if (d.contactPhone !== undefined) {
            localStorage.setItem('choferlog_contact_phone', d.contactPhone);
            merged.contactPhone = d.contactPhone;
          }
          if (d.contactEmail !== undefined) {
            localStorage.setItem('choferlog_contact_email', d.contactEmail);
            merged.contactEmail = d.contactEmail;
          }
          if (d.footerColor !== undefined) {
            localStorage.setItem('choferlog_footer_color', d.footerColor);
            merged.footerColor = d.footerColor;
          }
          if (d.footerOpacity !== undefined) {
            localStorage.setItem('choferlog_footer_opacity', d.footerOpacity.toString());
            merged.footerOpacity = d.footerOpacity;
          }
          if (d.footerFontSize !== undefined) {
            localStorage.setItem('choferlog_footer_font_size', d.footerFontSize.toString());
            merged.footerFontSize = d.footerFontSize;
          }
          if (d.footerBold !== undefined) {
            localStorage.setItem('choferlog_footer_bold', d.footerBold.toString());
            merged.footerBold = d.footerBold;
          }
          if (d.footerFontFamily !== undefined) {
            localStorage.setItem('choferlog_footer_font_family', d.footerFontFamily);
            merged.footerFontFamily = d.footerFontFamily;
          }
          if (d.footerWidth !== undefined) {
            localStorage.setItem('choferlog_footer_width', d.footerWidth.toString());
            merged.footerWidth = d.footerWidth;
          }
          if (d.footerHeight !== undefined) {
            localStorage.setItem('choferlog_footer_height', d.footerHeight.toString());
            merged.footerHeight = d.footerHeight;
          }
          if (d.inputBgColor !== undefined) {
            localStorage.setItem('choferlog_input_bg', d.inputBgColor);
            merged.inputBgColor = d.inputBgColor;
          }
          if (d.inputBorderColor !== undefined) {
            localStorage.setItem('choferlog_input_border', d.inputBorderColor);
            merged.inputBorderColor = d.inputBorderColor;
          }

          setConfig(prev => ({ ...prev, ...merged }));
        }
      })
      .catch((err) => {
        console.error('Erro ao buscar configuracoes publicas:', err);
      });
  }, []);

  return config;
}
