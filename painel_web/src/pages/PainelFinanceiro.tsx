import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Shield, DollarSign, CreditCard, AlertTriangle, CheckCircle, Clock, XCircle } from 'lucide-react';
import api from '../api';

export const PainelFinanceiro: React.FC = () => {
  const [stats, setStats] = useState({ receitaTotal: 0, ativas: 0, inadimplentes: 0 });
  const [empresas, setEmpresas] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      const response = await api.get('/painel-admin/empresas');
      const lista = response.data || [];
      setEmpresas(lista);
      const ativas = lista.filter((e: any) => e.status === 'ativo');
      const receita = ativas.reduce((acc: number, e: any) => acc + (parseFloat(e.planos?.preco_mensal || 0)), 0);
      setStats({ receitaTotal: receita, ativas: ativas.length, inadimplentes: lista.filter((e: any) => e.status === 'suspenso').length });
    }
    load();
  }, []);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center space-x-3 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="bg-gray-800 p-2 rounded-lg text-white"><Shield size={24} /></div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-800">Financeiro</h1>
          <p className="text-sm text-gray-500">
            Visão consolidada de receita e assinaturas — somente leitura. Para faturas use{' '}
            <Link to="/painel-administrativo/faturas" className="text-green-700 font-semibold hover:underline">Faturas</Link>{' '}·{' '}
            <Link to="/painel-administrativo/assinaturas" className="text-green-700 font-semibold hover:underline">Assinaturas</Link>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-4"><div className="flex items-center mb-2"><div className="p-2 bg-green-50 rounded-xl mr-3"><DollarSign size={20} className="text-green-600" /></div><p className="text-sm text-gray-500">Receita Mensal</p></div><p className="text-2xl font-black text-gray-800">R$ {stats.receitaTotal.toFixed(2)}</p></div>
        <div className="bg-white rounded-2xl border border-gray-100 p-4"><div className="flex items-center mb-2"><div className="p-2 bg-blue-50 rounded-xl mr-3"><CreditCard size={20} className="text-blue-600" /></div><p className="text-sm text-gray-500">Assinaturas Ativas</p></div><p className="text-2xl font-black text-blue-600">{stats.ativas}</p></div>
        <div className="bg-white rounded-2xl border border-gray-100 p-4"><div className="flex items-center mb-2"><div className="p-2 bg-red-50 rounded-xl mr-3"><AlertTriangle size={20} className="text-red-600" /></div><p className="text-sm text-gray-500">Inadimplentes</p></div><p className="text-2xl font-black text-red-600">{stats.inadimplentes}</p></div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800">Assinaturas — Detalhamento</h3>
          <span className="text-xs text-gray-400">{empresas.length} empresa{empresas.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50 text-gray-600 text-xs font-bold uppercase tracking-wider">
                <th className="px-4 py-2.5 border-b">Empresa</th>
                <th className="px-4 py-2.5 border-b">Plano</th>
                <th className="px-4 py-2.5 border-b">Status</th>
                <th className="px-4 py-2.5 border-b text-right">Valor Mensal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {empresas.map((e: any, i: number) => (
                <tr key={i} className="hover:bg-gray-50/50">
                  <td className="px-4 py-2.5">
                    <p className="font-semibold text-gray-800">{e.nome}</p>
                    <p className="text-xs text-gray-400">{e.cnpj || '—'}</p>
                  </td>
                  <td className="px-4 py-2.5 text-sm text-gray-600">{e.planos?.nome || <span className="text-gray-400 italic">Sem plano</span>}</td>
                  <td className="px-4 py-2.5">
                    {e.status === 'ativo'
                      ? <span className="flex items-center gap-1 text-green-600 text-xs font-bold"><CheckCircle size={13} />Ativo</span>
                      : e.status === 'trial'
                        ? <span className="flex items-center gap-1 text-amber-600 text-xs font-bold"><Clock size={13} />Trial</span>
                        : <span className="flex items-center gap-1 text-red-600 text-xs font-bold"><XCircle size={13} />Suspenso</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold text-gray-800">
                    {parseFloat(e.planos?.preco_mensal || 0) > 0
                      ? `R$ ${parseFloat(e.planos?.preco_mensal).toFixed(2)}`
                      : <span className="text-gray-400 font-normal">—</span>}
                  </td>
                </tr>
              ))}
              {empresas.length === 0 && (
                <tr><td colSpan={4} className="p-8 text-center text-gray-400">Nenhuma empresa cadastrada</td></tr>
              )}
            </tbody>
            {empresas.length > 0 && (
              <tfoot>
                <tr className="bg-gray-50 border-t-2 border-gray-200">
                  <td colSpan={3} className="px-4 py-2.5 text-sm font-bold text-gray-600 uppercase">Total Receita Mensal</td>
                  <td className="px-4 py-2.5 text-right text-lg font-black text-green-600">R$ {stats.receitaTotal.toFixed(2)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};
