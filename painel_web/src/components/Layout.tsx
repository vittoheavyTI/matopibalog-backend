import React, { useState, useRef, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { SessionTimeoutWatcher } from './SessionTimeoutWatcher';
import { NotificacoesDropdown } from './NotificacoesDropdown';
import { useAuth } from '../contexts/AuthContext';
import { LogOut, User as UserIcon, ChevronDown } from 'lucide-react';

export const Layout: React.FC = () => {
  const { user, logout } = useAuth();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleLogout = () => {
    logout();
  };

  // Fecha o dropdown se clicar fora dele
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden" style={{ zoom: 1, maxWidth: '100vw' }}>
      {/* Logout automático por inatividade — ativo apenas no painel autenticado. */}
      <SessionTimeoutWatcher />
      <Sidebar />
      
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Cabeçalho Superior */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-end px-6 shadow-sm z-10">
          <div className="flex items-center gap-3">
            <NotificacoesDropdown />
            <div className="relative" ref={dropdownRef}>
            <button 
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex items-center space-x-3 hover:bg-gray-50 p-2 rounded-lg transition-colors border border-transparent hover:border-gray-200"
            >
              <div className="bg-blue-100 text-blue-600 rounded-full overflow-hidden w-9 h-9 flex items-center justify-center border border-blue-200">
                {user?.fotoUrl ? (
                  <img src={user.fotoUrl} alt="Perfil" className="w-full h-full object-cover" />
                ) : (
                  <UserIcon size={18} />
                )}
              </div>
              <span className="text-sm font-medium text-gray-700">
                {user?.nome || 'Usuário'}
              </span>
              <ChevronDown size={16} className={`text-gray-500 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Menu Dropdown */}
            {isDropdownOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-20 animate-fade-in-down">
                <div className="px-4 py-2 border-b border-gray-100">
                  <p className="text-xs text-gray-500">Logado como</p>
                  <p className="text-sm font-medium text-gray-900 truncate" title={user?.email || ''}>
                    {user?.email}
                  </p>
                </div>
                <button
                  onClick={handleLogout}
                  className="flex items-center space-x-2 w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  <LogOut size={16} />
                  <span>Sair do sistema</span>
                </button>
              </div>
            )}
            </div>
          </div>
        </header>

        {/* Área Principal de Conteúdo */}
        <main className="flex-1 overflow-auto p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
