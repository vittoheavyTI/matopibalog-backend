import React from 'react';
import { Shield, Bell, Megaphone, AlertCircle } from 'lucide-react';

export const PainelNotificacoes: React.FC = () => {
  const notificacoes = [
    { tipo: 'info', msg: 'Bem-vindo ao Matopiba Log', tempo: 'Agora' },
    { tipo: 'aviso', msg: 'Revise os motoristas pendentes', tempo: '2h atrás' },
    { tipo: 'alerta', msg: 'Empresa XPTO em trial há 6 dias', tempo: '1d atrás' },
  ];

  const icones: Record<string, any> = { info: Bell, aviso: Megaphone, alerta: AlertCircle };
  const cores: Record<string, string> = { info: 'bg-blue-50 text-blue-600', aviso: 'bg-amber-50 text-amber-600', alerta: 'bg-red-50 text-red-600' };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center space-x-3 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="bg-gray-800 p-2 rounded-lg text-white"><Shield size={24} /></div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Notificações</h1>
          <p className="text-sm text-gray-500">Central de notificações</p>
        </div>
      </div>

      <div className="space-y-3">
        {notificacoes.map((n, i) => {
          const Icon = icones[n.tipo];
          return (
            <div key={i} className="flex items-start space-x-4 bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-md transition-all">
              <div className={`p-2.5 rounded-xl ${cores[n.tipo]}`}><Icon size={20} /></div>
              <div className="flex-1"><p className="font-bold text-gray-800">{n.msg}</p><p className="text-xs text-gray-400 mt-1">{n.tempo}</p></div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
