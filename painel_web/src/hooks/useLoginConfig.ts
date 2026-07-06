import { useState, useEffect } from 'react';
import api from '../api';

export interface LoginConfig {
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
  cardOpacity: number;
}

// Prefixo padronizado — matopibalog_
const PREFIX = 'matopibalog_';

// Migração automática: move chaves choferlog_ para matopibalog_ (roda uma vez)
function migrateKeys() {
  const migrated = localStorage.getItem('matopibalog_migrated');
  if (migrated) return;
  const oldKeys: Record<string, string> = {
    'choferlog_login_logo': 'matopibalog_login_logo',
    'choferlog_login_logo_scale': 'matopibalog_login_logo_scale',
    'choferlog_login_logo_y': 'matopibalog_login_logo_y',
    'choferlog_login_bg': 'matopibalog_login_bg',
    'choferlog_login_bg_scale': 'matopibalog_login_bg_scale',
    'choferlog_login_bg_y': 'matopibalog_login_bg_y',
    'choferlog_login_template': 'matopibalog_login_template',
    'choferlog_login_footer': 'matopibalog_login_footer',
    'choferlog_contact_phone': 'matopibalog_contact_phone',
    'choferlog_contact_email': 'matopibalog_contact_email',
    'choferlog_footer_color': 'matopibalog_footer_color',
    'choferlog_footer_opacity': 'matopibalog_footer_opacity',
    'choferlog_footer_font_size': 'matopibalog_footer_font_size',
    'choferlog_footer_bold': 'matopibalog_footer_bold',
    'choferlog_footer_font_family': 'matopibalog_footer_font_family',
    'choferlog_footer_width': 'matopibalog_footer_width',
    'choferlog_footer_height': 'matopibalog_footer_height',
    'choferlog_input_bg': 'matopibalog_input_bg',
    'choferlog_input_border': 'matopibalog_input_border',
    'choferlog_company': 'matopibalog_company',
    'choferlog_printers': 'matopibalog_printers',
  };
  for (const [oldKey, newKey] of Object.entries(oldKeys)) {
    const val = localStorage.getItem(oldKey);
    if (val !== null) {
      localStorage.setItem(newKey, val);
      localStorage.removeItem(oldKey);
    }
  }
  localStorage.setItem('matopibalog_migrated', 'true');
}

export function readFromLS(): LoginConfig {
  migrateKeys();
  return {
    loginLogo: localStorage.getItem(`${PREFIX}login_logo`) || null,
    loginLogoScale: Number(localStorage.getItem(`${PREFIX}login_logo_scale`)) || 100,
    loginLogoY: Number(localStorage.getItem(`${PREFIX}login_logo_y`)) || 0,
    loginBg: localStorage.getItem(`${PREFIX}login_bg`) || null,
    loginBgScale: Number(localStorage.getItem(`${PREFIX}login_bg_scale`)) || 100,
    loginBgY: Number(localStorage.getItem(`${PREFIX}login_bg_y`)) || 0,
    loginTemplate: localStorage.getItem(`${PREFIX}login_template`) || 'classico',
    footerText: localStorage.getItem(`${PREFIX}login_footer`) || '',
    contactPhone: localStorage.getItem(`${PREFIX}contact_phone`) || '',
    contactEmail: localStorage.getItem(`${PREFIX}contact_email`) || '',
    footerColor: localStorage.getItem(`${PREFIX}footer_color`) || '#ffffff',
    footerOpacity: Number(localStorage.getItem(`${PREFIX}footer_opacity`)) || 70,
    footerFontSize: Number(localStorage.getItem(`${PREFIX}footer_font_size`)) || 14,
    footerBold: localStorage.getItem(`${PREFIX}footer_bold`) === 'true',
    footerFontFamily: localStorage.getItem(`${PREFIX}footer_font_family`) || 'Arial',
    footerWidth: Number(localStorage.getItem(`${PREFIX}footer_width`)) || 80,
    footerHeight: Number(localStorage.getItem(`${PREFIX}footer_height`)) || 60,
    inputBgColor: localStorage.getItem(`${PREFIX}input_bg`) || '#ffffff',
    inputBorderColor: localStorage.getItem(`${PREFIX}input_border`) || '#e5e7eb',
    cardOpacity: Number(localStorage.getItem(`${PREFIX}card_opacity`)) || 100,
  };
}

export function writeToLS(data: Record<string, any>) {
  const map: Record<string, string> = {
    loginLogo: `${PREFIX}login_logo`,
    loginLogoScale: `${PREFIX}login_logo_scale`,
    loginLogoY: `${PREFIX}login_logo_y`,
    loginBg: `${PREFIX}login_bg`,
    loginBgScale: `${PREFIX}login_bg_scale`,
    loginBgY: `${PREFIX}login_bg_y`,
    loginTemplate: `${PREFIX}login_template`,
    footerText: `${PREFIX}login_footer`,
    contactPhone: `${PREFIX}contact_phone`,
    contactEmail: `${PREFIX}contact_email`,
    footerColor: `${PREFIX}footer_color`,
    footerOpacity: `${PREFIX}footer_opacity`,
    footerFontSize: `${PREFIX}footer_font_size`,
    footerBold: `${PREFIX}footer_bold`,
    footerFontFamily: `${PREFIX}footer_font_family`,
    footerWidth: `${PREFIX}footer_width`,
    footerHeight: `${PREFIX}footer_height`,
    inputBgColor: `${PREFIX}input_bg`,
    inputBorderColor: `${PREFIX}input_border`,
    cardOpacity: `${PREFIX}card_opacity`,
  };
  for (const [key, lsKey] of Object.entries(map)) {
    if (data[key] !== undefined && data[key] !== null) {
      localStorage.setItem(lsKey, String(data[key]));
    }
  }
  if (data.company) localStorage.setItem(`${PREFIX}company`, JSON.stringify(data.company));
  if (data.printers) localStorage.setItem(`${PREFIX}printers`, JSON.stringify(data.printers));

  // Dispara evento customizado para que componentes na mesma aba reajam
  window.dispatchEvent(new CustomEvent('matopibalog:config-changed'));
}

export interface LoginConfigResult extends LoginConfig {
  configLoading: boolean;
}

export function useLoginConfig(): LoginConfigResult {
  const [config, setConfig] = useState<LoginConfig>(readFromLS);
  const [configLoading, setConfigLoading] = useState(true);

  // Reage a mudanças na mesma aba (evento customizado)
  useEffect(() => {
    const handleChange = () => setConfig(readFromLS());
    window.addEventListener('matopibalog:config-changed', handleChange);
    return () => window.removeEventListener('matopibalog:config-changed', handleChange);
  }, []);

  // Reage a mudanças em outras abas (evento nativo do browser)
  useEffect(() => {
    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key?.startsWith(PREFIX)) {
        setConfig(readFromLS());
      }
    };
    window.addEventListener('storage', handleStorageEvent);
    return () => window.removeEventListener('storage', handleStorageEvent);
  }, []);

  // Busca configurações do servidor uma vez na montagem — só mostra login após retorno
  useEffect(() => {
    api.get('/configuracoes/public')
      .then((response) => {
        const data = response.data;
        if (data && Object.keys(data).length > 0) {
          writeToLS(data);
          setConfig(readFromLS());
        }
      })
      .catch(() => {})
      .finally(() => setConfigLoading(false));
  }, []);

  return { ...config, configLoading };
}
