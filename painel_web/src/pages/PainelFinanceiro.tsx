import React, { useState, useEffect } from 'react';
import { Shield, DollarSign, CreditCard, AlertTriangle } from 'lucide-react';
import api from '../api';

export const PainelFinanceiro: React.FC = () => {
  const [stats, setStats] = useState({ receitaTotal: 0, ativas: 0, inadimplentes: 0 });

  useEffect(() => {
    async function load() {
      const response = await api.get('/painel-admin/empresas');
      const empresas = response.data;
      const lista = empresas || [];
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
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Financeiro</h1>
          <p className="text-sm text-gray-500">Controle financeiro</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-6"><div className="flex items-center mb-3"><div className="p-2.5 bg-green-50 rounded-xl mr-3"><DollarSign size={22} className="text-green-600" /></div><p className="text-sm text-gray-500">Receita Mensal</p></div><p className="text-3xl font-black text-gray-800">R$ {stats.receitaTotal.toFixed(2)}</p></div>
        <div className="bg-white rounded-2xl border border-gray-100 p-6"><div className="flex items-center mb-3"><div className="p-2.5 bg-blue-50 rounded-xl mr-3"><CreditCard size={22} className="text-blue-600" /></div><p className="text-sm text-gray-500">Assinaturas Ativas</p></div><p className="text-3xl font-black text-blue-600">{stats.ativas}</p></div>
        <div className="bg-white rounded-2xl border border-gray-100 p-6"><div className="flex items-center mb-3"><div className="p-2.5 bg-red-50 rounded-xl mr-3"><AlertTriangle size={22} className="text-red-600" /></div><p className="text-sm text-gray-500">Inadimplentes</p></div><p className="text-3xl font-black text-red-600">{stats.inadimplentes}</p></div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-400">
        <div className="max-w-md mx-auto"><DollarSign size={48} className="mx-auto mb-3 text-gray-300" /><p className="font-medium">Gestão financeira detalhada em breve</p><p className="text-sm mt-1">Relatórios de receita, despesas e projeções</p></div>
      </div>
    </div>
  );
};
