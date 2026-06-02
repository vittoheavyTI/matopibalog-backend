import React, { useState, useEffect } from 'react';
import { Shield, Search, CheckCircle, XCircle, Clock, CreditCard } from 'lucide-react';
import api from '../api';

export const PainelAssinaturas: React.FC = () => {
  const [assinaturas, setAssinaturas] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    async function load() {
      const response = await api.get('/painel-admin/empresas');
      const empresas = response.data;
      const lista = (empresas || []).map((e: any) => ({
        id: e.id,
        empresa: e.nome,
        cnpj: e.cnpj,
        plano: e.planos?.nome || 'Sem plano',
        valor: e.planos?.preco_mensal || 0,
        status: e.status || 'inativo',
        inicio: e.trial_started_at || e.created_at,
        vencimento: e.trial_ends_at || null,
      }));
      setAssinaturas(lista);
    }
    load();
  }, []);

  const filtered = assinaturas.filter(a =>
    a.empresa.toLowerCase().includes(searchTerm.toLowerCase()) ||
    a.plano.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const statusAtivas = filtered.filter(a => a.status === 'ativo').length;
  const receitaMensal = filtered.reduce((acc, a) => acc + (a.status === 'ativo' ? parseFloat(a.valor) : 0), 0);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center space-x-3 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="bg-gray-800 p-2 rounded-lg text-white"><Shield size={24} /></div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Assinaturas</h1>
          <p className="text-sm text-gray-500">Gerenciar assinaturas das empresas</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-6"><p className="text-3xl font-black text-gray-800">{assinaturas.length}</p><p className="text-sm text-gray-500">Total</p></div>
        <div className="bg-white rounded-2xl border border-gray-100 p-6"><p className="text-3xl font-black text-green-600">{statusAtivas}</p><p className="text-sm text-gray-500">Ativas</p></div>
        <div className="bg-white rounded-2xl border border-gray-100 p-6"><p className="text-3xl font-black text-blue-600">R$ {receitaMensal.toFixed(2)}</p><p className="text-sm text-gray-500">Receita Mensal</p></div>
      </div>

      <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex items-center max-w-md">
        <Search size={18} className="text-gray-400 mr-2 flex-shrink-0" />
        <input type="text" placeholder="Buscar..." className="flex-1 outline-none text-gray-700 text-sm" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-gray-50 text-gray-600 text-xs font-bold uppercase tracking-wider">
              <th className="p-4 border-b">Empresa</th><th className="p-4 border-b">Plano</th><th className="p-4 border-b">Valor</th><th className="p-4 border-b">Início</th><th className="p-4 border-b">Vencimento</th><th className="p-4 border-b">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map(a => (
              <tr key={a.id} className="hover:bg-gray-50/50">
                <td className="p-4"><div><p className="font-bold text-gray-800">{a.empresa}</p><p className="text-xs text-gray-400">{a.cnpj}</p></div></td>
                <td className="p-4"><span className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase bg-purple-50 text-purple-700"><CreditCard size={12} className="inline mr-1" />{a.plano}</span></td>
                <td className="p-4 font-bold text-gray-800">R$ {parseFloat(String(a.valor)).toFixed(2)}</td>
                <td className="p-4 text-sm text-gray-500">{a.inicio ? new Date(a.inicio).toLocaleDateString('pt-BR') : '-'}</td>
                <td className="p-4 text-sm text-gray-500">{a.vencimento ? new Date(a.vencimento).toLocaleDateString('pt-BR') : '-'}</td>
                <td className="p-4">{a.status === 'ativo' ? <span className="flex items-center text-green-600 text-sm font-bold"><CheckCircle size={14} className="mr-1" />Ativo</span> : a.status === 'trial' ? <span className="flex items-center text-amber-600 text-sm font-bold"><Clock size={14} className="mr-1" />Trial</span> : <span className="flex items-center text-red-600 text-sm font-bold"><XCircle size={14} className="mr-1" />Inativo</span>}</td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-gray-400">Nenhuma assinatura</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};
