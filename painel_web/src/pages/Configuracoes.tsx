import React, { useState, useEffect, useRef } from 'react';
import {
  Settings, Building2, Printer, Save, Check, Image,
  Palette, X, Upload, Trash2, Truck, Search, Plus, Move
} from 'lucide-react';
import { maskPhone, maskCNPJ, maskCEP } from '../utils/masks';
import api from '../api';
import { writeToLS } from '../hooks/useLoginConfig';
import { useAuth } from '../contexts/AuthContext';

const PREFIX = 'matopibalog_';

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

interface PrinterData {
  id: string; nome: string; tipo: string;
  status: 'online' | 'offline'; localizacao?: string; data_instalacao?: string;
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
  const [activeTab, setActiveTab] = useState<'empresa' | 'impressora' | 'aparencia'>('empresa');
  const { user } = useAuth();
  const [codigoConvite, setCodigoConvite] = useState<string | null>(null);
  const [regenerandoCodigo, setRegenerandoCodigo] = useState(false);
  const [company, setCompany] = useState<CompanyData>({
    nome: '', cnpj: '', endereco: '', cep: '',
    complemento: '', pontoReferencia: '', cidade: '', estado: '', telefone: '', email: '',
  });

  const [printers, setPrinters] = useState<PrinterData[]>([]);
  const [showPrinterSearch, setShowPrinterSearch] = useState(false);
  const [foundPrinters, setFoundPrinters] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [testingPrinter, setTestingPrinter] = useState<string | null>(null);
  const [showSaved, setShowSaved] = useState(false);

  // Estados de aparência — inicializados do localStorage diretamente
  const [loginLogo, setLoginLogo] = useState<string | null>(() => localStorage.getItem(`${PREFIX}login_logo`) || null);
  const [loginBg, setLoginBg] = useState<string | null>(() => localStorage.getItem(`${PREFIX}login_bg`) || null);
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

  // Carrega dados da empresa e impressoras do localStorage
  useEffect(() => {
    const savedCompany = localStorage.getItem(`${PREFIX}company`);
    if (savedCompany) {
      try { setCompany(JSON.parse(savedCompany)); } catch { }
    }
    const savedPrinters = localStorage.getItem(`${PREFIX}printers`);
    if (savedPrinters) {
      try { setPrinters(JSON.parse(savedPrinters)); } catch { }
    }
  }, []);

  // Busca configurações do servidor e aplica nos estados
  useEffect(() => {
    api.get('/configuracoes')
      .then((response) => {
        const d = response.data;
        if (!d) return;
        if (d.printers) setPrinters(d.printers);
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
        if (d.loginTemplate) setSelectedTemplate(d.loginTemplate);
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
          setCompany(response.data);
          localStorage.setItem(`${PREFIX}company`, JSON.stringify(response.data));
        } else {
          // API retornou vazio: limpa cache antigo para não vazar dados de outra conta
          localStorage.removeItem(`${PREFIX}company`);
        }
      })
      .catch(() => { });
  }, []);

  const syncConfigToServer = async (overrides: Record<string, any> = {}) => {
    const dados: Record<string, any> = {
      company,
      printers,
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

  const handleSaveCompany = async () => {
    localStorage.setItem(`${PREFIX}company`, JSON.stringify(company));
    try {
      await api.put('/configuracoes/empresa', company);
    } catch (err) {
      console.error('Erro ao salvar dados da empresa:', err);
    }
    showSavedFeedback();
  };

  const handleRemovePrinter = (id: string) => {
    const updated = printers.filter(p => p.id !== id);
    setPrinters(updated);
    localStorage.setItem(`${PREFIX}printers`, JSON.stringify(updated));
  };

  const handleBuscarImpressoras = async () => {
    setShowPrinterSearch(true);
    setIsSearching(true);
    setFoundPrinters([]);
    setSearchTerm('');
    try {
      const response = await api.get('/impressoras/todas');
      setFoundPrinters(response.data || []);
    } catch {
      setFoundPrinters([]);
    }
    setIsSearching(false);
  };

  const handleSearchByName = async () => {
    if (!searchTerm.trim()) return;
    setIsSearching(true);
    try {
      const response = await api.get('/impressoras/todas?nome=' + encodeURIComponent(searchTerm));
      setFoundPrinters(response.data || []);
    } catch {
      setFoundPrinters([]);
    }
    setIsSearching(false);
  };

  const handleTestPrinter = async (printer: PrinterData) => {
    setTestingPrinter(printer.id);
    try {
      await api.post('/impressoras/testar', { nome: printer.nome });
      alert('Impressora testada com sucesso!');
    } catch {
      alert('Falha ao testar impressora.');
    }
    setTestingPrinter(null);
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

  return (
    <div className="space-y-6 pb-20">
      {/* Inputs de arquivo ocultos */}
      <input ref={logoFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f, 'logo'); e.target.value = ''; }} />
      <input ref={bgFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f, 'bg'); e.target.value = ''; }} />

      <div className="flex items-center space-x-3 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="bg-gray-800 p-2 rounded-lg text-white"><Settings size={24} /></div>
        <h1 className="text-2xl font-bold text-gray-800">Configurações do Sistema</h1>
      </div>

      <div className="flex space-x-1 bg-gray-100 p-1 rounded-xl w-fit">
        {(['empresa', 'impressora', 'aparencia'] as const)
          .filter((tab) => tab !== 'aparencia' || user?.is_super_admin)
          .map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex items-center px-6 py-2.5 rounded-lg font-bold text-sm transition-all ${activeTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {tab === 'empresa' && <><Building2 size={18} className="mr-2" />Dados da Empresa</>}
            {tab === 'impressora' && <><Printer size={18} className="mr-2" />Impressoras</>}
            {tab === 'aparencia' && <><Palette size={18} className="mr-2" />Aparência</>}
          </button>
        ))}
      </div>

      {/* ── ABA EMPRESA ── */}
      {activeTab === 'empresa' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              {[
                { label: 'Razão Social / Nome Fantasia', field: 'nome', placeholder: 'Nome da sua transportadora', type: 'text' },
                { label: 'CNPJ', field: 'cnpj', placeholder: '00.000.000/0000-00', type: 'text', mask: maskCNPJ },
                { label: 'Telefone de Contato', field: 'telefone', placeholder: '(00) 0 0000-0000', type: 'text', mask: maskPhone },
                { label: 'Email Corporativo', field: 'email', placeholder: 'contato@empresa.com', type: 'email' },
              ].map(({ label, field, placeholder, type, mask }) => (
                <div key={field}>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">{label}</label>
                  <input
                    type={type}
                    className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50"
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
                  <input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={company.endereco} onChange={(e) => setCompany({ ...company, endereco: e.target.value })} placeholder="Av. Brasil, 1000 - Centro" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">CEP</label>
                  <input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={company.cep} onChange={(e) => setCompany({ ...company, cep: maskCEP(e.target.value) })} placeholder="00000-000" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Complemento</label>
                  <input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={company.complemento} onChange={(e) => setCompany({ ...company, complemento: e.target.value })} placeholder="Sala 201" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Ponto de Referência</label>
                  <input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={company.pontoReferencia} onChange={(e) => setCompany({ ...company, pontoReferencia: e.target.value })} placeholder="Próximo a..." />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Cidade</label>
                  <input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={company.cidade} onChange={(e) => setCompany({ ...company, cidade: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Estado (UF)</label>
                  <input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={company.estado} maxLength={2} onChange={(e) => setCompany({ ...company, estado: e.target.value.toUpperCase() })} placeholder="BA" />
                </div>
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
              <button
                onClick={() => codigoConvite && navigator.clipboard.writeText(codigoConvite)}
                disabled={!codigoConvite}
                className="px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium text-sm transition-colors disabled:opacity-40"
              >
                Copiar
              </button>
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
            <button onClick={handleSaveCompany} className="flex items-center px-8 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all active:scale-95">
              {showSaved ? <Check size={20} className="mr-2" /> : <Save size={20} className="mr-2" />}
              {showSaved ? 'Salvo!' : 'Salvar Configurações'}
            </button>
          </div>
        </div>
      )}

      {/* ── ABA IMPRESSORAS ── */}
      {activeTab === 'impressora' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-6">
          <h3 className="text-lg font-bold text-gray-800 flex items-center"><Printer size={20} className="mr-2" /> Impressoras</h3>
          <button onClick={handleBuscarImpressoras} className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-xl font-medium text-sm hover:bg-blue-700 transition-colors">
            <Search size={16} className="mr-1" /> Buscar Impressoras
          </button>
          {printers.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
              <Printer size={48} className="mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500 font-medium">Nenhuma impressora configurada.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {printers.map(p => (
                <div key={p.id} className="flex items-center justify-between p-4 border border-gray-100 rounded-xl bg-gray-50/50">
                  <div className="flex items-center space-x-3">
                    <div className={`p-2 rounded-lg ${p.tipo === 'fiscal' ? 'bg-purple-50 text-purple-600' : 'bg-gray-100 text-gray-600'}`}>
                      <Printer size={20} />
                    </div>
                    <div>
                      <p className="font-bold text-gray-800">{p.nome}</p>
                      <p className="text-xs text-gray-500">{p.tipo === 'fiscal' ? 'Fiscal' : p.tipo}{p.localizacao === 'rede' ? ' • Rede' : p.localizacao === 'local' ? ' • USB' : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button onClick={() => handleTestPrinter(p)} disabled={testingPrinter === p.id} className={`flex items-center px-3 py-2 rounded-lg text-xs font-medium transition-all ${testingPrinter === p.id ? 'bg-gray-100 text-gray-400 cursor-wait' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}>
                      {testingPrinter === p.id ? <span className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin mr-1.5" /> : <span className="mr-1.5">▶</span>}
                      Testar
                    </button>
                    <button onClick={() => handleRemovePrinter(p.id)} className="text-gray-400 hover:text-red-600 p-2 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ABA APARÊNCIA ── */}
      {activeTab === 'aparencia' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-8">
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
                    className="relative w-full h-40 border-2 border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-all overflow-hidden"
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
                      <button onClick={() => handleImageAreaClick(target)} className="text-xs px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 font-medium transition-colors">
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
                  backgroundColor: tmplPreview.cardBackground,
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
                  className={`cursor-pointer rounded-xl p-4 border-2 transition-all text-center ${selectedTemplate === template.id ? 'border-blue-500 bg-blue-50 shadow-md' : 'border-gray-200 bg-white hover:border-gray-300'}`}
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
                <input type="range" min="-200" max="200" value={cardOffsetX} onChange={e => { const v = Number(e.target.value); setCardOffsetX(v); localStorage.setItem(`${PREFIX}card_offset_x`, v.toString()); }} className="w-full accent-blue-600" />
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium text-gray-700">Deslocamento Vertical (Y)</span>
                  <span className="text-gray-500">{cardOffsetY}px</span>
                </div>
                <input type="range" min="-150" max="150" value={cardOffsetY} onChange={e => { const v = Number(e.target.value); setCardOffsetY(v); localStorage.setItem(`${PREFIX}card_offset_y`, v.toString()); }} className="w-full accent-blue-600" />
              </div>
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
                <input type="range" min="0" max="100" value={footerOpacity} onChange={e => { const v = Number(e.target.value); setFooterOpacity(v); localStorage.setItem(`${PREFIX}footer_opacity`, v.toString()); }} className="w-full accent-blue-600" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <div className="flex justify-between text-sm mb-1"><span className="font-medium text-gray-700">Tamanho da Fonte</span><span className="text-gray-500">{footerFontSize}px</span></div>
                <input type="range" min="10" max="24" value={footerFontSize} onChange={e => { const v = Number(e.target.value); setFooterFontSize(v); localStorage.setItem(`${PREFIX}footer_font_size`, v.toString()); }} className="w-full accent-blue-600" />
              </div>
              <div>
                <div className="text-sm mb-1"><span className="font-medium text-gray-700">Fonte</span></div>
                <select value={footerFontFamily} onChange={e => { setFooterFontFamily(e.target.value); localStorage.setItem(`${PREFIX}footer_font_family`, e.target.value); }} className="w-full border-2 border-gray-50 rounded-xl p-2.5 outline-none focus:border-blue-500 bg-gray-50/50 text-sm">
                  {['Arial', 'Times New Roman', 'Georgia', 'Verdana', 'Courier New'].map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <div className="text-sm mb-1"><span className="font-medium text-gray-700">Negrito</span></div>
                <button onClick={() => { const v = !footerBold; setFooterBold(v); localStorage.setItem(`${PREFIX}footer_bold`, v.toString()); }}
                  style={{ width: '100%', padding: '10px', borderRadius: '12px', border: footerBold ? '2px solid #3b82f6' : '2px solid #e5e7eb', background: footerBold ? '#eff6ff' : '#f9fafb', fontWeight: footerBold ? 'bold' : 'normal', color: footerBold ? '#3b82f6' : '#6b7280', cursor: 'pointer', fontSize: '14px' }}>
                  {footerBold ? '✓ Negrito' : 'Normal'}
                </button>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-sm mb-1"><span className="font-medium text-gray-700">Respiro do Rodapé</span><span className="text-gray-500">{footerWidth}</span></div>
              <p className="text-xs text-gray-500 mb-2">Controla o espaço entre o texto e a borda do rodapé.</p>
              <input type="range" min="20" max="100" value={footerWidth} onChange={e => { const v = Number(e.target.value); setFooterWidth(v); localStorage.setItem(`${PREFIX}footer_width`, v.toString()); }} className="w-full accent-blue-600" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
                <input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" placeholder="(11) 99999-9999" value={contactPhone} onChange={e => { setContactPhone(e.target.value); localStorage.setItem(`${PREFIX}contact_phone`, e.target.value); }} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
                <input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" placeholder="contato@transportadora.com" value={contactEmail} onChange={e => { setContactEmail(e.target.value); localStorage.setItem(`${PREFIX}contact_email`, e.target.value); }} />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Texto do Rodapé</label>
              <input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" placeholder="© 2026 Minha Transportadora. Todos os direitos reservados." value={footerText} onChange={e => { setFooterText(e.target.value); localStorage.setItem(`${PREFIX}login_footer`, e.target.value); }} />
            </div>

            <button onClick={handleSaveFooter} className={`flex items-center px-6 py-3 rounded-xl font-bold transition-all ${showSaved ? 'bg-green-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
              {showSaved ? <Check size={18} className="mr-1" /> : <Save size={18} className="mr-1" />}
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
                    <input type="range" min="10" max="200" value={tempScale} onChange={e => setTempScale(Number(e.target.value))} className="w-full accent-blue-600" />
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1"><span className="font-medium text-gray-700">Posição vertical</span><span className="text-gray-500">{tempY}px</span></div>
                    <input type="range" min="-100" max="100" value={tempY} onChange={e => setTempY(Number(e.target.value))} className="w-full accent-blue-600" />
                  </div>
                </div>
              )}

              <input type="file" accept="image/*" className="hidden" id="modalFileInput" onChange={(e) => { const file = e.target.files?.[0]; if (file && editingTarget) processFile(file, editingTarget); e.target.value = ''; }} />
              <button onClick={() => document.getElementById('modalFileInput')?.click()} className="w-full px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors text-sm font-medium">
                <Upload size={16} className="inline mr-1" /> Selecionar outra imagem
              </button>
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-between items-center">
              <button onClick={removeImage} className="flex items-center space-x-2 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors text-sm font-medium">
                <Trash2 size={16} /><span>Excluir imagem</span>
              </button>
              <div className="flex space-x-2">
                <button onClick={() => setEditingTarget(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors text-sm font-medium">Cancelar</button>
                <button onClick={saveImageSettings} disabled={!tempImg} className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg transition-colors text-sm font-medium">
                  <Check size={16} /><span>Salvar</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de busca de impressoras */}
      {showPrinterSearch && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) setShowPrinterSearch(false); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b border-gray-100">
              <div>
                <h3 className="font-bold text-lg text-gray-800">Buscar Impressoras</h3>
                <p className="text-sm text-gray-500 mt-0.5">Digite o nome ou veja os resultados abaixo</p>
              </div>
              <button onClick={() => setShowPrinterSearch(false)} className="p-1 hover:bg-gray-100 rounded"><X size={20} className="text-gray-500" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex space-x-2">
                <input type="text" placeholder="Nome da impressora" className="flex-1 border-2 border-gray-200 rounded-xl p-3 text-sm outline-none focus:border-blue-500" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleSearchByName(); }} />
                <button onClick={handleSearchByName} disabled={!searchTerm.trim() || isSearching} className={`px-5 py-3 rounded-xl font-bold text-sm transition-all ${searchTerm.trim() && !isSearching ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>Buscar</button>
              </div>
              {isSearching ? (
                <div className="flex flex-col items-center justify-center py-8 space-y-3">
                  <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-gray-500 text-sm font-medium">Buscando impressoras...</p>
                </div>
              ) : foundPrinters.length === 0 ? (
                <div className="text-center py-8"><Printer size={40} className="mx-auto text-gray-300 mb-3" /><p className="text-gray-500 text-sm">Nenhuma impressora encontrada</p></div>
              ) : (
                <div className="space-y-3 max-h-72 overflow-y-auto">
                  {foundPrinters.map((printer, idx) => (
                    <div key={idx} className="flex items-center justify-between p-4 border border-gray-100 rounded-xl hover:border-blue-200 hover:bg-blue-50/30 transition-all">
                      <div className="flex items-center space-x-4">
                        <div className={`p-2.5 rounded-lg ${printer.tipo === 'fiscal' ? 'bg-purple-50 text-purple-600' : printer.tipo === 'termica' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-600'}`}>
                          <Printer size={22} />
                        </div>
                        <div>
                          <p className="font-bold text-gray-800">{printer.nome}</p>
                          <p className="text-xs text-gray-500">{printer.tipo} {printer.ip && `• ${printer.ip}`}</p>
                        </div>
                      </div>
                      <button onClick={() => {
                        if (printer.jaCadastrada) { alert('Esta impressora já está cadastrada.'); return; }
                        const newPrinter = { id: Date.now().toString(), nome: printer.nome, tipo: printer.tipo, status: 'online' as const, localizacao: printer.origem || 'local', data_instalacao: new Date().toISOString().split('T')[0] };
                        const updated = [...printers, newPrinter];
                        setPrinters(updated);
                        localStorage.setItem(`${PREFIX}printers`, JSON.stringify(updated));
                        syncConfigToServer();
                        setFoundPrinters(foundPrinters.filter((_, i) => i !== idx));
                      }} className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 transition-colors">
                        <Plus size={16} className="mr-1" /> Adicionar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-between items-center">
              <p className="text-xs text-gray-400">{isSearching ? 'Buscando...' : `${foundPrinters.length} impressora(s) encontrada(s)`}</p>
              <p className="text-xs text-gray-300">Clique fora para fechar</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
