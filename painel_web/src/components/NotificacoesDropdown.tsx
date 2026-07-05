import React, { useEffect, useRef, useState } from 'react';
import { Bell, Check, CheckCheck, Loader2 } from 'lucide-react';
import api from '../api';

type Notificacao = {
  id: string;
  tipo: string;
  titulo: string;
  mensagem: string;
  lida: boolean;
  created_at: string;
  read_at?: string | null;
};

export const NotificacoesDropdown: React.FC = () => {
  const [aberto, setAberto] = useState(false);
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const carregarContador = async () => {
    try {
      const { data } = await api.get('/notificacoes/nao-lidas/count');
      setNaoLidas(Number(data?.count) || 0);
    } catch {
      // O sino nao deve interromper o restante do painel se o endpoint falhar.
    }
  };

  const carregarLista = async () => {
    setCarregando(true);
    setErro('');
    try {
      const { data } = await api.get('/notificacoes', { params: { limite: 20 } });
      setNotificacoes(Array.isArray(data) ? data : []);
    } catch {
      setErro('Não foi possível carregar as notificações.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregarContador();
    const timer = window.setInterval(carregarContador, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (aberto) carregarLista();
  }, [aberto]);

  useEffect(() => {
    const fecharAoClicarFora = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', fecharAoClicarFora);
    return () => document.removeEventListener('mousedown', fecharAoClicarFora);
  }, []);

  const marcarLida = async (id: string) => {
    try {
      await api.patch(`/notificacoes/${id}/lida`);
      setNotificacoes((atuais) => atuais.map((item) =>
        item.id === id ? { ...item, lida: true, read_at: new Date().toISOString() } : item
      ));
      setNaoLidas((atual) => Math.max(0, atual - 1));
    } catch {
      setErro('Não foi possível marcar a notificação como lida.');
    }
  };

  const marcarTodas = async () => {
    try {
      await api.patch('/notificacoes/lidas');
      setNotificacoes((atuais) => atuais.map((item) => ({ ...item, lida: true })));
      setNaoLidas(0);
    } catch {
      setErro('Não foi possível marcar todas como lidas.');
    }
  };

  const dataAmigavel = (valor: string) => {
    const data = new Date(valor);
    return Number.isNaN(data.getTime())
      ? ''
      : data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={naoLidas > 0 ? `${naoLidas} notificações não lidas` : 'Notificações'}
        aria-expanded={aberto}
        onClick={() => setAberto((valor) => !valor)}
        className="relative p-2.5 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
      >
        <Bell size={21} />
        {naoLidas > 0 && (
          <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 flex items-center justify-center rounded-full bg-red-600 text-white text-[10px] font-bold">
            {naoLidas > 99 ? '99+' : naoLidas}
          </span>
        )}
      </button>

      {aberto && (
        <div className="absolute right-0 mt-2 w-[min(24rem,calc(100vw-2rem))] bg-white border border-gray-200 rounded-xl shadow-xl z-30 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div>
              <p className="font-bold text-gray-900">Notificações</p>
              <p className="text-xs text-gray-500">{naoLidas} não lida{naoLidas === 1 ? '' : 's'}</p>
            </div>
            {naoLidas > 0 && (
              <button type="button" onClick={marcarTodas} className="flex items-center gap-1 text-xs font-semibold text-green-700 hover:underline">
                <CheckCheck size={15} /> Marcar todas
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {carregando ? (
              <div className="flex items-center justify-center py-10 text-gray-500"><Loader2 className="animate-spin" size={24} /></div>
            ) : erro ? (
              <div className="p-5 text-center text-sm text-red-600">{erro}</div>
            ) : notificacoes.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">Nenhuma notificação por enquanto.</div>
            ) : notificacoes.map((item) => (
              <div key={item.id} className={`flex gap-3 p-4 border-b border-gray-100 last:border-0 ${item.lida ? 'bg-white' : 'bg-green-50/60'}`}>
                <span className={`mt-2 w-2 h-2 rounded-full flex-shrink-0 ${item.lida ? 'bg-gray-300' : 'bg-green-600'}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm text-gray-900 ${item.lida ? 'font-medium' : 'font-bold'}`}>{item.titulo}</p>
                  <p className="text-sm text-gray-600 mt-0.5">{item.mensagem}</p>
                  <p className="text-xs text-gray-400 mt-1">{dataAmigavel(item.created_at)}</p>
                </div>
                {!item.lida && (
                  <button type="button" title="Marcar como lida" onClick={() => marcarLida(item.id)} className="self-start p-1.5 text-green-700 hover:bg-green-100 rounded-lg">
                    <Check size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
