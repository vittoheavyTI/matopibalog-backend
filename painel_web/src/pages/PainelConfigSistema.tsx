import React, { useState, useEffect } from 'react';
import { Shield, Save, Check, AlertTriangle } from 'lucide-react';
import api from '../api';

export const PainelConfigSistema: React.FC = () => {
  const [config, setConfig] = useState({
    nome_sistema: 'Matopiba Log',
    email_suporte: 'suporte@matopibalog.com.br',
    trial_dias: '7',
    manutencao: false,
    registros_abertos: true,
  });
  const [toast, setToast] = useState<{ message: string; tipo: 'sucesso' | 'erro' } | null>(null);

  useEffect(() => {
    api.get('/configuracoes').then((response) => {
      if (response.data) setConfig({ ...config, ...response.data });
    });
  }, []);

  async function salvar() {
    try { await api.put('/configuracoes', config); } catch { setToast({ message: 'Erro ao salvar', tipo: 'erro' }); return; }
    setToast({ message: 'Configurações salvas!', tipo: 'sucesso' });
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {toast && (
        <div className={`fixed top-6 right-6 z-[100] flex items-center space-x-2 px-5 py-3 rounded-xl shadow-2xl text-sm font-bold ${toast.tipo === 'sucesso' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.tipo === 'sucesso' ? <Check size={18} /> : <AlertTriangle size={18} />}
          <span>{toast.message}</span>
        </div>
      )}

      <div className="flex items-center space-x-3 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="bg-gray-800 p-2 rounded-lg text-white"><Shield size={24} /></div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Config. Sistema</h1>
          <p className="text-sm text-gray-500">Configurações do sistema</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-6 max-w-2xl space-y-5">
        <div><label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Nome do Sistema</label><input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={config.nome_sistema} onChange={e => setConfig({ ...config, nome_sistema: e.target.value })} /></div>
        <div><label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Email de Suporte</label><input type="email" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={config.email_suporte} onChange={e => setConfig({ ...config, email_suporte: e.target.value })} /></div>
        <div><label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Dias de Trial</label><input type="number" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={config.trial_dias} onChange={e => setConfig({ ...config, trial_dias: e.target.value })} /></div>
        {[
          { label: 'Modo Manutenção', key: 'manutencao' },
          { label: 'Registros Abertos', key: 'registros_abertos' },
        ].map(t => (
          <div key={t.key} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
            <span className="text-sm font-medium text-gray-700">{t.label}</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={(config as any)[t.key]} onChange={e => setConfig({ ...config, [t.key]: e.target.checked })} />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
        ))}
        <div className="pt-2"><button onClick={salvar} className="flex items-center px-6 py-3 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700"><Save size={18} className="mr-2" /> Salvar Configurações</button></div>
      </div>
    </div>
  );
};
