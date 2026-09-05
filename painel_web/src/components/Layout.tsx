import React, { useState, useRef, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { SessionTimeoutWatcher } from './SessionTimeoutWatcher';
import { NotificacoesDropdown } from './NotificacoesDropdown';
import { OperationalContextSelector } from './OperationalContextSelector';
import { AiCopilot } from './AiCopilot';
import { useAuth } from '../contexts/AuthContext';
import { useContratacaoStatus } from '../hooks/useContratacaoStatus';
import { useAreaAuthority } from '../hooks/useAreaAuthority';
import { resolverEstadoComercial, copyComercial } from '../utils/commercialAccountState';
import api from '../api';
import { LogOut, User as UserIcon, ChevronDown, UserCog, AlertTriangle, FileSignature } from 'lucide-react';

function formatarDataTrial(valor?: string | null) {
  if (!valor) return null;
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return null;
  return new Intl.DateTimeFormat('pt-BR').format(data);
}

export const Layout: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // §11 — os banners comerciais oferecem CTAs ("Assinar contrato", "Contratar
  // agora") que chamam `/contratacao/*`. Sem autoridade de contratação, esse CTA
  // terminaria em 403: não se oferece um caminho que se sabe fechado.
  const { podeContratacao } = useAreaAuthority();
  const {
    pendenciaObrigatoria,
    trialAtivo,
    trialEndsAt,
    diasRestantes,
    podeContratar,
    trialExpirado,
    assinaturaPendente,
    podeDeclinar,
    planoId,
    quantidadeContratada,
  } = useContratacaoStatus({ enabled: podeContratacao });
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dataTrial = formatarDataTrial(trialEndsAt);
  const [acaoContratacao, setAcaoContratacao] = useState(false);

  const [aviso429, setAviso429] = useState<string | null>(null);
  const [avisoContratacao, setAvisoContratacao] = useState<string | null>(null);

  const handleLogout = () => {
    logout();
  };

  async function iniciarContratacao() {
    if (!planoId) {
      setAvisoContratacao('Plano atual indisponível para iniciar a contratação.');
      return;
    }
    setAcaoContratacao(true);
    setAvisoContratacao(null);
    try {
      await api.post('/contratacao/iniciar', {
        plano_id: planoId,
        ...(typeof quantidadeContratada === 'number' ? { quantidade_contratada: quantidadeContratada } : {}),
      });
      navigate('/minhas-faturas?aba=contratacao');
    } catch {
      setAvisoContratacao('Não foi possível iniciar a contratação agora.');
    } finally {
      setAcaoContratacao(false);
    }
  }

  async function naoContinuar() {
    setAcaoContratacao(true);
    setAvisoContratacao(null);
    try {
      await api.post('/contratacao/nao-continuar');
      window.location.reload();
    } catch {
      setAvisoContratacao('Não foi possível registrar sua decisão agora.');
    } finally {
      setAcaoContratacao(false);
    }
  }

  // Banner de rate limit (429): mensagem clara, SEM deslogar (a sessão segue viva).
  // Disparado pelo interceptor do api.ts via evento 'api:rate-limited'.
  useEffect(() => {
    const onRate = (e: Event) => {
      const msg = (e as CustomEvent).detail?.message
        || 'Muitas requisições. Aguarde alguns minutos e tente novamente.';
      setAviso429(msg);
    };
    window.addEventListener('api:rate-limited', onRate);
    return () => window.removeEventListener('api:rate-limited', onRate);
  }, []);
  useEffect(() => {
    if (!aviso429) return;
    const t = window.setTimeout(() => setAviso429(null), 6000);
    return () => window.clearTimeout(t);
  }, [aviso429]);

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
      {aviso429 && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 bg-amber-100 border border-amber-300 text-amber-800 text-sm font-medium rounded-lg px-4 py-2 shadow">
          {aviso429}
        </div>
      )}
      {/* Logout automático por inatividade — ativo apenas no painel autenticado. */}
      <SessionTimeoutWatcher />
      <Sidebar />
      
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Cabeçalho Superior */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-3 md:px-6 shadow-sm z-10">
          <OperationalContextSelector />
          <div className="flex items-center gap-3 ml-auto">
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
                  onClick={() => { setIsDropdownOpen(false); navigate('/configuracoes?aba=perfil'); }}
                  className="flex items-center space-x-2 w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <UserCog size={16} />
                  <span>Editar Perfil</span>
                </button>
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

        {/* Banner forte: contrato obrigatório pendente. Conduz para Faturas / Regularização.
            As escritas operacionais já são bloqueadas no backend (gate). */}
        {trialAtivo && !pendenciaObrigatoria && (
          <div className="bg-emerald-50 border-b border-emerald-200 px-4 md:px-8 py-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div className="flex items-start gap-2 text-emerald-800 flex-1">
                <FileSignature size={18} className="shrink-0 mt-0.5" />
                <p className="text-sm font-medium">
                  {assinaturaPendente
                    ? 'Sua contratação está iniciada. Finalize a assinatura quando quiser; seu teste segue ativo normalmente.'
                    : `Seu teste gratuito está ativo${dataTrial ? ` até ${dataTrial}` : ''}${typeof diasRestantes === 'number' ? `, com ${diasRestantes} dia${diasRestantes === 1 ? '' : 's'} restante${diasRestantes === 1 ? '' : 's'}` : ''}.`}
                </p>
              </div>
              {avisoContratacao && <div className="text-xs font-medium text-amber-700">{avisoContratacao}</div>}
              {assinaturaPendente && (
                <button
                  onClick={() => navigate('/minhas-faturas?aba=contratacao')}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold px-4 py-2 shrink-0"
                >
                  <FileSignature size={16} /> Finalizar contratação
                </button>
              )}
              {podeContratar && (
                <button
                  onClick={iniciarContratacao}
                  disabled={acaoContratacao}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold px-4 py-2 shrink-0"
                >
                  <FileSignature size={16} /> {acaoContratacao ? 'Iniciando...' : 'Contratar agora'}
                </button>
              )}
            </div>
          </div>
        )}

        {trialExpirado && !pendenciaObrigatoria && (
          <div className="bg-amber-50 border-b border-amber-300 px-4 md:px-8 py-3">
            <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-4">
              <div className="flex items-start gap-2 text-amber-800 flex-1">
                <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                <p className="text-sm font-medium">Seu período de teste terminou.</p>
              </div>
              {avisoContratacao && <div className="text-xs font-medium text-amber-700">{avisoContratacao}</div>}
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={iniciarContratacao}
                  disabled={acaoContratacao}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-sm font-semibold px-4 py-2 shrink-0"
                >
                  <FileSignature size={16} /> Continuar com o Matopiba Log
                </button>
                {podeDeclinar && (
                  <button
                    onClick={naoContinuar}
                    disabled={acaoContratacao}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white hover:bg-amber-100 text-amber-800 text-sm font-semibold px-4 py-2 shrink-0"
                  >
                    Não continuar
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* S1-HIGH-02 — esta copy era escrita à mão aqui, em paralelo à de
            MinhasFaturas, e as duas explicavam o MESMO fato de formas diferentes.
            Agora ambas derivam de `resolverEstadoComercial`; muda só o tamanho.
            §11: "formalizar a continuidade comercial" escondia o efeito operacional
            — a copy nova diz que ações podem ficar restritas, sem exagerar
            (leitura nunca é bloqueada pelo backend). */}
        {pendenciaObrigatoria && (
          <div className="bg-amber-50 border-b border-amber-300 px-4 md:px-8 py-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div className="flex items-start gap-2 text-amber-800 flex-1">
                <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                <p className="text-sm font-medium">
                  {copyComercial(
                    resolverEstadoComercial({ contratoPendente: true }),
                    'global',
                  ).texto}
                </p>
              </div>
              <button
                onClick={() => navigate('/minhas-faturas?aba=contratacao')}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold px-4 py-2 shrink-0"
              >
                <FileSignature size={16} /> Assinar contrato
              </button>
            </div>
          </div>
        )}

        {/* Área Principal de Conteúdo */}
        <main className="flex-1 overflow-auto p-4 md:p-8">
          <Outlet />
        </main>
      </div>

      {/* Copiloto Operacional (AI V1) — read-only; não bloqueia a navegação. */}
      <AiCopilot />
    </div>
  );
};
