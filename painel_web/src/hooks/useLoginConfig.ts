import { useState } from 'react';

export function useLoginConfig() {
  const [config] = useState(() => {
    // Inicialização síncrona — lê do localStorage ANTES do primeiro render
    // Isso elimina o flicker (tela piscando desconfigurada)
    return {
      loginLogo: localStorage.getItem('choferlog_login_logo') || null,
      loginLogoScale: Number(localStorage.getItem('choferlog_login_logo_scale')) || 100,
      loginLogoY: Number(localStorage.getItem('choferlog_login_logo_y')) || 0,
      loginBg: localStorage.getItem('choferlog_login_bg') || null,
      loginBgScale: Number(localStorage.getItem('choferlog_login_bg_scale')) || 100,
      loginBgY: Number(localStorage.getItem('choferlog_login_bg_y')) || 0,
      cardWidth: Number(localStorage.getItem('choferlog_card_width')) || 380,
      cardX: Number(localStorage.getItem('choferlog_card_x')) || 0,
      cardY: Number(localStorage.getItem('choferlog_card_y')) || 0,
      cardColor: localStorage.getItem('choferlog_card_color') || '#ffffff',
      cardOpacity: Number(localStorage.getItem('choferlog_card_opacity')) || 100,
      cardFontFamily: localStorage.getItem('choferlog_card_font_family') || 'Arial',
      cardFontSize: Number(localStorage.getItem('choferlog_card_font_size')) || 14,
      cardFontColor: localStorage.getItem('choferlog_card_font_color') || '#374151',
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
  });

  return config;
}
