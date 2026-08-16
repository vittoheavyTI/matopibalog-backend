import React, { useState, useEffect, useRef } from 'react';
import {
  Building2, Save, Check, Image,
  Palette, X, Upload, Trash2, Truck, Move, Settings, FileText, UserCircle, Network, Plug, ShieldCheck
} from 'lucide-react';
import { useLocation, Link } from 'react-router-dom';
import { maskPhone, maskCNPJ, maskCEP } from '../utils/masks';
import api from '../api';
import { writeToLS } from '../hooks/useLoginConfig';
import { useAuth } from '../contexts/AuthContext';
import { BotaoCopiarCodigo } from '../components/BotaoCopiarCodigo';
import { usePortalGovernanca } from '../hooks/usePortalGovernanca';

const PREFIX = 'matopibalog_';

// Logomarca da EMPRESA (per-tenant): cache dedicado que os relatórios/Sidebar
// preferem sobre a logo global do sistema.
const EMPRESA_LOGO_KEY = 'matopibalog_empresa_logo';
const LOGO_TIPOS_ACEITOS = ['image/png', 'image/jpeg', 'image/webp'];
const LOGO_MAX_BYTES = 1024 * 1024; // 1 MB

// Notifica o Sidebar (e outras telas) que a logomarca da empresa mudou — sync sem reload.
function notificarLogoEmpresa() {
  try { window.dispatchEvent(new Event('matopibalog:empresa-logo')); } catch { /* ignore */ }
}

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

interface CompanyData {
  nome: string; cnpj: string; endereco: string; cep: string;
  complemento: string; pontoReferencia: string; cidade: string;
  estado: string; telefone: string; email: string;
}


function getContrastTextColor(hexColor: string): string {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#1f2937' : '#ffffff';
}

export const Configuracoes: React.FC = () => {
  const location = useLocation();
  const abaInicial = new URLSearchParams(location.search).get('aba');
  const [activeTab, setActiveTab] = useState<'perfil' | 'empresa' | 'estrutura' | 'erp' | 'sso' | 'sistema' | 'aparencia'>(
    abaInicial === 'perfil' ? 'perfil' : 'empresa'
  );
  const { user } = useAuth();
  const { governanca } = usePortalGovernanca();
  const [codigoConvite, setCodigoConvite] = useState<string | null>(null);
  const [regenerandoCodigo, setRegenerandoCodigo] = useState(false);
  // Config. Sistema (super-admin) — migrada da antiga página solta "Config. Sistema"
  // para uma aba aqui, evitando página duplicada no menu.
  const [sistema, setSistema] = useState({ nome_sistema: 'Matopiba Log', email_suporte: 'suporte@matopibalog.com.br', whatsapp_suporte: '', telefone_suporte: '', trial_dias: '7' });
  const [sistemaSalvo, setSistemaSalvo] = useState(false);
  const [company, setCompany] = useState<CompanyData>({
    nome: '', cnpj: '', endereco: '', cep: '',
    complemento: '', pontoReferencia: '', cidade: '', estado: '', telefone: '', email: '',
  });
  const [perfil, setPerfil] = useState({
    nome: user?.nome || '',
    email: user?.email || '',
    telefone: '',
    celular: '',
    cep: '',
    endereco: '',
    bairro: '',
    cidade: '',
  });
  const [perfilSalvo, setPerfilSalvo] = useState(false);

  // Logomarca da EMPRESA (per-tenant, config_empresa.logomarca)
  const [empresaLogo, setEmpresaLogo] = useState<string | null>(() => localStorage.getItem(EMPRESA_LOGO_KEY) || null);
  const [logoSalvando, setLogoSalvando] = useState(false);
  const [logoErro, setLogoErro] = useState<string>('');
  const [logoSalvo, setLogoSalvo] = useState(false);
  const empresaLogoFileRef = useRef<HTMLInputElement>(null);


  // Estados de aparência — inicializados do localStorage diretamente
  const [loginLogo, setLoginLogo] = useState<string | null>(() => localStorage.getItem(`${PREFIX}login_logo`) || null);
  const [loginBg, setLoginBg] = useState<string | null>(() => localStorage.getItem(`${PREFIX}login_bg`) || null);
  const [showSaved, setShowSaved] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(() => localStorage.getItem(`${PREFIX}login_template`) || 'classico');
  const [footerText, setFooterText] = useState(() => localStorage.getItem(`${PREFIX}login_footer`) || '');
  const [contactPhone, setContactPhone] = useState(() => localStorage.getItem(`${PREFIX}contact_phone`) || '');
  const [contactEmail, setContactEmail] = useState(() => localStorage.getItem(`${PREFIX}contact_email`) || '');
  const [footerColor, setFooterColor] = useState(() => localStorage.getItem(`${PREFIX}footer_color`) || '#ffffff');
  const [footerOpacity, setFooterOpacity] = useState(() => Number(localStorage.getItem(`${PREFIX}footer_opacity`)) || 70);
  const [footerFontSize, setFooterFontSize] = useState(() => Number(localStorage.getItem(`${PREFIX}footer_font_size`)) || 14);
  const [footerBold, setFooterBold] = useState(() => localStorage.getItem(`${PREFIX}footer_bold`) === 'true');
  const [footerFontFamily, setFooterFontFamily] = useState(() => localStorage.getItem(`${PREFIX}footer_font_family`) || 'Arial');
  const [footerWidth, setFooterWidth] = useState(() => Number(localStorage.getItem(`${PREFIX}footer_width`)) || 80);
  const [inputBgColor, setInputBgColor] = useState(() => localStorage.getItem(`${PREFIX}input_bg`) || '#ffffff');
  const [inputBorderColor, setInputBorderColor] = useState(() => localStorage.getItem(`${PREFIX}input_border`) || '#e5e7eb');
  const [cardOpacity, setCardOpacity] = useState(() => Number(localStorage.getItem(`${PREFIX}card_opacity`)) || 100);

  // Posição customizada do card
  const [cardOffsetX, setCardOffsetX] = useState(() => Number(localStorage.getItem(`${PREFIX}card_offset_x`)) || 0);
  const [cardOffsetY, setCardOffsetY] = useState(() => Number(localStorage.getItem(`${PREFIX}card_offset_y`)) || 0);

  // Modal de edição de imagem
  const [editingTarget, setEditingTarget] = useState<'logo' | 'bg' | null>(null);
  const [tempImg, setTempImg] = useState<string | null>(null);
  const [tempScale, setTempScale] = useState(100);
  const [tempY, setTempY] = useState(0);

  const logoFileRef = useRef<HTMLInputElement>(null);
  const bgFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const aba = new URLSearchParams(location.search).get('aba');
    if (aba === 'perfil') setActiveTab('perfil');
  }, [location.search]);

  useEffect(() => {
    api.get('/auth/me')
      .then(({ data }) => setPerfil({
        nome: data.nome || '',
        email: data.email || '',
        telefone: data.telefone || '',
        celular: data.celular || '',
        cep: data.cep || '',
        endereco: data.endereco || '',
        bairro: data.bairro || '',
        cidade: data.cidade || '',
      }))
      .catch(() => {});
  }, []);

  // Busca código de convite da empresa
  useEffect(() => {
    api.get('/configuracoes/codigo-convite')
      .then((r) => setCodigoConvite(r.data.codigo_convite))
      .catch(() => setCodigoConvite(null));
  }, []);

  const handleRegenarCodigo = async () => {
    if (!window.confirm('Isso irá invalidar o código atual. Motoristas com o código antigo não conseguirão mais se cadastrar. Continuar?')) return;
    setRegenerandoCodigo(true);
    try {
      const r = await api.post('/configuracoes/codigo-convite/regenerar');
      setCodigoConvite(r.data.codigo_convite);
    } catch {
      alert('Erro ao regenerar código. Tente novamente.');
    } finally {
      setRegenerandoCodigo(false);
    }
  };

  // Carrega dados da empresa do localStorage
  useEffect(() => {
    const savedCompany = localStorage.getItem(`${PREFIX}company`);
    if (savedCompany) {
      try { setCompany(JSON.parse(savedCompany)); } catch { }
    }
  }, []);

  // Busca configurações do servidor e aplica nos estados
  useEffect(() => {
    api.get('/configuracoes')
      .then((response) => {
        const d = response.data;
        if (!d) return;
        if (d.loginLogo !== undefined) setLoginLogo(d.loginLogo);
        if (d.loginBg !== undefined) setLoginBg(d.loginBg);
        if (d.footerText !== undefined) setFooterText(d.footerText);
        if (d.contactPhone !== undefined) setContactPhone(d.contactPhone);
        if (d.contactEmail !== undefined) setContactEmail(d.contactEmail);
        if (d.footerColor) setFooterColor(d.footerColor);
        if (d.footerOpacity !== undefined) setFooterOpacity(d.footerOpacity);
        if (d.footerFontSize !== undefined) setFooterFontSize(d.footerFontSize);
        if (d.footerBold !== undefined) setFooterBold(d.footerBold);
        if (d.footerFontFamily) setFooterFontFamily(d.footerFontFamily);
        if (d.footerWidth !== undefined) setFooterWidth(d.footerWidth);
        if (d.inputBgColor) setInputBgColor(d.inputBgColor);
        if (d.inputBorderColor) setInputBorderColor(d.inputBorderColor);
        if (d.cardOpacity !== undefined) setCardOpacity(d.cardOpacity);
        if (d.loginTemplate) setSelectedTemplate(d.loginTemplate);
        // Config. Sistema (aba Sistema): carrega valores globais existentes, se houver.
        setSistema((s) => ({
          nome_sistema: d.nome_sistema ?? s.nome_sistema,
          email_suporte: d.email_suporte ?? s.email_suporte,
          whatsapp_suporte: d.whatsapp_suporte ?? s.whatsapp_suporte,
          telefone_suporte: d.telefone_suporte ?? s.telefone_suporte,
          trial_dias: d.trial_dias !== undefined && d.trial_dias !== null ? String(d.trial_dias) : s.trial_dias,
        }));
        // Sincroniza sidebar logo do backend → localStorage (persiste entre dispositivos)
        if (d.sidebarLogo)                   localStorage.setItem('matopibalog_logo', d.sidebarLogo);
        if (d.sidebarLogoScale !== undefined) localStorage.setItem('matopibalog_logo_scale', String(d.sidebarLogoScale));
        if (d.sidebarLogoY !== undefined)     localStorage.setItem('matopibalog_logo_y', String(d.sidebarLogoY));
        // Escreve no localStorage para manter consistência
        writeToLS(d);
      })
      .catch(() => { });
  }, []);

  // Dados da empresa vêm do caminho por-empresa (não do blob global) (#16/#32)
  useEffect(() => {
    api.get('/configuracoes/empresa')
      .then((response) => {
        if (response.data && Object.keys(response.data).length > 0) {
          // A logomarca vive no mesmo config_empresa, mas é tratada à parte: não é
          // campo de formulário e não deve inflar o cache 'company' que os relatórios
          // usam para o nome/CNPJ.
          const { logomarca, ...dadosEmpresa } = response.data as any;
          setCompany(dadosEmpresa as CompanyData);
          localStorage.setItem(`${PREFIX}company`, JSON.stringify(dadosEmpresa));
          const logo = typeof logomarca === 'string' && logomarca.trim() ? logomarca : null;
          setEmpresaLogo(logo);
          if (logo) localStorage.setItem(EMPRESA_LOGO_KEY, logo);
          else localStorage.removeItem(EMPRESA_LOGO_KEY);
          notificarLogoEmpresa();
        } else {
          // API retornou vazio: limpa cache antigo para não vazar dados de outra conta
          localStorage.removeItem(`${PREFIX}company`);
          setEmpresaLogo(null);
          localStorage.removeItem(EMPRESA_LOGO_KEY);
          notificarLogoEmpresa();
        }
      })
      .catch(() => { });
  }, []);

  const syncConfigToServer = async (overrides: Record<string, any> = {}) => {
    const dados: Record<string, any> = {
      company,
      loginLogo,
      loginBg,
      footerText,
      contactPhone,
      contactEmail,
      footerColor,
      footerOpacity,
      footerFontSize,
      footerBold,
      footerFontFamily,
      footerWidth,
      inputBgColor,
      inputBorderColor,
      cardOpacity,
      loginTemplate: selectedTemplate,
      cardOffsetX,
      cardOffsetY,
      loginLogoScale: Number(localStorage.getItem(`${PREFIX}login_logo_scale`)) || 100,
      loginLogoY: Number(localStorage.getItem(`${PREFIX}login_logo_y`)) || 0,
      loginBgScale: Number(localStorage.getItem(`${PREFIX}login_bg_scale`)) || 100,
      loginBgY: Number(localStorage.getItem(`${PREFIX}login_bg_y`)) || 0,
      // Sidebar logo — persiste ao backend para sobreviver troca de dispositivo/localStorage
      sidebarLogo: localStorage.getItem('matopibalog_logo') || null,
      sidebarLogoScale: Number(localStorage.getItem('matopibalog_logo_scale')) || 100,
      sidebarLogoY: Number(localStorage.getItem('matopibalog_logo_y')) || 0,
      ...overrides,
    };
    // Blindagem contra corrida: NUNCA enviar null/undefined ao backend. Um save
    // parcial disparado antes do GET /configuracoes terminar deixaria loginLogo/
    // loginBg em null e apagaria a config global no merge. Removemos esses campos
    // do payload — o backend então preserva o valor existente.
    // Remoção intencional de logo/imagem usa string vazia '' (passa pelo filtro):
    // ver botões "Remover", que enviam { loginLogo: '' } / { loginBg: '' }.
    const payload: Record<string, any> = {};
    for (const [chave, valor] of Object.entries(dados)) {
      if (valor !== null && valor !== undefined) payload[chave] = valor;
    }
    writeToLS(payload); // dispara evento para Login.tsx atualizar em tempo real
    try {
      await api.put('/configuracoes', payload);
    } catch (err) {
      console.error('Erro ao sincronizar com servidor:', err);
    }
  };

  const showSavedFeedback = () => {
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 3000);
  };

  const handleSaveSistema = async () => {
    // PUT /configuracoes exige super-admin no backend; a aba só aparece para super-admin.
    try { await api.put('/configuracoes', sistema); } catch (err) { console.error('Erro ao salvar Config. Sistema:', err); }
    setSistemaSalvo(true);
    setTimeout(() => setSistemaSalvo(false), 3000);
  };

  const handleSaveCompany = async () => {
    if (!podeGerenciarEmpresa) return;
    localStorage.setItem(`${PREFIX}company`, JSON.stringify(company));
    try {
      await api.put('/configuracoes/empresa', company);
    } catch (err) {
      console.error('Erro ao salvar dados da empresa:', err);
    }
    showSavedFeedback();
  };

  const handleSavePerfil = async () => {
    try {
      await api.patch('/auth/me', {
        telefone: perfil.telefone,
        celular: perfil.celular,
        cep: perfil.cep,
        endereco: perfil.endereco,
        bairro: perfil.bairro,
        cidade: perfil.cidade,
      });
      setPerfilSalvo(true);
      setTimeout(() => setPerfilSalvo(false), 3000);
    } catch (err) {
      console.error('Erro ao salvar perfil:', err);
    }
  };

  // ── Logomarca da empresa (per-tenant) ──────────────────────────────────────
  const salvarLogoEmpresa = async (dataUrl: string) => {
    setLogoSalvando(true);
    setLogoErro('');
    try {
      // Merge no backend (updateEmpresaConfig): salva só a logomarca sem apagar os
      // dados da empresa. Escopo por empresa_id (multi-tenant).
      await api.put('/configuracoes/empresa', { logomarca: dataUrl });
      setEmpresaLogo(dataUrl);
      localStorage.setItem(EMPRESA_LOGO_KEY, dataUrl);
      notificarLogoEmpresa();
      setLogoSalvo(true);
      setTimeout(() => setLogoSalvo(false), 3000);
    } catch (err) {
      console.error('Erro ao salvar logomarca da empresa:', err);
      setLogoErro('Não foi possível salvar a logomarca. Tente novamente.');
    } finally {
      setLogoSalvando(false);
    }
  };

  const processarLogoEmpresa = (file: File) => {
    setLogoErro('');
    setLogoSalvo(false);
    if (!LOGO_TIPOS_ACEITOS.includes(file.type)) {
      setLogoErro('Formato inválido. Envie uma imagem PNG, JPEG ou WEBP.');
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogoErro('Imagem muito grande. Escolha um arquivo de até 1 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setLogoErro('Não foi possível ler a imagem. Tente outra.');
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (!dataUrl) { setLogoErro('Não foi possível ler a imagem. Tente outra.'); return; }
      salvarLogoEmpresa(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const removerLogoEmpresa = async () => {
    setLogoSalvando(true);
    setLogoErro('');
    try {
      // '' (não null) = remoção intencional; o merge do backend preserva os dados.
      await api.put('/configuracoes/empresa', { logomarca: '' });
      setEmpresaLogo(null);
      localStorage.removeItem(EMPRESA_LOGO_KEY);
      notificarLogoEmpresa();
      setLogoSalvo(true);
      setTimeout(() => setLogoSalvo(false), 3000);
    } catch (err) {
      console.error('Erro ao remover logomarca da empresa:', err);
      setLogoErro('Não foi possível remover a logomarca. Tente novamente.');
    } finally {
      setLogoSalvando(false);
    }
  };

  const processFile = (file: File, target: 'logo' | 'bg') => {
    if (!file.type.startsWith('image/')) {
      alert('Por favor, selecione uma imagem válida.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      setTempImg(event.target?.result as string);
      setTempScale(Number(localStorage.getItem(`${PREFIX}login_${target}_scale`)) || 100);
      setTempY(Number(localStorage.getItem(`${PREFIX}login_${target}_y`)) || 0);
      setEditingTarget(target);
    };
    reader.readAsDataURL(file);
  };

  const handleImageAreaClick = (target: 'logo' | 'bg') => {
    const current = target === 'logo' ? loginLogo : loginBg;
    if (current) {
      // Já tem imagem → abre modal de ajuste
      setTempImg(current);
      setTempScale(Number(localStorage.getItem(`${PREFIX}login_${target}_scale`)) || 100);
      setTempY(Number(localStorage.getItem(`${PREFIX}login_${target}_y`)) || 0);
      setEditingTarget(target);
    } else {
      // Sem imagem → abre seletor de arquivo diretamente
      if (target === 'logo') logoFileRef.current?.click();
      else bgFileRef.current?.click();
    }
  };

  const saveImageSettings = async () => {
    if (!editingTarget || !tempImg) return;
    const prefix = `${PREFIX}login_${editingTarget}`;
    localStorage.setItem(prefix, tempImg);
    localStorage.setItem(`${prefix}_scale`, tempScale.toString());
    localStorage.setItem(`${prefix}_y`, tempY.toString());
    if (editingTarget === 'logo') setLoginLogo(tempImg);
    else setLoginBg(tempImg);
    setEditingTarget(null);
    await syncConfigToServer();
  };

  const removeImage = async () => {
    if (!editingTarget) return;
    const prefix = `${PREFIX}login_${editingTarget}`;
    const campo = editingTarget === 'logo' ? 'loginLogo' : 'loginBg';
    localStorage.removeItem(prefix);
    localStorage.removeItem(`${prefix}_scale`);
    localStorage.removeItem(`${prefix}_y`);
    if (editingTarget === 'logo') setLoginLogo(null);
    else setLoginBg(null);
    setEditingTarget(null);
    // Remoção intencional: '' (não null) para passar pelo filtro e apagar no servidor
    await syncConfigToServer({ [campo]: '' });
  };

  const handleSaveFooter = async () => {
    localStorage.setItem(`${PREFIX}login_footer`, footerText);
    localStorage.setItem(`${PREFIX}contact_phone`, contactPhone);
    localStorage.setItem(`${PREFIX}contact_email`, contactEmail);
    localStorage.setItem(`${PREFIX}footer_color`, footerColor);
    localStorage.setItem(`${PREFIX}footer_opacity`, footerOpacity.toString());
    localStorage.setItem(`${PREFIX}footer_font_size`, footerFontSize.toString());
    localStorage.setItem(`${PREFIX}footer_bold`, footerBold.toString());
    localStorage.setItem(`${PREFIX}footer_font_family`, footerFontFamily);
    localStorage.setItem(`${PREFIX}footer_width`, footerWidth.toString());
    localStorage.setItem(`${PREFIX}input_bg`, inputBgColor);
    localStorage.setItem(`${PREFIX}input_border`, inputBorderColor);
    localStorage.setItem(`${PREFIX}card_opacity`, cardOpacity.toString());
    localStorage.setItem(`${PREFIX}card_offset_x`, cardOffsetX.toString());
    localStorage.setItem(`${PREFIX}card_offset_y`, cardOffsetY.toString());
    await syncConfigToServer();
    showSavedFeedback();
  };

  // Derivados para o preview
  const tmplPreview = LOGIN_TEMPLATES.find(t => t.id === selectedTemplate) || LOGIN_TEMPLATES[0];
  const footerTextColor = getContrastTextColor(footerColor);
  const footerPaddingHorizontal = Math.round(8 + (footerWidth - 20) * 52 / 80);
  const footerBgWithOpacity = footerColor + Math.round(footerOpacity * 2.55).toString(16).padStart(2, '0');
  const podeGerenciarEmpresa = user?.is_super_admin === true || governanca?.permissoes?.empresa !== false;
  // ERP/SSO só aparecem como opção quando o plano dá direito comercial (Growth+),
  // ou para super-admin. Start/Essencial (indisponivel) não veem as abas. O status
  // técnico segue 'em_breve' — visibilidade ≠ ativação.
  const erpComercial = governanca?.entitlements?.integracoes_erp?.disponibilidade_comercial;
  const ssoComercial = governanca?.entitlements?.acesso_corporativo_sso?.disponibilidade_comercial;
  const temDireitoComercial = (d?: string | null) =>
    user?.is_super_admin === true || (!!d && d !== 'indisponivel');
  const tabs = [
    { id: 'perfil', label: 'Meu perfil', icon: UserCircle, show: true },
    { id: 'empresa', label: 'Empresa', icon: Building2, show: true },
    { id: 'estrutura', label: 'Estrutura Operacional', icon: Network, show: governanca?.entitlements?.estrutura_operacional?.permitido === true || user?.is_super_admin },
    { id: 'erp', label: 'ERP', icon: Plug, show: temDireitoComercial(erpComercial) },
    { id: 'sso', label: 'SSO', icon: ShieldCheck, show: temDireitoComercial(ssoComercial) },
    { id: 'sistema', label: 'Sistema', icon: Settings, show: user?.is_super_admin },
    { id: 'aparencia', label: 'Aparência', icon: Palette, show: user?.is_super_admin },
  ] as const;
  // Copy honesta por direito comercial (nunca "Conectado/Ativar"): o conector
  // técnico está em preparação (status em_breve).
  const copyEmPreparacao = (d?: string | null) =>
    d === 'incluida' ? 'Incluído no seu plano — integração em preparação.'
      : d === 'opcional_paga' ? 'Disponível como adicional — integração em preparação.'
      : d === 'sob_negociacao' ? 'Sob proposta — integração assistida em preparação.'
      : 'Integração em preparação.';

  return (
    <div className="space-y-6 pb-20">
      {/* Inputs de arquivo ocultos */}
      <input ref={logoFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f, 'logo'); e.target.value = ''; }} />
      <input ref={bgFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f, 'bg'); e.target.value = ''; }} />

      <div className="flex items-center gap-3">
        <div className="bg-green-700 p-2.5 rounded-xl text-white shadow-sm shadow-green-100">
          <Settings size={24} />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Configurações</h2>
          <p className="text-gray-600 text-sm">
            Mantenha os dados da sua empresa ou conta atualizados — eles são usados nos relatórios e PDFs.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 bg-gray-100 p-1 rounded-xl w-full">
        {tabs
          .filter((tab) => tab.show)
          .map((tab) => {
            const Icon = tab.icon;
            return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 min-w-[130px] flex items-center justify-center whitespace-nowrap px-4 py-2.5 rounded-lg font-bold text-sm transition-all ${activeTab === tab.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Icon size={18} className="mr-2 shrink-0" />{tab.label}
          </button>
            );
          })}
      </div>

      {activeTab === 'perfil' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 max-w-3xl space-y-5">
          <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-100 text-blue-800 rounded-xl p-3.5 text-sm">
            <UserCircle size={18} className="mt-0.5 flex-shrink-0" />
            <span>Dados pessoais da sua conta. E-mail e nome principal seguem a identidade de login e não são alterados aqui.</span>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <InfoPerfil label="Nome" value={perfil.nome} />
            <InfoPerfil label="E-mail" value={perfil.email} />
            <CampoPerfil label="Telefone" value={perfil.telefone} onChange={(v) => setPerfil({ ...perfil, telefone: maskPhone(v) })} />
            <CampoPerfil label="Celular" value={perfil.celular} onChange={(v) => setPerfil({ ...perfil, celular: maskPhone(v) })} />
            <CampoPerfil label="CEP" value={perfil.cep} onChange={(v) => setPerfil({ ...perfil, cep: maskCEP(v) })} />
            <CampoPerfil label="Cidade" value={perfil.cidade} onChange={(v) => setPerfil({ ...perfil, cidade: v })} />
            <CampoPerfil label="Endereço" value={perfil.endereco} onChange={(v) => setPerfil({ ...perfil, endereco: v })} className="md:col-span-2" />
            <CampoPerfil label="Bairro" value={perfil.bairro} onChange={(v) => setPerfil({ ...perfil, bairro: v })} />
          </div>
          <button onClick={handleSavePerfil} className="inline-flex items-center px-4 py-2.5 bg-green-700 text-white rounded-xl font-medium text-sm hover:bg-green-800 transition-all">
            {perfilSalvo ? <Check size={18} className="mr-2" /> : <Save size={18} className="mr-2" />}
            {perfilSalvo ? 'Salvo!' : 'Salvar perfil'}
          </button>
        </div>
      )}

      {/* ── ABA EMPRESA ── */}
      {activeTab === 'empresa' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
          {!podeGerenciarEmpresa && (
            <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3.5 text-sm">
              <ShieldCheck size={18} className="mt-0.5 flex-shrink-0" />
              <span>Seu perfil pode consultar os dados da empresa, mas não possui permissão para alterá-los.</span>
            </div>
          )}
          <div className="flex items-start gap-2.5 bg-green-50 border border-green-100 text-green-800 rounded-xl p-3.5 text-sm">
            <FileText size={18} className="mt-0.5 flex-shrink-0" />
            <span>Esses dados serão usados nos relatórios e PDFs da sua empresa ou conta. Mantenha-os corretos e completos.</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              {[
                { label: 'Razão Social / Nome', field: 'nome', placeholder: 'Nome da empresa ou do transportador', type: 'text' },
                { label: 'CNPJ', field: 'cnpj', placeholder: '00.000.000/0000-00', type: 'text', mask: maskCNPJ },
                { label: 'Telefone de Contato', field: 'telefone', placeholder: '(00) 0 0000-0000', type: 'text', mask: maskPhone },
                { label: 'Email Corporativo', field: 'email', placeholder: 'contato@empresa.com', type: 'email' },
              ].map(({ label, field, placeholder, type, mask }) => (
                <div key={field}>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">{label}</label>
                  <input
                    type={type}
                    className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-green-700 bg-gray-50/50"
                    value={(company as any)[field]}
                    onChange={(e) => setCompany({ ...company, [field]: mask ? mask(e.target.value) : e.target.value })}
                    placeholder={placeholder}
                  />
                </div>
              ))}
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Endereço</label>
                  <input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-green-700 bg-gray-50/50" value={company.endereco} onChange={(e) => setCompany({ ...company, endereco: e.target.value })} placeholder="Av. Brasil, 1000 - Centro" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">CEP</label>
                  <input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-green-700 bg-gray-50/50" value={company.cep} onChange={(e) => setCompany({ ...company, cep: maskCEP(e.target.value) })} placeholder="00000-000" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Complemento</label>
                  <input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-green-700 bg-gray-50/50" value={company.complemento} onChange={(e) => setCompany({ ...company, complemento: e.target.value })} placeholder="Sala 201" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Ponto de Referência</label>
                  <input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-green-700 bg-gray-50/50" value={company.pontoReferencia} onChange={(e) => setCompany({ ...company, pontoReferencia: e.target.value })} placeholder="Próximo a..." />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Cidade</label>
                  <input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-green-700 bg-gray-50/50" value={company.cidade} onChange={(e) => setCompany({ ...company, cidade: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Estado (UF)</label>
                  <input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-green-700 bg-gray-50/50" value={company.estado} maxLength={2} onChange={(e) => setCompany({ ...company, estado: e.target.value.toUpperCase() })} placeholder="BA" />
                </div>
              </div>
            </div>
          </div>
          {/* ── Logomarca da empresa (per-tenant) ── */}
          <div className="pt-4 border-t border-gray-50">
            <div className="flex items-center gap-2 mb-1">
              <Image size={16} className="text-gray-500" />
              <label className="text-sm font-bold text-gray-700">Logomarca da empresa</label>
            </div>
            <p className="text-xs text-gray-500 mb-3 ml-1">
              Esta logomarca será usada no painel e nos relatórios/PDFs da sua empresa. PNG, JPEG ou WEBP, até 1&nbsp;MB.
            </p>
            <input
              ref={empresaLogoFileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) processarLogoEmpresa(f); e.target.value = ''; }}
            />
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="w-40 h-24 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/50 flex items-center justify-center overflow-hidden flex-shrink-0">
                {empresaLogo ? (
                  <img src={empresaLogo} alt="Logomarca da empresa" className="max-w-full max-h-full object-contain p-2" />
                ) : (
                  <div className="text-center text-gray-400">
                    <Image size={24} className="mx-auto mb-1" />
                    <p className="text-[11px] font-medium">Sem logomarca</p>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => empresaLogoFileRef.current?.click()}
                    disabled={logoSalvando}
                    className="inline-flex items-center px-4 py-2 bg-green-700 text-white rounded-xl font-medium text-sm hover:bg-green-800 disabled:opacity-50 transition-all active:scale-95"
                  >
                    {logoSalvando ? (
                      <><span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />Salvando...</>
                    ) : (
                      <><Upload size={16} className="mr-2" />{empresaLogo ? 'Alterar logomarca' : 'Enviar logomarca'}</>
                    )}
                  </button>
                  {empresaLogo && (
                    <button
                      type="button"
                      onClick={removerLogoEmpresa}
                      disabled={logoSalvando}
                      className="inline-flex items-center px-4 py-2 bg-red-50 text-red-600 rounded-xl font-medium text-sm hover:bg-red-100 disabled:opacity-50 transition-colors"
                    >
                      <Trash2 size={16} className="mr-2" />Remover
                    </button>
                  )}
                </div>
                {logoErro && <p className="text-xs text-red-600 flex items-center gap-1"><X size={13} /> {logoErro}</p>}
                {logoSalvo && !logoErro && <p className="text-xs text-green-600 flex items-center gap-1"><Check size={13} /> Logomarca salva!</p>}
                {!empresaLogo && !logoErro && !logoSalvo && (
                  <p className="text-xs text-gray-400">Sem logomarca própria, os relatórios usam o padrão profissional do sistema.</p>
                )}
              </div>
            </div>
          </div>

          {/* Código de convite para motoristas */}
          <div className="pt-4 border-t border-gray-50">
            <label className="block text-xs font-bold text-gray-400 uppercase mb-2 ml-1">
              Código de convite para motoristas
            </label>
            <p className="text-xs text-gray-500 mb-3 ml-1">
              Compartilhe este código com seus motoristas para que se cadastrem vinculados à sua empresa.
            </p>
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-gray-50 border-2 border-gray-100 rounded-xl px-4 py-3 font-mono text-lg font-bold tracking-widest text-gray-800 select-all">
                {codigoConvite ?? '—'}
              </div>
              <BotaoCopiarCodigo codigo={codigoConvite} />
              <button
                onClick={handleRegenarCodigo}
                disabled={regenerandoCodigo}
                className="px-4 py-3 bg-orange-50 hover:bg-orange-100 text-orange-700 rounded-xl font-medium text-sm transition-colors disabled:opacity-40"
              >
                {regenerandoCodigo ? 'Gerando...' : 'Regenerar'}
              </button>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-gray-50">
            <button disabled={!podeGerenciarEmpresa} onClick={handleSaveCompany} className="inline-flex items-center px-4 py-2.5 bg-green-700 text-white rounded-xl font-medium text-sm shadow-sm hover:bg-green-800 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
              {showSaved ? <Check size={18} className="mr-2" /> : <Save size={18} className="mr-2" />}
              {showSaved ? 'Salvo!' : 'Salvar Configurações'}
            </button>
          </div>
        </div>
      )}

      {activeTab === 'estrutura' && (
        <GovernancePanel
          icon={<Network size={20} />}
          title="Estrutura Operacional"
          tone={governanca?.entitlements?.estrutura_operacional?.permitido ? 'green' : 'amber'}
          text={governanca?.entitlements?.estrutura_operacional?.permitido
            ? 'Recurso liberado para organizar unidades, regiões e responsabilidades operacionais.'
            : 'Este recurso depende do plano ou de adicional ativo.'}
          actionHref={governanca?.entitlements?.estrutura_operacional?.permitido ? '/operacional' : undefined}
          actionLabel={governanca?.entitlements?.estrutura_operacional?.permitido ? 'Abrir estrutura' : undefined}
        />
      )}

      {activeTab === 'erp' && (
        <GovernancePanel
          icon={<Plug size={20} />}
          title="Integrações ERP"
          tone="blue"
          badge="Em breve"
          text={`${copyEmPreparacao(erpComercial)} A configuração da integração não é feita nesta tela e nenhuma credencial (chave de API, senha ou token) é solicitada aqui — isso será feito por operação técnica segura quando o conector for liberado.`}
        />
      )}

      {activeTab === 'sso' && (
        <GovernancePanel
          icon={<ShieldCheck size={20} />}
          title="Acesso corporativo (SSO)"
          tone="blue"
          badge="Em breve"
          text={`${copyEmPreparacao(ssoComercial)} O acesso corporativo por provedor de identidade (Microsoft Entra ID / Active Directory via OIDC ou SAML) está em preparação: nenhuma senha de domínio é solicitada aqui e não há ativação de SSO nesta tela — a configuração será assistida por operação técnica segura, preservando o acesso administrativo (break-glass).`}
        />
      )}

      {/* ── ABA SISTEMA (super-admin) ── */}
      {activeTab === 'sistema' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 max-w-2xl space-y-4">
          <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-100 text-blue-800 rounded-xl p-3.5 text-sm">
            <Settings size={18} className="mt-0.5 flex-shrink-0" />
            <span>Parâmetros globais da plataforma. Aplicam-se a todas as contas.</span>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Nome do Sistema</label>
            <input type="text" className="w-full border-2 border-gray-50 rounded-xl p-2.5 outline-none focus:border-green-700 bg-gray-50/50" value={sistema.nome_sistema} onChange={e => setSistema({ ...sistema, nome_sistema: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">E-mail de Suporte</label>
            <input type="email" className="w-full border-2 border-gray-50 rounded-xl p-2.5 outline-none focus:border-green-700 bg-gray-50/50" value={sistema.email_suporte} onChange={e => setSistema({ ...sistema, email_suporte: e.target.value })} />
            <p className="text-xs text-gray-400 mt-1 ml-1">Exibido no caminho de regularização (contato de suporte para autônomos).</p>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">WhatsApp de Suporte</label>
            <input type="tel" placeholder="Ex.: 5599999999999 (com DDI e DDD)" className="w-full border-2 border-gray-50 rounded-xl p-2.5 outline-none focus:border-green-700 bg-gray-50/50" value={sistema.whatsapp_suporte} onChange={e => setSistema({ ...sistema, whatsapp_suporte: e.target.value })} />
            <p className="text-xs text-gray-400 mt-1 ml-1">Número usado no botão de WhatsApp do app durante a regularização. Vazio = não exibir.</p>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Telefone de Suporte</label>
            <input type="tel" placeholder="Ex.: (99) 99999-9999" className="w-full border-2 border-gray-50 rounded-xl p-2.5 outline-none focus:border-green-700 bg-gray-50/50" value={sistema.telefone_suporte} onChange={e => setSistema({ ...sistema, telefone_suporte: e.target.value })} />
            <p className="text-xs text-gray-400 mt-1 ml-1">Telefone alternativo exibido ao cliente. Se vazio, o app usa o telefone de contato da aparência do login, quando houver.</p>
          </div>
          {/* Recursos ainda sem efeito no servidor — marcados como "Em preparação" para não confundir. */}
          {[
            { label: 'Modo Manutenção', desc: 'Bloquear o acesso durante manutenções.' },
            { label: 'Registros Abertos', desc: 'Permitir novos cadastros públicos.' },
          ].map(t => (
            <div key={t.label} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl opacity-80">
              <div>
                <span className="text-sm font-medium text-gray-700">{t.label}</span>
                <p className="text-xs text-gray-400">{t.desc}</p>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 px-2 py-1 rounded-full flex-shrink-0 ml-3">Em preparação</span>
            </div>
          ))}
          <div className="pt-2">
            <button onClick={handleSaveSistema} className={`flex items-center px-5 py-2.5 rounded-xl font-bold text-sm transition-all ${sistemaSalvo ? 'bg-green-600 text-white' : 'bg-green-700 text-white hover:bg-green-800'}`}>
              {sistemaSalvo ? <Check size={18} className="mr-2" /> : <Save size={18} className="mr-2" />}
              {sistemaSalvo ? 'Salvo!' : 'Salvar Sistema'}
            </button>
          </div>
        </div>
      )}

      {/* ── ABA APARÊNCIA ── */}
      {activeTab === 'aparencia' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
          <h3 className="text-lg font-bold text-gray-800 flex items-center"><Palette size={20} className="mr-2" /> Personalizar Tela de Login</h3>

          {/* Upload de imagens */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {(['logo', 'bg'] as const).map((target) => {
              const current = target === 'logo' ? loginLogo : loginBg;
              const label = target === 'logo' ? 'Logomarca' : 'Imagem de Fundo';
              return (
                <div key={target}>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">{label} da Página de Login</label>
                  <div
                    onClick={() => handleImageAreaClick(target)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) processFile(f, target); }}
                    className="relative w-full h-40 border-2 border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-green-500 hover:bg-green-50/30 transition-all overflow-hidden"
                  >
                    {current ? (
                      <img src={current} alt={label} className={target === 'logo' ? 'max-w-full max-h-full object-contain p-4' : 'w-full h-full object-cover'} />
                    ) : (
                      <div className="text-center text-gray-400 pointer-events-none">
                        <Upload size={32} className="mx-auto mb-2" />
                        <p className="text-sm font-medium">Clique para adicionar</p>
                        <p className="text-xs">ou arraste uma imagem</p>
                      </div>
                    )}
                  </div>
                  {current && (
                    <div className="flex space-x-2 mt-2">
                      <button onClick={() => handleImageAreaClick(target)} className="text-xs px-3 py-1.5 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 font-medium transition-colors">
                        <Image size={14} className="inline mr-1" />Ajustar
                      </button>
                      <button onClick={async () => {
                        localStorage.removeItem(`${PREFIX}login_${target}`);
                        localStorage.removeItem(`${PREFIX}login_${target}_scale`);
                        localStorage.removeItem(`${PREFIX}login_${target}_y`);
                        if (target === 'logo') setLoginLogo(null); else setLoginBg(null);
                        // Remoção intencional: '' (não null) para apagar no servidor
                        await syncConfigToServer({ [target === 'logo' ? 'loginLogo' : 'loginBg']: '' });
                      }} className="text-xs px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 font-medium transition-colors">
                        <Trash2 size={14} className="inline mr-1" />Remover
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Preview em tempo real */}
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Pré-visualização em tempo real</label>
            <div style={{
              height: '420px',
              background: loginBg ? `url(${loginBg}) center/cover no-repeat` : '#1a1a2e',
              borderRadius: '12px',
              border: '1px solid #e5e7eb',
              overflow: 'hidden',
              position: 'relative',
            }}>
              {/* Card */}
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: tmplPreview.cardPosition === 'left' ? 'flex-start' : 'center',
                padding: '16px',
              }}>
                <div style={{
                  backgroundColor: `color-mix(in srgb, ${tmplPreview.cardBackground} ${cardOpacity}%, transparent)`,
                  width: '100%',
                  maxWidth: `${Math.round(tmplPreview.cardWidth * 0.72)}px`,
                  borderRadius: tmplPreview.cardBorderRadius,
                  boxShadow: tmplPreview.cardShadow,
                  border: tmplPreview.cardBorder,
                  padding: '20px',
                  margin: tmplPreview.cardPosition === 'left' ? `${cardOffsetY}px 0 0 ${48 + cardOffsetX}px` : `${cardOffsetY}px auto 0`,
                  boxSizing: 'border-box',
                  transition: 'all 0.2s',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
                    {loginLogo ? (
                      <img src={loginLogo} alt="Logo" style={{ maxHeight: '48px', objectFit: 'contain' }} />
                    ) : (
                      <div style={{ background: tmplPreview.buttonColor, padding: '8px', borderRadius: '50%', display: 'flex' }}>
                        <Truck size={20} color="#fff" />
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {['E-mail', 'Senha'].map((lbl) => (
                      <div key={lbl}>
                        <div style={{ fontSize: `${Math.round(tmplPreview.fontSize * 0.85)}px`, color: tmplPreview.fontColor, fontWeight: '500', marginBottom: '4px' }}>{lbl}</div>
                        <div style={{ height: '32px', borderRadius: '6px', border: `2px solid ${inputBorderColor}`, background: inputBgColor }} />
                      </div>
                    ))}
                    <div style={{ height: '32px', background: tmplPreview.buttonColor, borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ color: '#fff', fontSize: `${Math.round(tmplPreview.fontSize * 0.85)}px`, fontWeight: '600' }}>Entrar</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Rodapé do preview */}
              {(contactPhone || contactEmail || footerText) && (
                <div style={{
                  position: 'absolute',
                  bottom: '10px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 'fit-content',
                  maxWidth: '90%',
                  background: footerBgWithOpacity,
                  borderRadius: '8px',
                  padding: `8px ${footerPaddingHorizontal}px`,
                  textAlign: 'center',
                }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    gap: '10px', flexWrap: 'nowrap',
                    fontSize: `${footerFontSize}px`,
                    fontWeight: footerBold ? 'bold' : 'normal',
                    fontFamily: footerFontFamily,
                    color: footerTextColor,
                  }}>
                    {contactPhone && <span style={{ whiteSpace: 'nowrap' }}>{contactPhone}</span>}
                    {contactEmail && <span style={{ whiteSpace: 'nowrap' }}>{contactEmail}</span>}
                    {footerText && <span style={{ whiteSpace: 'nowrap' }}>{footerText}</span>}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Templates */}
          <div className="border-t border-gray-100 pt-6">
            <label className="block text-xs font-bold text-gray-400 uppercase mb-3 ml-1">Template do Card de Login</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {LOGIN_TEMPLATES.map(template => (
                <div
                  key={template.id}
                  onClick={() => {
                    setSelectedTemplate(template.id);
                    localStorage.setItem(`${PREFIX}login_template`, template.id);
                    syncConfigToServer();
                  }}
                  className={`cursor-pointer rounded-xl p-4 border-2 transition-all text-center ${selectedTemplate === template.id ? 'border-green-600 bg-green-50 shadow-md' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                >
                  <div style={{
                    width: '60px', height: '80px', margin: '0 auto 8px',
                    borderRadius: template.cardBorderRadius,
                    background: template.cardBackground,
                    boxShadow: template.cardShadow,
                    border: template.cardBorder,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '10px', color: template.fontColor,
                  }}>Login</div>
                  <p className="font-bold text-sm text-gray-800">{template.nome}</p>
                  <p className="text-xs text-gray-500 mt-1">{template.descricao}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Posição do card */}
          <div className="border-t border-gray-100 pt-6">
            <label className="block text-xs font-bold text-gray-400 uppercase mb-3 ml-1 flex items-center gap-2">
              <Move size={14} /> Posição do Card
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium text-gray-700">Deslocamento Horizontal (X)</span>
                  <span className="text-gray-500">{cardOffsetX}px</span>
                </div>
                <input type="range" min="-200" max="200" value={cardOffsetX} onChange={e => { const v = Number(e.target.value); setCardOffsetX(v); localStorage.setItem(`${PREFIX}card_offset_x`, v.toString()); }} className="w-full accent-green-700" />
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium text-gray-700">Deslocamento Vertical (Y)</span>
                  <span className="text-gray-500">{cardOffsetY}px</span>
                </div>
                <input type="range" min="-150" max="150" value={cardOffsetY} onChange={e => { const v = Number(e.target.value); setCardOffsetY(v); localStorage.setItem(`${PREFIX}card_offset_y`, v.toString()); }} className="w-full accent-green-700" />
              </div>
            </div>
          </div>

          {/* Card */}
          <div className="border-t border-gray-100 pt-6">
            <label className="block text-xs font-bold text-gray-400 uppercase mb-3 ml-1">Aparência do Card</label>
            <div className="max-w-xl">
              <div className="flex justify-between text-sm mb-1"><span className="font-medium text-gray-700">Opacidade do card</span><span className="text-gray-500">{cardOpacity}%</span></div>
              <p className="text-xs text-gray-500 mb-2">Ajusta somente o fundo do card; campos, textos e tamanho permanecem inalterados.</p>
              <input type="range" min="20" max="100" value={cardOpacity} onChange={e => { const v = Number(e.target.value); setCardOpacity(v); localStorage.setItem(`${PREFIX}card_opacity`, v.toString()); }} className="w-full accent-green-700" />
            </div>
          </div>

          {/* Campos */}
          <div className="border-t border-gray-100 pt-6">
            <label className="block text-xs font-bold text-gray-400 uppercase mb-3 ml-1">Aparência dos Campos</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="flex justify-between text-sm mb-1"><span className="font-medium text-gray-700">Cor de Fundo</span></div>
                <div className="flex items-center space-x-3">
                  <input type="color" value={inputBgColor} onChange={e => { setInputBgColor(e.target.value); localStorage.setItem(`${PREFIX}input_bg`, e.target.value); }} className="w-12 h-12 rounded-lg border border-gray-200 cursor-pointer" />
                  <span className="text-sm text-gray-500 font-mono">{inputBgColor}</span>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1"><span className="font-medium text-gray-700">Cor da Borda</span></div>
                <div className="flex items-center space-x-3">
                  <input type="color" value={inputBorderColor} onChange={e => { setInputBorderColor(e.target.value); localStorage.setItem(`${PREFIX}input_border`, e.target.value); }} className="w-12 h-12 rounded-lg border border-gray-200 cursor-pointer" />
                  <span className="text-sm text-gray-500 font-mono">{inputBorderColor}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Rodapé */}
          <div className="border-t border-gray-100 pt-6 space-y-6">
            <label className="block text-xs font-bold text-gray-400 uppercase mb-3 ml-1">Rodapé da Tela de Login</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="flex justify-between text-sm mb-2"><span className="font-medium text-gray-700">Cor do Fundo</span></div>
                <div className="flex items-center space-x-3">
                  <input type="color" value={footerColor} onChange={e => { setFooterColor(e.target.value); localStorage.setItem(`${PREFIX}footer_color`, e.target.value); }} className="w-12 h-12 rounded-lg border border-gray-200 cursor-pointer" />
                  <span className="text-sm text-gray-500 font-mono">{footerColor}</span>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1"><span className="font-medium text-gray-700">Transparência</span><span className="text-gray-500">{footerOpacity}%</span></div>
                <input type="range" min="0" max="100" value={footerOpacity} onChange={e => { const v = Number(e.target.value); setFooterOpacity(v); localStorage.setItem(`${PREFIX}footer_opacity`, v.toString()); }} className="w-full accent-green-700" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <div className="flex justify-between text-sm mb-1"><span className="font-medium text-gray-700">Tamanho da Fonte</span><span className="text-gray-500">{footerFontSize}px</span></div>
                <input type="range" min="10" max="24" value={footerFontSize} onChange={e => { const v = Number(e.target.value); setFooterFontSize(v); localStorage.setItem(`${PREFIX}footer_font_size`, v.toString()); }} className="w-full accent-green-700" />
              </div>
              <div>
                <div className="text-sm mb-1"><span className="font-medium text-gray-700">Fonte</span></div>
                <select value={footerFontFamily} onChange={e => { setFooterFontFamily(e.target.value); localStorage.setItem(`${PREFIX}footer_font_family`, e.target.value); }} className="w-full border-2 border-gray-50 rounded-xl p-2.5 outline-none focus:border-green-700 bg-gray-50/50 text-sm">
                  {['Arial', 'Times New Roman', 'Georgia', 'Verdana', 'Courier New'].map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <div className="text-sm mb-1"><span className="font-medium text-gray-700">Negrito</span></div>
                <button onClick={() => { const v = !footerBold; setFooterBold(v); localStorage.setItem(`${PREFIX}footer_bold`, v.toString()); }}
                  style={{ width: '100%', padding: '10px', borderRadius: '12px', border: footerBold ? '2px solid #15803d' : '2px solid #e5e7eb', background: footerBold ? '#f0fdf4' : '#f9fafb', fontWeight: footerBold ? 'bold' : 'normal', color: footerBold ? '#15803d' : '#6b7280', cursor: 'pointer', fontSize: '14px' }}>
                  {footerBold ? '✓ Negrito' : 'Normal'}
                </button>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-sm mb-1"><span className="font-medium text-gray-700">Respiro do Rodapé</span><span className="text-gray-500">{footerWidth}</span></div>
              <p className="text-xs text-gray-500 mb-2">Controla o espaço entre o texto e a borda do rodapé.</p>
              <input type="range" min="20" max="100" value={footerWidth} onChange={e => { const v = Number(e.target.value); setFooterWidth(v); localStorage.setItem(`${PREFIX}footer_width`, v.toString()); }} className="w-full accent-green-700" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
                <input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-green-700 bg-gray-50/50" placeholder="(11) 99999-9999" value={contactPhone} onChange={e => { setContactPhone(e.target.value); localStorage.setItem(`${PREFIX}contact_phone`, e.target.value); }} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
                <input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-green-700 bg-gray-50/50" placeholder="contato@transportadora.com" value={contactEmail} onChange={e => { setContactEmail(e.target.value); localStorage.setItem(`${PREFIX}contact_email`, e.target.value); }} />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Texto do Rodapé</label>
              <input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-green-700 bg-gray-50/50" placeholder="© 2026 Minha Transportadora. Todos os direitos reservados." value={footerText} onChange={e => { setFooterText(e.target.value); localStorage.setItem(`${PREFIX}login_footer`, e.target.value); }} />
            </div>

            <button onClick={handleSaveFooter} className={`inline-flex items-center px-4 py-2.5 rounded-xl font-medium text-sm shadow-sm transition-all ${showSaved ? 'bg-green-600 text-white' : 'bg-green-700 text-white hover:bg-green-800'}`}>
              {showSaved ? <Check size={18} className="mr-2" /> : <Save size={18} className="mr-2" />}
              {showSaved ? 'Salvo!' : 'Salvar Aparência'}
            </button>
          </div>
        </div>
      )}

      {/* Modal de ajuste de imagem */}
      {editingTarget && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) setEditingTarget(null); }}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden text-gray-800">
            <div className="flex justify-between items-center p-4 border-b border-gray-100">
              <h3 className="font-bold text-lg">Ajustar {editingTarget === 'logo' ? 'Logomarca' : 'Imagem de Fundo'}</h3>
              <button onClick={() => setEditingTarget(null)} className="p-1 hover:bg-gray-100 rounded"><X size={20} className="text-gray-500" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-gray-100 rounded-lg w-full h-48 flex items-center justify-center overflow-hidden border-2 border-dashed border-gray-300">
                {tempImg ? (
                  <img src={tempImg} alt="Preview" style={{ transform: `scale(${tempScale / 100}) translateY(${tempY}px)`, transformOrigin: 'center' }} className={editingTarget === 'logo' ? 'max-w-full max-h-full object-contain' : 'w-full h-full object-cover'} />
                ) : (
                  <div className="text-center text-gray-400"><Upload size={32} className="mx-auto mb-2" /><p className="text-sm">Selecione uma imagem</p></div>
                )}
              </div>

              {tempImg && (
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-sm mb-1"><span className="font-medium text-gray-700">Escala</span><span className="text-gray-500">{tempScale}%</span></div>
                    <input type="range" min="10" max="200" value={tempScale} onChange={e => setTempScale(Number(e.target.value))} className="w-full accent-green-700" />
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1"><span className="font-medium text-gray-700">Posição vertical</span><span className="text-gray-500">{tempY}px</span></div>
                    <input type="range" min="-100" max="100" value={tempY} onChange={e => setTempY(Number(e.target.value))} className="w-full accent-green-700" />
                  </div>
                </div>
              )}

              <input type="file" accept="image/*" className="hidden" id="modalFileInput" onChange={(e) => { const file = e.target.files?.[0]; if (file && editingTarget) processFile(file, editingTarget); e.target.value = ''; }} />
              <button onClick={() => document.getElementById('modalFileInput')?.click()} className="w-full px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-green-500 hover:text-green-700 transition-colors text-sm font-medium">
                <Upload size={16} className="inline mr-1" /> Selecionar outra imagem
              </button>
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-between items-center">
              <button onClick={removeImage} className="flex items-center space-x-2 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors text-sm font-medium">
                <Trash2 size={16} /><span>Excluir imagem</span>
              </button>
              <div className="flex space-x-2">
                <button onClick={() => setEditingTarget(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors text-sm font-medium">Cancelar</button>
                <button onClick={saveImageSettings} disabled={!tempImg} className="flex items-center space-x-2 px-4 py-2 bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white rounded-lg transition-colors text-sm font-medium">
                  <Check size={16} /><span>Salvar</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

function InfoPerfil({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">{label}</label>
      <div className="w-full border-2 border-gray-50 rounded-xl p-3 bg-gray-50/70 text-gray-600 min-h-[50px]">
        {value || '—'}
      </div>
    </div>
  );
}

function CampoPerfil({ label, value, onChange, className = '' }: { label: string; value: string; onChange: (value: string) => void; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">{label}</label>
      <input
        type="text"
        className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-green-700 bg-gray-50/50"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function GovernancePanel({
  icon,
  title,
  text,
  tone,
  actionHref,
  actionLabel,
  badge,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  tone: 'green' | 'blue' | 'amber';
  actionHref?: string;
  actionLabel?: string;
  badge?: string;
}) {
  const toneClass = tone === 'green'
    ? 'bg-green-50 border-green-200 text-green-800'
    : tone === 'blue'
      ? 'bg-blue-50 border-blue-200 text-blue-800'
      : 'bg-amber-50 border-amber-200 text-amber-800';
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 max-w-3xl space-y-5">
      <div className={`flex items-start gap-3 rounded-xl border p-4 ${toneClass}`}>
        <div className="mt-0.5 flex-shrink-0">{icon}</div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold">{title}</h3>
            {badge && (
              <span className="inline-flex items-center rounded-full bg-white/70 border border-current px-2 py-0.5 text-xs font-semibold">
                {badge}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm">{text}</p>
        </div>
      </div>
      {actionHref && actionLabel && (
        <Link to={actionHref} className="inline-flex items-center px-4 py-2.5 bg-green-700 text-white rounded-xl font-medium text-sm hover:bg-green-800 transition-all">
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
