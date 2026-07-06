import React, { useEffect, useState } from 'react';
import { AlertCircle, Bell, Check, CheckCheck, Loader2, Shield } from 'lucide-react';
import api from '../api';

type Notificacao = {
  id: string;
  tipo: string;
  titulo: string;
  mensagem: string;
  lida: boolean;
  created_at: string;
};

export const PainelNotificacoes: React.FC = () => {
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const carregar = async () => {
    setCarregando(true);
    setErro('');
    try {
      const { data } = await api.get('/notificacoes', { params: { limite: 50 } });
      setNotificacoes(Array.isArray(data) ? data : []);
    } catch {
      setErro('Não foi possível carregar as notificações.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const naoLidas = notificacoes.filter((item) => !item.lida).length;

  const marcarComoLida = async (id: string) => {
    try {
      await api.patch(`/notificacoes/${id}/lida`);
      setNotificacoes((atuais) => atuais.map((item) => item.id === id ? { ...item, lida: true } : item));
    } catch {
      setErro('Não foi possível marcar a notificação como lida.');
    }
  };

  const marcarTodasLidas = async () => {
    try {
      await api.patch('/notificacoes/lidas');
      setNotificacoes((atuais) => atuais.map((item) => ({ ...item, lida: true })));
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
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-3 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="bg-gray-800 p-2 rounded-lg text-white"><Shield size={24} /></div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-800">Notificações</h1>
          <p className="text-sm text-gray-500">Histórico interno da sua conta</p>
        </div>
        {naoLidas > 0 && (
          <div className="flex items-center gap-3">
            <span className="px-2.5 py-1 bg-red-100 text-red-600 text-xs font-bold rounded-full">
              {naoLidas} não lida{naoLidas === 1 ? '' : 's'}
            </span>
            <button type="button" onClick={marcarTodasLidas} className="flex items-center gap-1 text-xs font-bold text-green-700 hover:underline">
              <CheckCheck size={15} /> Marcar todas
            </button>
          </div>
        )}
      </div>

      <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5 text-xs text-blue-700">
        <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
        <span>Envio manual de comunicados para clientes será disponibilizado em próxima versão.</span>
      </div>

      {erro && (
        <div className="flex items-center gap-2 bg-red-50 text-red-700 border border-red-200 rounded-xl p-4">
          <AlertCircle size={18} />
          <span className="text-sm">{erro}</span>
          <button type="button" onClick={carregar} className="ml-auto text-sm font-bold hover:underline">Tentar novamente</button>
        </div>
      )}

      {carregando ? (
        <div className="flex justify-center py-16 text-gray-500"><Loader2 className="animate-spin" size={32} /></div>
      ) : notificacoes.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
          <Bell size={36} className="mx-auto mb-2 text-gray-300" />
          <p className="font-medium text-gray-500">Nenhuma notificação por enquanto.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notificacoes.map((item) => (
            <div key={item.id} className={`flex items-start gap-4 bg-white rounded-2xl border p-4 transition-all ${item.lida ? 'border-gray-100 opacity-70' : 'border-green-200 shadow-sm'}`}>
              <div className={`p-2.5 rounded-xl flex-shrink-0 ${item.lida ? 'bg-gray-100 text-gray-500' : 'bg-green-50 text-green-700'}`}>
                <Bell size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-gray-800 ${item.lida ? 'font-medium' : 'font-bold'}`}>{item.titulo}</p>
                <p className="text-sm text-gray-600 mt-1">{item.mensagem}</p>
                <p className="text-xs text-gray-400 mt-2">{dataAmigavel(item.created_at)}</p>
              </div>
              {!item.lida && (
                <button type="button" onClick={() => marcarComoLida(item.id)} title="Marcar como lida" className="p-2 text-green-700 hover:bg-green-50 rounded-lg">
                  <Check size={17} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
