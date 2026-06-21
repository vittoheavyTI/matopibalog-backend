import React, { useState, useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, FileText, Truck, ChevronLeft, ChevronRight, Upload, X, Check, Trash2, Settings, UserCircle, Plug, Shield, ChevronDown, Receipt } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../api';

export const Sidebar: React.FC = () => {
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [painelOpen, setPainelOpen] = useState(false);
  const [logoBase64, setLogoBase64] = useState<string | null>(null);
  const [logoScale, setLogoScale] = useState<number>(100);
  const [logoY, setLogoY] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isEditingLogo, setIsEditingLogo] = useState(false);
  const [tempLogo, setTempLogo] = useState<string | null>(null);
  const [tempScale, setTempScale] = useState<number>(100);
  const [tempY, setTempY] = useState<number>(0);

  useEffect(() => {
    // 1) Leitura imediata do cache local (comportamento atual — mostra sem esperar a rede)
    const savedLogo = localStorage.getItem('matopibalog_logo');
    if (savedLogo) setLogoBase64(savedLogo);
    const savedScale = localStorage.getItem('matopibalog_logo_scale');
    if (savedScale) setLogoScale(Number(savedScale));
    const savedY = localStorage.getItem('matopibalog_logo_y');
    if (savedY) setLogoY(Number(savedY));

    // 2) Hidrata do backend (fonte durável) para sobreviver a troca de dispositivo /
    // cache limpo. Só sobrescreve quando vier valor real; falha de rede mantém o cache.
    api.get('/configuracoes')
      .then(({ data }) => {
        if (data?.sidebarLogo) {
          setLogoBase64(data.sidebarLogo);
          localStorage.setItem('matopibalog_logo', data.sidebarLogo);
        }
        if (data?.sidebarLogoScale !== undefined && data?.sidebarLogoScale !== null) {
          setLogoScale(Number(data.sidebarLogoScale));
          localStorage.setItem('matopibalog_logo_scale', String(data.sidebarLogoScale));
        }
        if (data?.sidebarLogoY !== undefined && data?.sidebarLogoY !== null) {
          setLogoY(Number(data.sidebarLogoY));
          localStorage.setItem('matopibalog_logo_y', String(data.sidebarLogoY));
        }
      })
      .catch(() => {}); // offline / erro → mantém o cache local, não quebra nada
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
    const payload: Record<string, any> = {};
    for (const [chave, valor] of Object.entries({ sidebarLogo: tempLogo || null, sidebarLogoScale: tempScale, sidebarLogoY: tempY })) {
      if (valor !== null && valor !== undefined) payload[chave] = valor;
    }
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

  const mainNav = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/motoristas', icon: Users, label: 'Motoristas' },
    { to: '/relatorios/viagens', icon: Truck, label: 'Fretes' },
    { to: '/relatorios', icon: FileText, label: 'Relatórios' },
    { to: '/admins', icon: UserCircle, label: 'Usuários' },
  ];

  const painelSubItems = [
    { to: '/painel-administrativo/visao-geral', label: 'Visão Geral' },
    { to: '/painel-administrativo/empresas', label: 'Empresas' },
    { to: '/painel-administrativo/planos', label: 'Planos' },
    { to: '/painel-administrativo/assinaturas', label: 'Assinaturas' },
    { to: '/painel-administrativo/usuarios', label: 'Usuários do Painel' },
    { to: '/painel-administrativo/motoristas', label: 'Motoristas' },
    { to: '/painel-administrativo/relatorios', label: 'Relatórios' },
    { to: '/painel-administrativo/financeiro', label: 'Financeiro' },
    { to: '/painel-administrativo/configuracoes', label: 'Config. Sistema' },
    { to: '/painel-administrativo/notificacoes', label: 'Notificações' },
  ];

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center space-x-3 rounded-lg transition-colors ${collapsed ? 'justify-center px-0 py-3' : 'px-4 py-3'} ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'}`;

  const subLinkClass = ({ isActive }: { isActive: boolean }) =>
    `block px-3 py-2 rounded-lg text-sm transition-colors ${isActive ? 'bg-blue-600/30 text-white font-medium' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`;

  return (
    <>
      <div style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#1e293b',
        color: 'white',
        width: collapsed ? 80 : 256,
        transition: 'width 0.3s'
      }}>
        {/* Logo fixo no topo */}
        <div style={{ flexShrink: 0, padding: collapsed ? '12px 8px' : '16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div
            className={`relative group ${!logoBase64 && user?.is_super_admin ? 'cursor-pointer' : ''}`}
            onClick={() => { if (!logoBase64 && user?.is_super_admin) fileInputRef.current?.click(); }}
            onDoubleClick={() => { if (user?.is_super_admin) handleEditExisting(); }}
            onDragOver={(e) => { if (user?.is_super_admin) e.preventDefault(); }}
            onDrop={(e) => { if (user?.is_super_admin) handleDrop(e); }}
          >
            <input type="file" accept="image/*" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
            {logoBase64 ? (
              <div className="flex items-center justify-center overflow-hidden rounded" style={{ height: collapsed ? 48 : 80 }}>
                <img src={logoBase64} alt="Logo" style={{ transform: `scale(${logoScale / 100}) translateY(${logoY}px)`, transformOrigin: 'center' }} className="max-w-full max-h-full object-contain" />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-700 rounded text-gray-500 hover:text-gray-300 hover:border-gray-500 transition-colors" style={{ height: collapsed ? 48 : 80 }}>
                <Upload size={collapsed ? 16 : 24} />
                {!collapsed && <span className="text-xs font-medium mt-1">Adicionar Logo</span>}
              </div>
            )}
          </div>
        </div>

        {/* Menu scrollável */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: collapsed ? '8px 4px' : '8px' }}>
          <nav className="space-y-1">
            {mainNav.map(item => (
              <NavLink key={item.to} to={item.to} end={item.to === '/' || item.to === '/relatorios'} className={linkClass} title={collapsed ? item.label : undefined}>
                <item.icon size={20} className="flex-shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </NavLink>
            ))}

            {/* Painel Admin - Expansível (apenas super-admin) */}
            {user?.is_super_admin && (
            <div>
              <button
                onClick={() => setPainelOpen(!painelOpen)}
                className={`flex items-center w-full rounded-lg transition-colors ${collapsed ? 'justify-center px-0 py-3' : 'px-4 py-3'} text-gray-300 hover:bg-gray-800`}
                title={collapsed ? 'Painel Admin.' : undefined}
              >
                <Shield size={20} className="flex-shrink-0" />
                {!collapsed && <span className="flex-1 text-left ml-3">Painel Admin.</span>}
                {!collapsed && (
                  <ChevronDown size={16} style={{ transform: painelOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                )}
              </button>

              {painelOpen && !collapsed && (
                <div style={{ paddingLeft: '16px' }} className="mt-1 space-y-1">
                  {painelSubItems.map(item => (
                    <NavLink key={item.to} to={item.to} className={subLinkClass}>
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
            )}

            {user?.is_super_admin && (
              <NavLink to="/integracoes" className={linkClass} title={collapsed ? 'Integrações' : undefined}>
                <Plug size={20} className="flex-shrink-0" />
                {!collapsed && <span>Integrações</span>}
              </NavLink>
            )}

            <NavLink
              to="/minhas-faturas"
              className={linkClass}
              title={collapsed ? 'Minhas Faturas' : undefined}
            >
              <Receipt size={20} className="flex-shrink-0" />
              {!collapsed && <span>Minhas Faturas</span>}
            </NavLink>

            <NavLink to="/configuracoes" className={linkClass} title={collapsed ? 'Configurações' : undefined}>
              <Settings size={20} className="flex-shrink-0" />
              {!collapsed && <span>Configurações</span>}
            </NavLink>
          </nav>
        </div>

        {/* Footer fixo */}
        <div style={{ flexShrink: 0, padding: '8px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center justify-center w-full p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
          >
            {collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
            {!collapsed && <span className="ml-2 text-sm">Recolher</span>}
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
                <button onClick={saveLogoSettings} className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium"><Check size={16} /><span>Salvar Alterações</span></button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
