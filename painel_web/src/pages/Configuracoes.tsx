import React, { useState, useEffect, useRef } from 'react';
import { Settings, Building2, Printer, Save, Check, Image, Palette, X, Upload, Trash2, Truck, Search, Plus } from 'lucide-react';
import { maskPhone, maskCNPJ, maskCEP } from '../utils/masks';
import api from '../api';
import { useLoginConfig } from '../hooks/useLoginConfig';

interface CompanyData {
  nome: string;
  cnpj: string;
  endereco: string;
  cep: string;
  complemento: string;
  pontoReferencia: string;
  cidade: string;
  estado: string;
  telefone: string;
  email: string;
}

interface PrinterData {
  id: string;
  nome: string;
  tipo: string;
  status: 'online' | 'offline';
  localizacao?: string;
  data_instalacao?: string;
}

export const Configuracoes: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'empresa' | 'impressora' | 'aparencia'>('empresa');
  const [company, setCompany] = useState<CompanyData>({
    nome: '', cnpj: '', endereco: '', cep: '', complemento: '', pontoReferencia: '', cidade: '', estado: '', telefone: '', email: '',
  });

  const [printers, setPrinters] = useState<PrinterData[]>([]);
  const [showPrinterSearch, setShowPrinterSearch] = useState(false);
  const [foundPrinters, setFoundPrinters] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [testingPrinter, setTestingPrinter] = useState<string | null>(null);
  const [showSaved, setShowSaved] = useState(false);

  const [loginLogo, setLoginLogo] = useState<string | null>(null);
  const [loginBg, setLoginBg] = useState<string | null>(null);
  const [footerText, setFooterText] = useState('');

  const [editingTarget, setEditingTarget] = useState<'logo' | 'bg' | null>(null);
  const [tempImg, setTempImg] = useState<string | null>(null);
  const [tempScale, setTempScale] = useState(100);
  const [tempY, setTempY] = useState(0);

  const [cardScale, setCardScale] = useState(100);
  const [cardX, setCardX] = useState(0);
  const [cardY, setCardY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, startCardX: 0, startCardY: 0 });
  const resizeRef = useRef({ startX: 0, startY: 0, startWidth: 380, startHeight: 400, startCardX: 0, startCardY: 0, edges: { top: false, bottom: false, left: false, right: false } });
  const [cardColor, setCardColor] = useState('#ffffff');
  const [cardOpacity, setCardOpacity] = useState(100);
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
  const [inputBgColor, setInputBgColor] = useState('#ffffff');
  const [inputBorderColor, setInputBorderColor] = useState('#e5e7eb');
  const [cardFontSize, setCardFontSize] = useState(Number(localStorage.getItem('choferlog_card_font_size')) || 16);
  const [cardFontColor, setCardFontColor] = useState(localStorage.getItem('choferlog_card_font_color') || '#333333');
  const [cardWidth, setCardWidth] = useState(Number(localStorage.getItem('choferlog_card_width')) || 380);
  const [cardHeight, setCardHeight] = useState(Number(localStorage.getItem('choferlog_card_height')) || 400);
  const [showPasswordPreview, setShowPasswordPreview] = useState(false);
  const [formX, setFormX] = useState(Number(localStorage.getItem('choferlog_form_x')) || 0);
  const [formY, setFormY] = useState(Number(localStorage.getItem('choferlog_form_y')) || 0);
  const [isDraggingForm, setIsDraggingForm] = useState(false);
  const formDragRef = useRef({ startX: 0, startY: 0, startFormX: 0, startFormY: 0 });
  const [formScale, setFormScale] = useState(Number(localStorage.getItem('choferlog_form_scale')) || 100);
  const [formLogoGap, setFormLogoGap] = useState(Number(localStorage.getItem('choferlog_form_logo_gap')) || 24);
  const config = useLoginConfig();

  useEffect(() => {
    const savedCompany = localStorage.getItem('choferlog_company');
    if (savedCompany) setCompany(JSON.parse(savedCompany));

    const savedPrinters = localStorage.getItem('choferlog_printers');
    if (savedPrinters) setPrinters(JSON.parse(savedPrinters));
    const savedCardFontSize = localStorage.getItem('choferlog_card_font_size');
    if (savedCardFontSize) setCardFontSize(Number(savedCardFontSize));
    const savedCardFontColor = localStorage.getItem('choferlog_card_font_color');
    if (savedCardFontColor) setCardFontColor(savedCardFontColor);
    const savedCardWidth = localStorage.getItem('choferlog_card_width');
    if (savedCardWidth) setCardWidth(Number(savedCardWidth));

    if (config.loginLogo) setLoginLogo(config.loginLogo);
    if (config.loginBg) setLoginBg(config.loginBg);
    setFooterText(config.footerText);
    setCardScale(config.cardScale);
    setCardX(config.cardX);
    setCardY(config.cardY);
    setCardColor(config.cardColor);
    setCardOpacity(config.cardOpacity);
    setContactPhone(config.contactPhone);
    setContactEmail(config.contactEmail);
    setFooterColor(config.footerColor);
    setFooterOpacity(config.footerOpacity);
    setFooterFontSize(config.footerFontSize);
    setFooterBold(config.footerBold);
    setFooterFontFamily(config.footerFontFamily);
    setFooterWidth(config.footerWidth);
    setFooterHeight(config.footerHeight);
    setInputBgColor(config.inputBgColor);
    setInputBorderColor(config.inputBorderColor);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const deltaX = e.clientX - dragRef.current.startX;
        const deltaY = e.clientY - dragRef.current.startY;
        setCardX(Math.round(dragRef.current.startCardX + deltaX));
        setCardY(Math.round(dragRef.current.startCardY + deltaY));
      }
      if (isResizing) {
        const deltaX = e.clientX - resizeRef.current.startX;
        const deltaY = e.clientY - resizeRef.current.startY;
        const { edges } = resizeRef.current;

        if (edges.right) {
          setCardWidth(Math.min(550, Math.max(280, resizeRef.current.startWidth + deltaX)));
        }
        if (edges.left) {
          const newW = Math.min(550, Math.max(280, resizeRef.current.startWidth - deltaX));
          setCardWidth(newW);
          setCardX(resizeRef.current.startCardX - (newW - resizeRef.current.startWidth));
        }
        if (edges.bottom) {
          setCardHeight(Math.min(800, Math.max(200, resizeRef.current.startHeight + deltaY)));
        }
        if (edges.top) {
          const newH = Math.min(800, Math.max(200, resizeRef.current.startHeight - deltaY));
          setCardHeight(newH);
          setCardY(resizeRef.current.startCardY + (resizeRef.current.startHeight - newH));
        }
      }
      if (isDraggingForm) {
        const deltaX = e.clientX - formDragRef.current.startX;
        const deltaY = e.clientY - formDragRef.current.startY;
        setFormX(Math.round(formDragRef.current.startFormX + deltaX));
        setFormY(Math.round(formDragRef.current.startFormY + deltaY));
      }
      if (isResizingFooter) {
        const deltaX = e.clientX - footerResizeRef.current.startX;
        const deltaY = e.clientY - footerResizeRef.current.startY;
        let newWidth = footerResizeRef.current.startWidth;
        let newHeight = footerResizeRef.current.startHeight;
        if (footerResizeRef.current.edge === 'right' || footerResizeRef.current.edge === 'corner') {
          const previewEl = document.querySelector('.preview-container');
          const previewWidth = previewEl?.clientWidth || 800;
          newWidth = Math.min(95, Math.max(30, footerResizeRef.current.startWidth + (deltaX / previewWidth) * 100));
        }
        if (footerResizeRef.current.edge === 'bottom' || footerResizeRef.current.edge === 'corner') {
          newHeight = Math.min(150, Math.max(30, footerResizeRef.current.startHeight + deltaY));
        }
        setFooterWidth(Math.round(newWidth));
        setFooterHeight(Math.round(newHeight));
      }
    };

    const handleMouseUp = () => {
      if (isDragging) {
        localStorage.setItem('choferlog_card_x', cardX.toString());
        localStorage.setItem('choferlog_card_y', cardY.toString());
      }
      if (isResizing) {
        localStorage.setItem('choferlog_card_width', cardWidth.toString());
        localStorage.setItem('choferlog_card_height', cardHeight.toString());
      }
      if (isDraggingForm) {
        localStorage.setItem('choferlog_form_x', formX.toString());
        localStorage.setItem('choferlog_form_y', formY.toString());
      }
      if (isResizingFooter) {
        localStorage.setItem('choferlog_footer_width', footerWidth.toString());
        localStorage.setItem('choferlog_footer_height', footerHeight.toString());
      }
      setIsDragging(false);
      setIsResizing(false);
      setIsResizingFooter(false);
      setIsDraggingForm(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, isResizingFooter, isDraggingForm, cardX, cardY, cardWidth, cardHeight, formX, formY, footerWidth, footerHeight]);

  const handleSaveCompany = () => {
    localStorage.setItem('choferlog_company', JSON.stringify(company));
    setShowSaved(true);
    syncConfigToServer();
    setTimeout(() => setShowSaved(false), 3000);
  };

  const handleRemovePrinter = (id: string) => {
    const updated = printers.filter(p => p.id !== id);
    setPrinters(updated);
    localStorage.setItem('choferlog_printers', JSON.stringify(updated));
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
      setTempScale(100);
      setTempY(0);
      setEditingTarget(target);
    };
    reader.readAsDataURL(file);
  };

  const openEditor = (target: 'logo' | 'bg') => {
    const current = target === 'logo' ? loginLogo : loginBg;
    if (current) {
      setTempImg(current);
      setTempScale(Number(localStorage.getItem(`choferlog_login_${target}_scale`)) || 100);
      setTempY(Number(localStorage.getItem(`choferlog_login_${target}_y`)) || 0);
    } else {
      setTempImg(null);
      setTempScale(100);
      setTempY(0);
    }
    setEditingTarget(target);
  };

  const saveImageSettings = () => {
    if (!editingTarget) return;
    const prefix = `choferlog_login_${editingTarget}`;
    if (tempImg) {
      localStorage.setItem(prefix, tempImg);
      localStorage.setItem(`${prefix}_scale`, tempScale.toString());
      localStorage.setItem(`${prefix}_y`, tempY.toString());
      if (editingTarget === 'logo') setLoginLogo(tempImg);
      else setLoginBg(tempImg);
    }
    setEditingTarget(null);
    syncConfigToServer();
  };

  const removeImage = () => {
    if (!editingTarget) return;
    const prefix = `choferlog_login_${editingTarget}`;
    localStorage.removeItem(prefix);
    localStorage.removeItem(`${prefix}_scale`);
    localStorage.removeItem(`${prefix}_y`);
    if (editingTarget === 'logo') setLoginLogo(null);
    else setLoginBg(null);
    setEditingTarget(null);
    syncConfigToServer();
  };

  const handleSaveFooter = () => {
    localStorage.setItem('choferlog_login_footer', footerText);
    localStorage.setItem('choferlog_contact_phone', contactPhone);
    localStorage.setItem('choferlog_contact_email', contactEmail);
    localStorage.setItem('choferlog_footer_color', footerColor);
    localStorage.setItem('choferlog_footer_opacity', footerOpacity.toString());
    localStorage.setItem('choferlog_footer_font_size', footerFontSize.toString());
    localStorage.setItem('choferlog_footer_bold', footerBold.toString());
    localStorage.setItem('choferlog_footer_font_family', footerFontFamily);
    localStorage.setItem('choferlog_footer_width', footerWidth.toString());
    localStorage.setItem('choferlog_footer_height', footerHeight.toString());
    localStorage.setItem('choferlog_input_bg', inputBgColor);
    localStorage.setItem('choferlog_input_border', inputBorderColor);
    setShowSaved(true);
    syncConfigToServer();
    setTimeout(() => setShowSaved(false), 3000);
  };

  const collectAllConfig = () => ({
    company, printers, loginLogo, loginBg, footerText,
    contactPhone, contactEmail, footerColor, footerOpacity,
    footerFontSize, footerBold, footerFontFamily,
    footerWidth, footerHeight,
    inputBgColor, inputBorderColor,
    cardScale, cardX, cardY, cardColor, cardOpacity,
    loginLogoScale: Number(localStorage.getItem('choferlog_login_logo_scale')) || 100,
    loginLogoY: Number(localStorage.getItem('choferlog_login_logo_y')) || 0,
    loginBgScale: Number(localStorage.getItem('choferlog_login_bg_scale')) || 100,
    loginBgY: Number(localStorage.getItem('choferlog_login_bg_y')) || 0,
  });

  const syncConfigToServer = () => {
    const dados = collectAllConfig();
    localStorage.setItem('chofer_config', JSON.stringify(dados));
    try {
      api.put('/configuracoes', dados);
    } catch (err) {
      console.log('Erro ao sincronizar com servidor');
    }
  };

  const loadConfigFromApi = () => {
    api.get('/configuracoes')
      .then((response) => {
        const data = response.data;
        if (data) {
          const d = data;
          if (d.company) setCompany(d.company);
          if (d.printers) setPrinters(d.printers);
          if (d.loginLogo) setLoginLogo(d.loginLogo);
          if (d.loginBg) setLoginBg(d.loginBg);
          if (d.footerText !== undefined) setFooterText(d.footerText);
          if (d.cardScale) setCardScale(d.cardScale);
          if (d.cardX !== undefined) setCardX(d.cardX);
          if (d.cardY !== undefined) setCardY(d.cardY);
          if (d.cardColor) setCardColor(d.cardColor);
          if (d.cardOpacity !== undefined) setCardOpacity(d.cardOpacity);
          if (d.contactPhone !== undefined) setContactPhone(d.contactPhone);
          if (d.contactEmail !== undefined) setContactEmail(d.contactEmail);
          if (d.footerColor) setFooterColor(d.footerColor);
          if (d.footerOpacity !== undefined) setFooterOpacity(d.footerOpacity);
          if (d.footerFontSize !== undefined) setFooterFontSize(d.footerFontSize);
          if (d.footerBold !== undefined) setFooterBold(d.footerBold);
          if (d.footerFontFamily) setFooterFontFamily(d.footerFontFamily);
          if (d.footerWidth !== undefined) setFooterWidth(d.footerWidth);
          if (d.footerHeight !== undefined) setFooterHeight(d.footerHeight);
          if (d.inputBgColor) setInputBgColor(d.inputBgColor);
          if (d.inputBorderColor) setInputBorderColor(d.inputBorderColor);
        }
      })
      .catch(() => { });
  };

  return (
    <div className="space-y-6 pb-20">
      <div className="flex items-center space-x-3 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="bg-gray-800 p-2 rounded-lg text-white">
          <Settings size={24} />
        </div>
        <h1 className="text-2xl font-bold text-gray-800">Configurações do Sistema</h1>
      </div>

      <div className="flex space-x-1 bg-gray-100 p-1 rounded-xl w-fit">
        <button
          onClick={() => setActiveTab('empresa')}
          className={`flex items-center px-6 py-2.5 rounded-lg font-bold text-sm transition-all ${activeTab === 'empresa' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <Building2 size={18} className="mr-2" /> Dados da Empresa
        </button>
        <button
          onClick={() => setActiveTab('impressora')}
          className={`flex items-center px-6 py-2.5 rounded-lg font-bold text-sm transition-all ${activeTab === 'impressora' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <Printer size={18} className="mr-2" /> Impressoras
        </button>
        <button
          onClick={() => setActiveTab('aparencia')}
          className={`flex items-center px-6 py-2.5 rounded-lg font-bold text-sm transition-all ${activeTab === 'aparencia' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <Palette size={18} className="mr-2" /> Aparência
        </button>
      </div>

      {activeTab === 'empresa' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-6 animate-fade-in">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Razão Social / Nome Fantasia</label>
                <input
                  type="text"
                  className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50"
                  value={company.nome}
                  onChange={(e) => setCompany({ ...company, nome: e.target.value })}
                  placeholder="Nome da sua transportadora"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">CNPJ</label>
                <input
                  type="text"
                  className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50"
                  value={company.cnpj}
                  onChange={(e) => setCompany({ ...company, cnpj: maskCNPJ(e.target.value) })}
                  placeholder="00.000.000/0000-00"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Telefone de Contato</label>
                <input
                  type="text"
                  className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50"
                  value={company.telefone}
                  onChange={(e) => setCompany({ ...company, telefone: maskPhone(e.target.value) })}
                  placeholder="(00) 0 0000-0000"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Email Corporativo</label>
                <input
                  type="email"
                  className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50"
                  value={company.email}
                  onChange={(e) => setCompany({ ...company, email: e.target.value })}
                  placeholder="contato@empresa.com"
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Endereço (Rua, Nº, Bairro)</label>
                  <input
                    type="text"
                    className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50"
                    value={company.endereco}
                    onChange={(e) => setCompany({ ...company, endereco: e.target.value })}
                    placeholder="Av. Brasil, 1000 - Centro"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">CEP</label>
                  <input
                    type="text"
                    className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50"
                    value={company.cep}
                    onChange={(e) => setCompany({ ...company, cep: maskCEP(e.target.value) })}
                    placeholder="00000-000"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Complemento</label>
                  <input
                    type="text"
                    className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50"
                    value={company.complemento}
                    onChange={(e) => setCompany({ ...company, complemento: e.target.value })}
                    placeholder="Ex: Sala 201"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Ponto de Referência</label>
                  <input
                    type="text"
                    className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50"
                    value={company.pontoReferencia}
                    onChange={(e) => setCompany({ ...company, pontoReferencia: e.target.value })}
                    placeholder="Próximo a..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Cidade</label>
                  <input
                    type="text"
                    className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50"
                    value={company.cidade}
                    onChange={(e) => setCompany({ ...company, cidade: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Estado (UF)</label>
                  <input
                    type="text"
                    className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50"
                    value={company.estado}
                    maxLength={2}
                    onChange={(e) => setCompany({ ...company, estado: e.target.value.toUpperCase() })}
                    placeholder="BA"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-gray-50">
            <button
              onClick={handleSaveCompany}
              className="flex items-center px-8 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all active:scale-95"
            >
              {showSaved ? <Check size={20} className="mr-2" /> : <Save size={20} className="mr-2" />}
              {showSaved ? 'Salvo!' : 'Salvar Configurações'}
            </button>
          </div>
        </div>
      )}

      {activeTab === 'impressora' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-6 animate-fade-in">
          <h3 className="text-lg font-bold text-gray-800 flex items-center">
            <Printer size={20} className="mr-2" /> Impressoras
          </h3>

          <button
            onClick={handleBuscarImpressoras}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-xl font-medium text-sm hover:bg-blue-700 transition-colors"
          >
            <Search size={16} className="mr-1" /> Buscar Impressoras
          </button>

          {printers.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
              <Printer size={48} className="mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500 font-medium">Nenhuma impressora configurada.</p>
              <p className="text-gray-400 text-sm mt-1">Adicione manualmente ou conecte via USB.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {printers.map(p => (
                <div key={p.id} className="flex items-center justify-between p-4 border border-gray-100 rounded-xl bg-gray-50/50">
                  <div className="flex items-center space-x-3">
                    <div className={`p-2 rounded-lg ${p.tipo === 'fiscal' ? 'bg-purple-50 text-purple-600' : 'bg-gray-100 text-gray-600'
                      }`}>
                      <Printer size={20} />
                    </div>
                    <div>
                      <p className="font-bold text-gray-800">{p.nome}</p>
                      <p className="text-xs text-gray-500">
                        {p.tipo === 'fiscal' ? 'Fiscal' : p.tipo}
                        {p.localizacao === 'rede' && ` • Rede`}
                        {p.localizacao === 'local' && ` • USB`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleTestPrinter(p)}
                      disabled={testingPrinter === p.id}
                      className={`flex items-center px-3 py-2 rounded-lg text-xs font-medium transition-all ${testingPrinter === p.id
                        ? 'bg-gray-100 text-gray-400 cursor-wait'
                        : 'bg-green-50 text-green-700 hover:bg-green-100'
                        }`}
                    >
                      {testingPrinter === p.id ? (
                        <span className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin mr-1.5" />
                      ) : (
                        <span className="mr-1.5">▶</span>
                      )}
                      Testar
                    </button>
                    <button
                      onClick={() => handleRemovePrinter(p.id)}
                      className="text-gray-400 hover:text-red-600 p-2 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'aparencia' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-8 animate-fade-in">
          <h3 className="text-lg font-bold text-gray-800 flex items-center">
            <Palette size={20} className="mr-2" /> Personalizar Tela de Login
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Logomarca da Página de Login</label>
              <div
                onClick={() => openEditor('logo')}
                onDoubleClick={() => openEditor('logo')}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) processFile(f, 'logo'); }}
                className="relative w-full h-40 border-2 border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-all overflow-hidden"
              >
                {loginLogo ? (
                  <img src={loginLogo} alt="Login Logo" className="max-w-full max-h-full object-contain p-4" />
                ) : (
                  <div className="text-center text-gray-400">
                    <Upload size={32} className="mx-auto mb-2" />
                    <p className="text-sm font-medium">Clique para adicionar</p>
                    <p className="text-xs">ou arraste uma imagem</p>
                  </div>
                )}
              </div>
              <div className="flex space-x-2 mt-2">
                {loginLogo && (
                  <>
                    <button onClick={() => openEditor('logo')} className="text-xs px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 font-medium transition-colors">
                      <Image size={14} className="inline mr-1" />Ajustar
                    </button>
                    <button onClick={() => { setLoginLogo(null); localStorage.removeItem('choferlog_login_logo'); localStorage.removeItem('choferlog_login_logo_scale'); localStorage.removeItem('choferlog_login_logo_y'); syncConfigToServer(); }} className="text-xs px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 font-medium transition-colors">
                      <Trash2 size={14} className="inline mr-1" />Remover
                    </button>
                  </>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Imagem de Fundo da Página de Login</label>
              <div
                onClick={() => openEditor('bg')}
                onDoubleClick={() => openEditor('bg')}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) processFile(f, 'bg'); }}
                className="relative w-full h-40 border-2 border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-all overflow-hidden"
              >
                {loginBg ? (
                  <img src={loginBg} alt="Login Background" className="w-full h-full object-cover" />
                ) : (
                  <div className="text-center text-gray-400">
                    <Upload size={32} className="mx-auto mb-2" />
                    <p className="text-sm font-medium">Clique para adicionar</p>
                    <p className="text-xs">ou arraste uma imagem</p>
                  </div>
                )}
              </div>
              <div className="flex space-x-2 mt-2">
                {loginBg && (
                  <>
                    <button onClick={() => openEditor('bg')} className="text-xs px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 font-medium transition-colors">
                      <Image size={14} className="inline mr-1" />Ajustar
                    </button>
                    <button onClick={() => { setLoginBg(null); localStorage.removeItem('choferlog_login_bg'); localStorage.removeItem('choferlog_login_bg_scale'); localStorage.removeItem('choferlog_login_bg_y'); syncConfigToServer(); }} className="text-xs px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 font-medium transition-colors">
                      <Trash2 size={14} className="inline mr-1" />Remover
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Pré-visualização da Tela de Login</label>
            <div className="w-full rounded-xl border border-gray-200 preview-container"
              style={{
                height: '420px',
                maxWidth: '100%',
                background: loginBg ? `url(${loginBg}) center/cover no-repeat` : '#1a1a2e',
                overflow: 'hidden',
                position: 'relative'
              }}>
              <div style={{
                transform: 'scale(0.7)',
                transformOrigin: 'top left',
                width: '142.86%',
                height: '142.86%',
                position: 'absolute',
                top: 0,
                left: 0
              }}>
                <div className="w-full h-full flex items-center justify-center relative"
                  style={loginBg ? { backgroundImage: `url(${loginBg})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { backgroundColor: '#f3f4f6' }}>
                  <div style={{ position: 'relative', display: 'inline-block' }}>
                    <div className="w-full relative z-10"
                      style={{
                        backgroundColor: `rgba(${parseInt(cardColor.replace('#', '').substring(0, 2), 16)}, ${parseInt(cardColor.replace('#', '').substring(2, 4), 16)}, ${parseInt(cardColor.replace('#', '').substring(4, 6), 16)}, ${cardOpacity / 100})`,
                        transform: `translateX(${cardX}px) translateY(${cardY}px)`,
                        width: '100%',
                        maxWidth: `${cardWidth}px`,
                        height: `${cardHeight}px`,
                        maxHeight: `${cardHeight}px`,
                        borderRadius: '1rem',
                        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
                        padding: '1.5rem',
                        userSelect: isDragging || isResizing ? 'none' : undefined
                      }}
                      onMouseMove={(e) => {
                        if (isDragging || isResizing) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const edge = 12;
                        const top = e.clientY - rect.top < edge;
                        const bottom = rect.bottom - e.clientY < edge;
                        const left = e.clientX - rect.left < edge;
                        const right = rect.right - e.clientX < edge;

                        let cursor = 'default';
                        if ((top && left) || (bottom && right)) cursor = 'nwse-resize';
                        else if ((top && right) || (bottom && left)) cursor = 'nesw-resize';
                        else if (top || bottom) cursor = 'ns-resize';
                        else if (left || right) cursor = 'ew-resize';

                        e.currentTarget.style.cursor = cursor;
                      }}
                      onMouseDown={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const edge = 12;
                        const top = e.clientY - rect.top < edge;
                        const bottom = rect.bottom - e.clientY < edge;
                        const left = e.clientX - rect.left < edge;
                        const right = rect.right - e.clientX < edge;

                        if (top || bottom || left || right) {
                          e.stopPropagation();
                          setIsResizing(true);
                          resizeRef.current = {
                            startX: e.clientX,
                            startY: e.clientY,
                            startWidth: cardWidth,
                            startHeight: cardHeight,
                            startCardX: cardX,
                            startCardY: cardY,
                            edges: { top, bottom, left, right }
                          };
                        } else {
                          setIsDragging(true);
                          dragRef.current = { startX: e.clientX, startY: e.clientY, startCardX: cardX, startCardY: cardY };
                        }
                      }}
                    >
                      {/* Barra de arrasto */}
                      <div
                        style={{
                          cursor: 'grab',
                          height: '24px',
                          background: 'rgba(0,0,0,0.05)',
                          borderRadius: '4px 4px 0 0',
                          marginBottom: '12px',
                          marginLeft: '-2rem',
                          marginRight: '-2rem',
                          marginTop: '-2rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setIsDragging(true);
                          dragRef.current = { startX: e.clientX, startY: e.clientY, startCardX: cardX, startCardY: cardY };
                        }}
                      >
                        <div style={{ display: 'flex', gap: '3px' }}>
                          <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#ccc' }}></div>
                          <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#ccc' }}></div>
                          <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#ccc' }}></div>
                        </div>
                      </div>

                      <div
                        style={{
                          transform: `translate(${formX}px, ${formY}px) scale(${formScale / 100})`,
                          transformOrigin: 'top center',
                          cursor: isDraggingForm ? 'grabbing' : 'grab',
                          userSelect: isDraggingForm ? 'none' : undefined
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setIsDraggingForm(true);
                          formDragRef.current = { startX: e.clientX, startY: e.clientY, startFormX: formX, startFormY: formY };
                        }}
                      >
                        <div style={{ textAlign: 'center', fontSize: '10px', color: '#999', marginBottom: '4px', cursor: 'grab' }}>⋯ mover</div>
                        <div className="flex flex-col items-center" style={{ marginBottom: formLogoGap }}>
                          {loginLogo ? (
                            <img src={loginLogo} alt="Logo" className="object-contain" style={{ maxWidth: '100%' }} />
                          ) : (
                            <div className="bg-blue-600 p-3 rounded-full flex items-center justify-center">
                              <Truck size={32} className="text-white" />
                            </div>
                          )}
                        </div>
                        <form className="flex flex-col gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
                            <input type="email" value="" readOnly style={{ width: '100%', padding: '14px', fontSize: '15px', borderRadius: '10px', border: `2px solid ${inputBorderColor}`, backgroundColor: inputBgColor, outline: 'none', boxSizing: 'border-box' }} />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
                            <div style={{ position: 'relative', width: '100%' }}>
                              <input type={showPasswordPreview ? 'text' : 'password'} value="" readOnly style={{ width: '100%', padding: '14px 40px 14px 14px', fontSize: '15px', borderRadius: '10px', border: `2px solid ${inputBorderColor}`, backgroundColor: inputBgColor, outline: 'none', boxSizing: 'border-box' }} />
                              <button type="button" onClick={() => setShowPasswordPreview(!showPasswordPreview)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '16px', padding: '4px' }}>
                                {showPasswordPreview ? '🙈' : '👁️'}
                              </button>
                            </div>
                          </div>
                          <button type="button" disabled style={{ width: '100%', padding: '14px', fontSize: '16px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 'bold', cursor: 'default', opacity: 0.7 }}>Entrar</button>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', fontSize: '14px' }}>
                            <span style={{ color: '#3b82f6', cursor: 'default', fontWeight: '500' }}>Criar conta</span>
                            <span style={{ color: '#6b7280', cursor: 'default', fontWeight: '400' }}>Esqueceu a senha?</span>
                          </div>
                        </form>
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{
                  position: 'absolute',
                  bottom: '16px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: `${footerWidth}%`,
                  maxHeight: `${footerHeight}px`,
                  background: footerColor + Math.round(footerOpacity * 2.55).toString(16).padStart(2, '0'),
                  borderRadius: '8px',
                  padding: '8px 16px',
                  textAlign: 'center',
                  overflow: 'hidden',
                  cursor: isResizingFooter ? 'grabbing' : 'default',
                  transition: isResizingFooter ? 'none' : 'width 0.1s, maxHeight 0.1s'
                }}>
                  <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '12px',
                      flexWrap: 'wrap',
                      fontSize: `${footerFontSize}px`,
                      fontWeight: footerBold ? 'bold' : 'normal',
                      fontFamily: footerFontFamily,
                      color: '#ffffff',
                      textShadow: '0 1px 3px rgba(0,0,0,0.3)',
                      height: '100%'
                    }}>
                      {contactPhone && <span>📞 {contactPhone}</span>}
                      {contactEmail && <span>📧 {contactEmail}</span>}
                      {footerText && <span>| {footerText}</span>}
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
            </div>
          </div>

          <div className="border-t border-gray-100 pt-6">
            <label className="block text-xs font-bold text-gray-400 uppercase mb-3 ml-1">Ajuste do Card de Login</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="font-medium text-gray-700">Cor de Fundo</span>
                </div>
                <div className="flex items-center space-x-3">
                  <input
                    type="color"
                    value={cardColor}
                    onChange={e => { const v = e.target.value; setCardColor(v); localStorage.setItem('choferlog_card_color', v); }}
                    className="w-12 h-12 rounded-lg border border-gray-200 cursor-pointer"
                  />
                  <span className="text-sm text-gray-500 font-mono">{cardColor}</span>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium text-gray-700">Transparência</span>
                  <span className="text-gray-500">{cardOpacity}%</span>
                </div>
                <input type="range" min="0" max="100" value={cardOpacity} onChange={e => { const v = Number(e.target.value); setCardOpacity(v); localStorage.setItem('choferlog_card_opacity', v.toString()); }} className="w-full accent-blue-600" />
              </div>
            </div>
            <div className="mt-4">
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium text-gray-700">Tamanho da Fonte</span>
                <span className="text-gray-500">{cardFontSize}px</span>
              </div>
              <input type="range" min="12" max="24" value={cardFontSize} onChange={e => { const v = Number(e.target.value); setCardFontSize(v); localStorage.setItem('choferlog_card_font_size', v.toString()); }} className="w-full accent-blue-600" />
            </div>
            <div className="mt-4">
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium text-gray-700">Cor da Fonte</span>
              </div>
              <div className="flex items-center space-x-3">
                <input type="color" value={cardFontColor} onChange={e => { const v = e.target.value; setCardFontColor(v); localStorage.setItem('choferlog_card_font_color', v); }} className="w-12 h-12 rounded-lg border border-gray-200 cursor-pointer" />
                <span className="text-sm text-gray-500 font-mono">{cardFontColor}</span>
              </div>
            </div>
            <div className="mt-4">
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium text-gray-700">Largura do Card</span>
                <span className="text-gray-500">{cardWidth}px</span>
              </div>
              <input type="range" min="300" max="550" value={cardWidth} onChange={e => { const v = Number(e.target.value); setCardWidth(v); localStorage.setItem('choferlog_card_width', v.toString()); }} className="w-full accent-blue-600" />
            </div>
            <div className="mt-4">
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium text-gray-700">Altura do Card</span>
                <span className="text-gray-500">{cardHeight}px</span>
              </div>
              <input type="range" min="200" max="800" value={cardHeight} onChange={e => { const v = Number(e.target.value); setCardHeight(v); localStorage.setItem('choferlog_card_height', v.toString()); }} className="w-full accent-blue-600" />
            </div>
          </div>

          <div className="border-t border-gray-100 pt-6">
            <label className="block text-xs font-bold text-gray-400 uppercase mb-3 ml-1">Zoom e Distância dos Campos + Logomarca</label>
            <div className="mt-4">
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium text-gray-700">Zoom (Aproximar / Afastar)</span>
                <span className="text-gray-500">{formScale}%</span>
              </div>
              <input type="range" min="50" max="200" value={formScale} onChange={e => { const v = Number(e.target.value); setFormScale(v); localStorage.setItem('choferlog_form_scale', v.toString()); }} className="w-full accent-blue-600" />
            </div>
            <div className="mt-4">
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium text-gray-700">Distância entre Logomarca e Campos</span>
                <span className="text-gray-500">{formLogoGap}px</span>
              </div>
              <input type="range" min="0" max="60" value={formLogoGap} onChange={e => { const v = Number(e.target.value); setFormLogoGap(v); localStorage.setItem('choferlog_form_logo_gap', v.toString()); }} className="w-full accent-blue-600" />
            </div>
          </div>

          <div className="border-t border-gray-100 pt-6">
            <label className="block text-xs font-bold text-gray-400 uppercase mb-3 ml-1">Aparência dos Campos</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium text-gray-700">Cor de Fundo</span>
                </div>
                <div className="flex items-center space-x-3">
                  <input type="color" value={inputBgColor} onChange={e => { const v = e.target.value; setInputBgColor(v); localStorage.setItem('choferlog_input_bg', v); }} className="w-12 h-12 rounded-lg border border-gray-200 cursor-pointer" />
                  <span className="text-sm text-gray-500 font-mono">{inputBgColor}</span>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium text-gray-700">Cor da Borda</span>
                </div>
                <div className="flex items-center space-x-3">
                  <input type="color" value={inputBorderColor} onChange={e => { const v = e.target.value; setInputBorderColor(v); localStorage.setItem('choferlog_input_border', v); }} className="w-12 h-12 rounded-lg border border-gray-200 cursor-pointer" />
                  <span className="text-sm text-gray-500 font-mono">{inputBorderColor}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-6">
            <label className="block text-xs font-bold text-gray-400 uppercase mb-3 ml-1">Rodapé da Tela de Login</label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="font-medium text-gray-700">Cor do Fundo</span>
                </div>
                <div className="flex items-center space-x-3">
                  <input
                    type="color"
                    value={footerColor}
                    onChange={e => { const v = e.target.value; setFooterColor(v); localStorage.setItem('choferlog_footer_color', v); }}
                    className="w-12 h-12 rounded-lg border border-gray-200 cursor-pointer"
                  />
                  <span className="text-sm text-gray-500 font-mono">{footerColor}</span>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium text-gray-700">Transparência</span>
                  <span className="text-gray-500">{footerOpacity}%</span>
                </div>
                <input type="range" min="0" max="100" value={footerOpacity} onChange={e => { const v = Number(e.target.value); setFooterOpacity(v); localStorage.setItem('choferlog_footer_opacity', v.toString()); }} className="w-full accent-blue-600" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium text-gray-700">Tamanho da Fonte</span>
                  <span className="text-gray-500">{footerFontSize}px</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="24"
                  value={footerFontSize}
                  onChange={e => {
                    const v = Number(e.target.value);
                    setFooterFontSize(v);
                    localStorage.setItem('choferlog_footer_font_size', v.toString());
                  }}
                  className="w-full accent-blue-600"
                />
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium text-gray-700">Fonte</span>
                </div>
                <select
                  value={footerFontFamily}
                  onChange={e => {
                    const v = e.target.value;
                    setFooterFontFamily(v);
                    localStorage.setItem('choferlog_footer_font_family', v);
                  }}
                  className="w-full border-2 border-gray-50 rounded-xl p-2.5 outline-none focus:border-blue-500 bg-gray-50/50 text-sm"
                >
                  <option value="Arial">Arial</option>
                  <option value="Times New Roman">Times New Roman</option>
                  <option value="Georgia">Georgia</option>
                  <option value="Verdana">Verdana</option>
                  <option value="Courier New">Courier New</option>
                </select>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium text-gray-700">Negrito</span>
                </div>
                <button
                  onClick={() => {
                    const v = !footerBold;
                    setFooterBold(v);
                    localStorage.setItem('choferlog_footer_bold', v.toString());
                  }}
                  style={{
                    width: '100%',
                    padding: '10px',
                    borderRadius: '12px',
                    border: footerBold ? '2px solid #3b82f6' : '2px solid #e5e7eb',
                    background: footerBold ? '#eff6ff' : '#f9fafb',
                    fontWeight: footerBold ? 'bold' : 'normal',
                    color: footerBold ? '#3b82f6' : '#6b7280',
                    cursor: 'pointer',
                    fontSize: '14px'
                  }}
                >
                  {footerBold ? '✓ Negrito' : 'Normal'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
                <input
                  type="text"
                  className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50"
                  placeholder="(11) 99999-9999"
                  value={contactPhone}
                  onChange={e => setContactPhone(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
                <input
                  type="text"
                  className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50"
                  placeholder="contato@transportadora.com"
                  value={contactEmail}
                  onChange={e => setContactEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Texto do Rodapé (Direitos Autorais)</label>
              <input
                type="text"
                className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50"
                placeholder='Ex: © 2026 Minha Transportadora. Todos os direitos reservados.'
                value={footerText}
                onChange={e => setFooterText(e.target.value)}
              />
            </div>

            <button
              onClick={handleSaveFooter}
              className={`flex items-center px-6 py-3 rounded-xl font-bold transition-all ${showSaved ? 'bg-green-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
            >
              {showSaved ? <Check size={18} className="mr-1" /> : <Save size={18} className="mr-1" />}
              {showSaved ? 'Salvo' : 'Salvar'}
            </button>
          </div>
        </div>
      )}

      {editingTarget && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in-down">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden text-gray-800">
            <div className="flex justify-between items-center p-4 border-b border-gray-100">
              <h3 className="font-bold text-lg">Ajustar {editingTarget === 'logo' ? 'Logomarca' : 'Imagem de Fundo'}</h3>
              <button onClick={() => setEditingTarget(null)} className="p-1 hover:bg-gray-100 rounded">
                <X size={20} className="text-gray-500" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="text-center">
                <p className="text-sm text-gray-500 mb-2 font-medium">Pré-visualização</p>
                <div className="bg-gray-100 rounded-lg w-full h-64 mx-auto flex items-center justify-center overflow-hidden border-2 border-dashed border-gray-300 relative">
                  {tempImg && (
                    <img
                      src={tempImg}
                      alt="Preview"
                      style={{ transform: `scale(${tempScale / 100}) translateY(${tempY}px)`, transformOrigin: 'center' }}
                      className={editingTarget === 'logo' ? 'max-w-full max-h-full object-contain' : 'w-full h-full object-cover'}
                    />
                  )}
                  {!tempImg && (
                    <div className="text-center text-gray-400">
                      <Upload size={32} className="mx-auto mb-2" />
                      <p className="text-sm">Selecione uma imagem</p>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <input type="file" accept="image/*" className="hidden" id="modalFileInput" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file && editingTarget) processFile(file, editingTarget);
                  e.target.value = '';
                }} />
                <button onClick={() => document.getElementById('modalFileInput')?.click()} className="w-full px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors text-sm font-medium">
                  <Upload size={16} className="inline mr-1" /> Selecionar outra imagem
                </button>
              </div>
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-between items-center">
              <button onClick={removeImage} className="flex items-center space-x-2 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors text-sm font-medium">
                <Trash2 size={16} />
                <span>Excluir</span>
              </button>
              <div className="flex space-x-2">
                <button onClick={() => setEditingTarget(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors text-sm font-medium">
                  Cancelar
                </button>
                <button onClick={saveImageSettings} className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium">
                  <Check size={16} />
                  <span>Salvar</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPrinterSearch && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowPrinterSearch(false);
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b border-gray-100">
              <div>
                <h3 className="font-bold text-lg text-gray-800">🔍 Buscar Impressoras</h3>
                <p className="text-sm text-gray-500 mt-0.5">Digite o nome para buscar na rede ou veja os resultados abaixo</p>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex space-x-2">
                <input
                  type="text"
                  placeholder="Nome da impressora (ex: Térmica Balcão)"
                  className="flex-1 border-2 border-gray-200 rounded-xl p-3 text-sm outline-none focus:border-blue-500"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSearchByName(); }}
                />
                <button
                  onClick={handleSearchByName}
                  disabled={!searchTerm.trim() || isSearching}
                  className={`px-5 py-3 rounded-xl font-bold text-sm transition-all ${searchTerm.trim() && !isSearching
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    }`}
                >
                  Buscar
                </button>
              </div>

              {isSearching ? (
                <div className="flex flex-col items-center justify-center py-8 space-y-3">
                  <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-gray-500 text-sm font-medium">Buscando impressoras...</p>
                </div>
              ) : foundPrinters.length === 0 ? (
                <div className="text-center py-8 space-y-3">
                  <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
                    <Printer size={28} className="text-gray-400" />
                  </div>
                  <p className="text-gray-500 text-sm">Nenhuma impressora encontrada</p>
                  <p className="text-xs text-gray-400">Tente digitar o nome exato ou verifique se a impressora está na rede</p>
                  <button
                    onClick={() => window.print()}
                    className="px-4 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-100 transition-colors"
                  >
                    Abrir Diálogo de Impressão do Sistema
                  </button>
                </div>
              ) : (
                <div className="space-y-3 max-h-72 overflow-y-auto">
                  {foundPrinters.map((printer, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-4 border border-gray-100 rounded-xl hover:border-blue-200 hover:bg-blue-50/30 transition-all"
                    >
                      <div className="flex items-center space-x-4">
                        <div className={`p-2.5 rounded-lg ${printer.tipo === 'fiscal' ? 'bg-purple-50 text-purple-600' :
                          printer.tipo === 'termica' ? 'bg-blue-50 text-blue-600' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                          <Printer size={22} />
                        </div>
                        <div>
                          <p className="font-bold text-gray-800">{printer.nome}</p>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${printer.via === 'wifi' ? 'bg-green-100 text-green-700' :
                              printer.via === 'rede' ? 'bg-purple-100 text-purple-700' :
                                printer.via === 'usb' ? 'bg-blue-100 text-blue-700' :
                                  'bg-gray-100 text-gray-600'
                              }`}>
                              {printer.via === 'wifi' ? '📶 Wi-Fi (WSD)' :
                                printer.via === 'rede' ? '🌐 Rede' :
                                  printer.via === 'usb' ? '🔌 USB' : '💻 Local'}
                            </span>
                            <span className="text-[10px] text-gray-400">
                              {printer.tipo === 'fiscal' ? 'Fiscal' : printer.tipo === 'termica' ? 'Térmica' : printer.tipo}
                            </span>
                            {printer.ip && (
                              <span className="text-[10px] text-gray-400">{printer.ip}:{printer.porta || '9100'}</span>
                            )}
                            {printer.jaCadastrada && (
                              <span className="text-[10px] text-gray-400">Já cadastrada</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          if (printer.jaCadastrada) {
                            alert('Esta impressora já está cadastrada.');
                            return;
                          }
                          const newPrinter = {
                            id: Date.now().toString(),
                            nome: printer.nome,
                            tipo: printer.tipo,
                            status: 'online' as const,
                            localizacao: printer.origem || printer.localizacao || 'local',
                            ip: printer.ip,
                            porta: printer.porta,
                            fabricante: printer.fabricante,
                            data_instalacao: new Date().toISOString().split('T')[0]
                          };
                          const updated = [...printers, newPrinter];
                          setPrinters(updated);
                          localStorage.setItem('choferlog_printers', JSON.stringify(updated));
                          syncConfigToServer();
                          setFoundPrinters(foundPrinters.filter((_, i) => i !== idx));
                        }}
                        className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 transition-colors"
                      >
                        <Plus size={16} className="mr-1" /> Adicionar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-between items-center">
              <p className="text-xs text-gray-400">
                {isSearching ? 'Buscando...' : `${foundPrinters.length} impressora(s) encontrada(s)`}
              </p>
              <p className="text-xs text-gray-300">
                Clique fora para fechar
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};