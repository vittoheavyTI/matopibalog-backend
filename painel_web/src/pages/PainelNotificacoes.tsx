import React, { useState } from 'react';
import { Shield, Bell, Megaphone, AlertCircle, Check, Trash2 } from 'lucide-react';

type Notificacao = { id: number; tipo: 'info' | 'aviso' | 'alerta'; msg: string; tempo: string; lida: boolean };

const NOTIFICACOES_INICIAIS: Notificacao[] = [
  { id: 1, tipo: 'info', msg: 'Bem-vindo ao painel administrativo do Matopiba Log', tempo: 'Agora', lida: false },
  { id: 2, tipo: 'aviso', msg: 'Revise os motoristas pendentes de aprovação', tempo: '2h atrás', lida: false },
  { id: 3, tipo: 'alerta', msg: 'Verifique empresas com trial próximo do vencimento', tempo: '1d atrás', lida: false },
];

export const PainelNotificacoes: React.FC = () => {
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>(NOTIFICACOES_INICIAIS);

  const naoLidas = notificacoes.filter(n => !n.lida).length;

  const marcarComoLida = (id: number) =>
    setNotificacoes(prev => prev.map(n => n.id === id ? { ...n, lida: true } : n));

  const remover = (id: number) =>
    setNotificacoes(prev => prev.filter(n => n.id !== id));

  const marcarTodasLidas = () =>
    setNotificacoes(prev => prev.map(n => ({ ...n, lida: true })));

  const icones: Record<string, any> = { info: Bell, aviso: Megaphone, alerta: AlertCircle };
  const cores: Record<string, string> = {
    info: 'bg-blue-50 text-blue-600',
    aviso: 'bg-amber-50 text-amber-600',
    alerta: 'bg-red-50 text-red-600',
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center space-x-3 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="bg-gray-800 p-2 rounded-lg text-white"><Shield size={24} /></div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-800">Notificações</h1>
          <p className="text-sm text-gray-500">Central de notificações do sistema</p>
        </div>
        {naoLidas > 0 && (
          <div className="flex items-center gap-3">
            <span className="px-2.5 py-1 bg-red-100 text-red-600 text-xs font-bold rounded-full">{naoLidas} não lida{naoLidas !== 1 ? 's' : ''}</span>
            <button onClick={marcarTodasLidas} className="text-xs font-bold text-blue-600 hover:underline">Marcar todas como lidas</button>
          </div>
        )}
      </div>

      {notificacoes.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <Bell size={40} className="mx-auto mb-3 text-gray-300" />
          <p className="font-medium text-gray-500">Nenhuma notificação</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notificacoes.map(n => {
            const Icon = icones[n.tipo];
            return (
              <div key={n.id} className={`flex items-start space-x-4 bg-white rounded-2xl border p-5 transition-all ${n.lida ? 'border-gray-100 opacity-60' : 'border-gray-200 shadow-sm'}`}>
                <div className={`p-2.5 rounded-xl flex-shrink-0 ${cores[n.tipo]}`}><Icon size={20} /></div>
                <div className="flex-1 min-w-0">
                  <p className={`font-bold text-gray-800 ${n.lida ? 'font-medium' : ''}`}>{n.msg}</p>
                  <p className="text-xs text-gray-400 mt-1">{n.tempo}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {!n.lida && (
                    <button onClick={() => marcarComoLida(n.id)} title="Marcar como lida"
                      className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors">
                      <Check size={16} />
                    </button>
                  )}
                  <button onClick={() => remover(n.id)} title="Remover"
                    className="p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 rounded-lg transition-colors">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
