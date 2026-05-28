import React, { useState, useEffect } from 'react';
import { Shield, Search, CheckCircle, XCircle, Users, FileWarning } from 'lucide-react';
import api from '../api';

export const PainelMotoristas: React.FC = () => {
  const [motoristas, setMotoristas] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => { carregar(); }, []);

  async function carregar() {
    const response = await api.get('/painel-admin/motoristas');
    setMotoristas(response.data || []);
  }

  async function aprovar(id: string) {
    try { await api.put('/painel-admin/motoristas/' + id + '/aprovar'); carregar(); } catch {}
  }

  async function reprovar(id: string) {
    try { await api.put('/painel-admin/motoristas/' + id + '/reprovar'); carregar(); } catch {}
  }

  const filtered = motoristas.filter(m => (m.nome || '').toLowerCase().includes(searchTerm.toLowerCase()) || (m.email || '').includes(searchTerm));
  const pendentes = filtered.filter(m => m.status === 'pendente');
  const aprovados = filtered.filter(m => m.status === 'aprovado');

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center space-x-3 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="bg-gray-800 p-2 rounded-lg text-white"><Shield size={24} /></div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Motoristas</h1>
          <p className="text-sm text-gray-500">Gerenciar motoristas cadastrados</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-6 hover:shadow-md"><p className="text-3xl font-black text-gray-800">{motoristas.length}</p><p className="text-sm text-gray-500">Total</p></div>
        <div className="bg-white rounded-2xl border border-gray-100 p-6 hover:shadow-md"><p className="text-3xl font-black text-green-600">{aprovados.length}</p><p className="text-sm text-gray-500">Aprovados</p></div>
        <div className="bg-white rounded-2xl border border-gray-100 p-6 hover:shadow-md"><p className="text-3xl font-black text-amber-500">{pendentes.length}</p><p className="text-sm text-gray-500">Pendentes</p></div>
      </div>

      <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex items-center max-w-md">
        <Search size={18} className="text-gray-400 mr-2 flex-shrink-0" />
        <input type="text" placeholder="Buscar..." className="flex-1 outline-none text-gray-700 text-sm" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full text-left">
          <thead><tr className="bg-gray-50 text-gray-600 text-xs font-bold uppercase tracking-wider"><th className="p-4 border-b">Nome</th><th className="p-4 border-b">Email</th><th className="p-4 border-b">Empresa</th><th className="p-4 border-b">Status</th><th className="p-4 border-b text-center">Ações</th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map(m => (
              <tr key={m.id} className="hover:bg-gray-50/50">
                <td className="p-4"><p className="font-bold text-gray-800">{m.nome}</p><p className="text-xs text-gray-400">{m.cpf}</p></td>
                <td className="p-4 text-sm text-gray-600">{m.email}</td>
                <td className="p-4 text-sm text-gray-600">{m.empresas?.nome || '-'}</td>
                <td className="p-4">
                  {m.status === 'aprovado' ? <span className="flex items-center text-green-600 text-sm font-bold"><CheckCircle size={14} className="mr-1" />Aprovado</span> :
                   m.status === 'pendente' ? <span className="flex items-center text-amber-600 text-sm font-bold"><FileWarning size={14} className="mr-1" />Pendente</span> :
                   <span className="flex items-center text-red-600 text-sm font-bold"><XCircle size={14} className="mr-1" />Reprovado</span>}
                </td>
                <td className="p-4 text-center">
                  {m.status === 'pendente' ? (
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => aprovar(m.id)} className="px-3 py-1.5 text-xs font-bold bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center"><CheckCircle size={14} className="mr-1" />Aprovar</button>
                      <button onClick={() => reprovar(m.id)} className="px-3 py-1.5 text-xs font-bold bg-red-500 text-white rounded-lg hover:bg-red-600 flex items-center"><XCircle size={14} className="mr-1" />Reprovar</button>
                    </div>
                  ) : <span className="text-xs text-gray-400">—</span>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-gray-400">Nenhum motorista</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};
