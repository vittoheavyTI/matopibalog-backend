import React, { useState, useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, FileText, Truck, ChevronLeft, ChevronRight, Upload, X, Check, Trash2, Settings, UserCircle, Receipt, History, Building2, DollarSign, Bell, Plug, ClipboardList, Ticket, TrendingUp, TowerControl, Boxes, FileSignature, CreditCard, Network, ShieldCheck, Route as RouteIcon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useContratacaoStatus } from '../hooks/useContratacaoStatus';
import { usePortalGovernanca } from '../hooks/usePortalGovernanca';
import api from '../api';

const readLocalStorage = (key: string) => (typeof window !== 'undefined' ? localStorage.getItem(key) : null);

export const Sidebar: React.FC = () => {
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 768 : false));
  const [isNarrow, setIsNarrow] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 768 : false));
  const [logoBase64, setLogoBase64] = useState<string | null>(() => readLocalStorage('matopibalog_logo'));
  const [logoScale, setLogoScale] = useState<number>(() => Number(readLocalStorage('matopibalog_logo_scale') || 100));
  const [logoY, setLogoY] = useState<number>(() => Number(readLocalStorage('matopibalog_logo_y') || 0));
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Contratação vira etapa CONDICIONAL: só aparece no menu do cliente quando há
  // contrato obrigatório pendente de assinatura (ação necessária). Concluída,
  // some da sidebar. Super-admin não usa este item.
  const { pendenciaObrigatoria: contratacaoPendente } = useContratacaoStatus();
  const { governanca } = usePortalGovernanca();
  const [isEditingLogo, setIsEditingLogo] = useState(false);
  const [tempLogo, setTempLogo] = useState<string | null>(null);
  const [tempScale, setTempScale] = useState<number>(100);
  const [tempY, setTempY] = useState<number>(0);

  useEffect(() => {
    const syncViewport = () => {
      const narrow = window.innerWidth < 768;
      setIsNarrow(narrow);
      if (narrow) setCollapsed(true);
    };

    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, []);

  useEffect(() => {
    // 1) Leitura imediata do cache local (comportamento atual — mostra sem esperar a rede)
    // 2) Hidrata do backend (fonte durável) para sobreviver a troca de dispositivo /
    // cache limpo. Só sobrescreve quando vier valor real; falha de rede mantém o cache.
    api.get('/configuracoes')
      .then(({ data }) => {
        // Cache autoritativo POR TENANT: a config da empresa LOGADA manda. Com logo
        // → grava; SEM logo → LIMPA o cache. Sem isso, a próxima empresa no mesmo
        // navegador herdaria a logo da anterior (vazamento entre tenants) — inclusive
        // no cabeçalho dos relatórios em PDF, que leem este cache.
        if (data?.sidebarLogo) {
          setLogoBase64(data.sidebarLogo);
          localStorage.setItem('matopibalog_logo', data.sidebarLogo);
          if (data?.sidebarLogoScale !== undefined && data?.sidebarLogoScale !== null) {
            setLogoScale(Number(data.sidebarLogoScale));
            localStorage.setItem('matopibalog_logo_scale', String(data.sidebarLogoScale));
          }
          if (data?.sidebarLogoY !== undefined && data?.sidebarLogoY !== null) {
            setLogoY(Number(data.sidebarLogoY));
            localStorage.setItem('matopibalog_logo_y', String(data.sidebarLogoY));
          }
        } else {
          setLogoBase64(null);
          setLogoScale(100);
          setLogoY(0);
          localStorage.removeItem('matopibalog_logo');
          localStorage.removeItem('matopibalog_logo_scale');
          localStorage.removeItem('matopibalog_logo_y');
        }
      })
      .catch(() => {}); // offline / erro → mantém o cache local, não quebra nada
  }, []);

  // Logo da EMPRESA (per-tenant) — branding DOCUMENTAL, usado APENAS nos
  // relatórios/PDFs, NUNCA na Sidebar (que exibe só a logo GLOBAL do sistema).
  // Aqui apenas mantemos o cache dedicado `matopibalog_empresa_logo` correto e
  // multi-tenant, para que os relatórios da empresa logada saiam com a logo certa
  // mesmo sem passar por Configurações. Com logo → grava; SEM → limpa (não herda
  // logo de outra empresa). Sem estado/render aqui: trocar/remover a logo da
  // empresa não altera a Sidebar.
  useEffect(() => {
    api.get('/configuracoes/empresa')
      .then(({ data }) => {
        const logo = data && typeof data.logomarca === 'string' && data.logomarca.trim() ? data.logomarca : null;
        if (logo) localStorage.setItem('matopibalog_empresa_logo', logo);
        else localStorage.removeItem('matopibalog_empresa_logo');
      })
      .catch(() => {}); // offline / erro → mantém o cache local
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const processFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Por favor, selecione uma imagem válida.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setTempLogo(base64);
      setTempScale(100);
      setTempY(0);
      setIsEditingLogo(true);
    };
    reader.readAsDataURL(file);
  };

  const handleEditExisting = () => {
    if (logoBase64) {
      setTempLogo(logoBase64);
      setTempScale(logoScale);
      setTempY(logoY);
      setIsEditingLogo(true);
    }
  };

  const saveLogoSettings = () => {
    setLogoBase64(tempLogo);
    setLogoScale(tempScale);
    setLogoY(tempY);
    if (tempLogo) {
      localStorage.setItem('matopibalog_logo', tempLogo);
      localStorage.setItem('matopibalog_logo_scale', tempScale.toString());
      localStorage.setItem('matopibalog_logo_y', tempY.toString());
    }
    setIsEditingLogo(false);

    // Persiste no backend para sobreviver a troca de dispositivo / cache limpo
    const payload: { sidebarLogo?: string; sidebarLogoScale: number; sidebarLogoY: number } = {
      sidebarLogoScale: tempScale,
      sidebarLogoY: tempY,
    };
    if (tempLogo) payload.sidebarLogo = tempLogo;
    api.put('/configuracoes', payload).catch(() => {});
  };

  const removeLogo = () => {
    setLogoBase64(null);
    localStorage.removeItem('matopibalog_logo');
    localStorage.removeItem('matopibalog_logo_scale');
    localStorage.removeItem('matopibalog_logo_y');
    setIsEditingLogo(false);

    // Persiste remoção no backend (string vazia para apagar no servidor)
    api.put('/configuracoes', { sidebarLogo: '', sidebarLogoScale: 100, sidebarLogoY: 0 }).catch(() => {});
  };

  const estruturaLiberada = governanca?.entitlements?.estrutura_operacional?.permitido === true;

  // Navegação AGRUPADA por afinidade (macrofrente IA/Navegação). Rotas e itens
  // preservados — apenas organizados em seções com cabeçalho (oculto quando a
  // sidebar está recolhida). Estrutura Operacional do cliente vive junto de
  // Configurações e só aparece quando elegível; Faturas/Regularização é o hub
  // comercial (a aba "Plano e contratação" continua dentro dela).
  type GrupoNav = { titulo: string; itens: { to: string; icon: typeof LayoutDashboard; label: string }[] };

  // P2.9 — gate de menu por permissão efetiva V9 (backend é a autoridade real; isto só
  // esconde itens). Fallback: admin legado enxerga tudo até o efetivo ser populado.
  const can = (key: string): boolean =>
    user?.is_super_admin === true
    || (user?.effective_permissions
      ? user.effective_permissions[key] === true
      : user?.role === 'admin');

  const gruposCliente: GrupoNav[] = [
    { titulo: 'Operação', itens: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/relatorios/viagens', icon: Truck, label: 'Gerenciamento de Fretes' },
      ...(can('fleet.view') ? [
        { to: '/frota', icon: Boxes, label: 'Frota' },
      ] : []),
      ...(can('campaign.view') ? [
        { to: '/campanhas-escoamento', icon: ClipboardList, label: 'Campanhas de Escoamento' },
      ] : []),
      ...(can('reports.operational.view') ? [
        { to: '/relatorios/torre-controle', icon: TowerControl, label: 'Torre de Controle' },
      ] : []),
      ...(can('freight.view') ? [
        { to: '/rota', icon: RouteIcon, label: 'Rota inteligente' },
      ] : []),
      { to: '/relatorios/resumo', icon: History, label: 'Histórico de Fretes' },
      { to: '/relatorios', icon: FileText, label: 'Relatórios' },
      // Rentabilidade/Acerto são RELATÓRIOS FINANCEIROS → reports.financial.view.
      ...(can('reports.financial.view') ? [
        { to: '/relatorios/rentabilidade', icon: TrendingUp, label: 'Rentabilidade' },
        { to: '/relatorios/acerto-motoristas', icon: Receipt, label: 'Acerto de Motoristas' },
      ] : []),
    ] },
    { titulo: 'Cadastros', itens: [
      // Motoristas (lista) exige drivers.view; gestão exige drivers.manage (backend).
      ...(can('drivers.view') ? [{ to: '/motoristas', icon: Users, label: 'Motoristas' }] : []),
      // Usuários (lista) exige users.view; administração (mutations) exige users.manage.
      ...(can('users.view') ? [{ to: '/admins', icon: UserCircle, label: 'Usuários' }] : []),
      // Perfis e Permissões: exige permissions.manage (distinto de users.manage).
      ...(can('permissions.manage')
        ? [{ to: '/perfis-permissoes', icon: ShieldCheck, label: 'Perfis e Permissões' }] : []),
    ] },
    // Faturas SaaS / Regularização da própria empresa → finance.saas.view (admin por
    // template; autônomo dono por bypass). Distinto do financeiro operacional dos fretes.
    ...(can('finance.saas.view') ? [{ titulo: 'Financeiro', itens: [
      { to: '/minhas-faturas', icon: Receipt, label: 'Faturas / Regularização' },
    ] }] : []),
    { titulo: 'Configurações', itens: [
      // Configurações da empresa → company.settings.view.
      ...(can('company.settings.view') ? [{ to: '/configuracoes', icon: Settings, label: 'Configurações' }] : []),
      ...(estruturaLiberada ? [{ to: '/operacional', icon: Network, label: 'Estrutura Operacional' }] : []),
    ] },
  ];

  // Super-admin: mesmas páginas de antes, agora em seções claras (Visão, Empresas
  // & Operação, Comercial, Financeiro, Pessoas & Sistema, Configurações). Sem
  // duplicidade e sem remover acesso a nada.
  const gruposSuper: GrupoNav[] = [
    { titulo: 'Visão', itens: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    ] },
    { titulo: 'Empresas & Operação', itens: [
      { to: '/painel-administrativo/empresas', icon: Building2, label: 'Empresas e Autônomos' },
      { to: '/painel-administrativo/operacional', icon: Network, label: 'Estrutura Operacional' },
      { to: '/painel-administrativo/motoristas', icon: Users, label: 'Motoristas / Autônomos' },
      { to: '/relatorios/torre-controle', icon: TowerControl, label: 'Torre de Controle' },
      { to: '/rota', icon: RouteIcon, label: 'Rota inteligente' },
      { to: '/relatorios/resumo', icon: History, label: 'Histórico de Fretes' },
      { to: '/relatorios/acerto-motoristas', icon: Receipt, label: 'Acerto de Motoristas' },
    ] },
    { titulo: 'Comercial', itens: [
      { to: '/painel-administrativo/planos', icon: ClipboardList, label: 'Planos' },
      { to: '/painel-administrativo/funcionalidades', icon: Boxes, label: 'Funcionalidades e Add-ons' },
      { to: '/painel-administrativo/contratos', icon: FileSignature, label: 'Contratos' },
      { to: '/painel-administrativo/promocoes', icon: Ticket, label: 'Promoções' },
    ] },
    { titulo: 'Financeiro', itens: [
      { to: '/painel-administrativo/billing', icon: CreditCard, label: 'Billing' },
      { to: '/painel-administrativo/financeiro', icon: DollarSign, label: 'Financeiro' },
    ] },
    { titulo: 'Pessoas & Sistema', itens: [
      { to: '/painel-administrativo/usuarios', icon: UserCircle, label: 'Usuários' },
      { to: '/painel-administrativo/termos-lgpd', icon: FileText, label: 'Termos LGPD' },
      { to: '/painel-administrativo/notificacoes', icon: Bell, label: 'Notificações' },
      { to: '/integracoes', icon: Plug, label: 'Integrações' },
    ] },
    { titulo: 'Configurações', itens: [
      { to: '/configuracoes', icon: Settings, label: 'Configurações' },
    ] },
  ];

  const grupos = user?.is_super_admin ? gruposSuper : gruposCliente;

  // Item de menu uniforme: mesma fonte/peso/tamanho para todos, espaçamento vertical
  // enxuto (py-2) e ícones alinhados. Evita que os itens fiquem soltos.
  const compact = collapsed || isNarrow;
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-lg transition-colors text-sm font-medium ${compact ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'} ${isActive ? 'bg-green-700 text-white' : 'text-gray-300 hover:bg-gray-800'}`;

  return (
    <>
      <div style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#1e293b',
        color: 'white',
        width: compact ? 80 : 256,
        transition: 'width 0.3s'
      }}>
        {/* Logo fixo no topo */}
        <div style={{ flexShrink: 0, padding: compact ? '12px 8px' : '16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div
            className={`relative group ${!logoBase64 && user?.is_super_admin ? 'cursor-pointer' : ''}`}
            onClick={() => { if (!logoBase64 && user?.is_super_admin) fileInputRef.current?.click(); }}
            onDoubleClick={() => { if (user?.is_super_admin) handleEditExisting(); }}
            onDragOver={(e) => { if (user?.is_super_admin) e.preventDefault(); }}
            onDrop={(e) => { if (user?.is_super_admin) handleDrop(e); }}
          >
            <input type="file" accept="image/*" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
            {logoBase64 ? (
              <div className="flex items-center justify-center overflow-hidden rounded" style={{ height: compact ? 48 : 80 }}>
                {/* Sidebar exibe SOMENTE a logo GLOBAL do sistema (identidade da aplicação),
                    com a escala/posição salvas. A logo da empresa é branding documental
                    (relatórios/PDFs), nunca aqui. */}
                <img src={logoBase64} alt="Logo" style={{ transform: `scale(${logoScale / 100}) translateY(${logoY}px)`, transformOrigin: 'center' }} className="max-w-full max-h-full object-contain" />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-700 rounded text-gray-500 hover:text-gray-300 hover:border-gray-500 transition-colors" style={{ height: compact ? 48 : 80 }}>
                <Upload size={compact ? 16 : 24} />
                {!compact && <span className="text-xs font-medium mt-1">Adicionar Logo</span>}
              </div>
            )}
          </div>
        </div>

        {/* Menu scrollável — scrollbar fina/discreta para o super-admin (lista longa),
            oculta nos demais perfis (menu curto). */}
        <div
          className={
            user?.is_super_admin
              ? '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full'
              : '[&::-webkit-scrollbar]:hidden'
          }
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: compact ? '8px 4px' : '8px',
            scrollbarWidth: user?.is_super_admin ? 'thin' : 'none',
            scrollbarColor: user?.is_super_admin ? 'rgba(255,255,255,0.25) transparent' : undefined,
          }}
        >
          <nav className="space-y-3">
            {grupos.filter((grupo) => grupo.itens.length > 0).map((grupo) => (
              <div key={grupo.titulo} className="space-y-1">
                {!compact && (
                  <p className="px-3 pt-1 text-[10px] font-bold uppercase tracking-wider text-gray-500 select-none">{grupo.titulo}</p>
                )}
                {grupo.itens.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.to === '/' || item.to === '/relatorios'} className={linkClass} title={compact ? item.label : undefined}>
                    <item.icon size={20} className="flex-shrink-0" />
                    {!compact && <span>{item.label}</span>}
                  </NavLink>
                ))}
                {/* Contratação pendente (ação necessária): fica no grupo Financeiro do
                    cliente. Aparece só quando há contrato obrigatório pendente. */}
                {grupo.titulo === 'Financeiro' && !user?.is_super_admin && contratacaoPendente && (
                  <NavLink to="/minhas-faturas?aba=contratacao" className={linkClass} title={compact ? 'Contratação — ação necessária' : undefined}>
                    <span className="relative flex-shrink-0">
                      <ClipboardList size={20} />
                      <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-slate-800" />
                    </span>
                    {!compact && (
                      <span className="flex-1">
                        Contratação
                        <span className="ml-2 rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300 align-middle">Ação necessária</span>
                      </span>
                    )}
                  </NavLink>
                )}
              </div>
            ))}

            {/* Salvaguarda: se o cliente NÃO é admin (ex.: dono de conta autônoma,
                tipo motorista) mas tem contratação obrigatória pendente, não há grupo
                Financeiro — mostra o atalho de contratação mesmo assim. */}
            {!user?.is_super_admin && user?.role !== 'admin' && contratacaoPendente && (
              <div className="space-y-1">
                <NavLink to="/minhas-faturas?aba=contratacao" className={linkClass} title={compact ? 'Contratação — ação necessária' : undefined}>
                  <span className="relative flex-shrink-0">
                    <ClipboardList size={20} />
                    <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-slate-800" />
                  </span>
                  {!compact && (
                    <span className="flex-1">
                      Contratação
                      <span className="ml-2 rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300 align-middle">Ação necessária</span>
                    </span>
                  )}
                </NavLink>
              </div>
            )}
          </nav>
        </div>

        {/* Footer fixo */}
        <div style={{ flexShrink: 0, padding: '8px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center justify-center w-full p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
          >
            {compact ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
            {!compact && <span className="ml-2 text-sm">Recolher</span>}
          </button>
        </div>
      </div>

      {/* Modal de edição de logo */}
      {isEditingLogo && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in-down">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden text-gray-800">
            <div className="flex justify-between items-center p-4 border-b border-gray-100">
              <h3 className="font-bold text-lg">Ajustar Logomarca</h3>
              <button onClick={() => setIsEditingLogo(false)} className="p-1 hover:bg-gray-100 rounded"><X size={20} className="text-gray-500" /></button>
            </div>
            <div className="p-6 space-y-6">
              <div>
                <p className="text-sm text-gray-500 mb-2 font-medium">Pré-visualização</p>
                <div className="bg-gray-900 rounded-lg w-64 h-32 mx-auto flex items-center justify-center overflow-hidden border-2 border-dashed border-gray-300 relative">
                  {tempLogo && (
                    <img src={tempLogo} alt="Preview" style={{ transform: `scale(${tempScale / 100}) translateY(${tempY}px)`, transformOrigin: 'center' }} className="max-w-full max-h-full object-contain" />
                  )}
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1"><span className="font-medium text-gray-700">Tamanho (Zoom)</span><span className="text-gray-500">{tempScale}%</span></div>
                  <input type="range" min="50" max="250" value={tempScale} onChange={e => setTempScale(Number(e.target.value))} className="w-full accent-blue-600" />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1"><span className="font-medium text-gray-700">Posição Vertical</span><span className="text-gray-500">{tempY}px</span></div>
                  <input type="range" min="-50" max="50" value={tempY} onChange={e => setTempY(Number(e.target.value))} className="w-full accent-blue-600" />
                </div>
              </div>
            </div>
            <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-between items-center">
              <button onClick={removeLogo} className="flex items-center space-x-2 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors text-sm font-medium"><Trash2 size={16} /><span>Excluir Logo</span></button>
              <div className="flex space-x-2">
                <button onClick={() => setIsEditingLogo(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors text-sm font-medium">Cancelar</button>
                <button onClick={saveLogoSettings} className="flex items-center space-x-2 px-4 py-2 bg-green-700 hover:bg-green-800 text-white rounded-lg transition-colors text-sm font-medium"><Check size={16} /><span>Salvar Alterações</span></button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
