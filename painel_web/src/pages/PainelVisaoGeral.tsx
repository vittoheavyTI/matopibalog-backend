import React, { useState, useEffect } from 'react';
import { Shield, Building2, Users, Truck, DollarSign, BarChart3, AlertTriangle, Clock, Activity } from 'lucide-react';
import api from '../api';

export const PainelVisaoGeral: React.FC = () => {
  const [stats, setStats] = useState([
    { label: 'Empresas Ativas', value: '0', change: 'Carregando...', icon: Building2, color: 'bg-blue-50 text-blue-600' },
    { label: 'Motoristas', value: '0', change: 'Carregando...', icon: Users, color: 'bg-green-50 text-green-600' },
    { label: 'Fretes Ativos', value: '0', change: 'Carregando...', icon: Truck, color: 'bg-purple-50 text-purple-600' },
    { label: 'Empresas em Trial', value: '0', change: 'Carregando...', icon: DollarSign, color: 'bg-amber-50 text-amber-600' },
  ]);
  const [empresas, setEmpresas] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      const [dashboardRes, empresasRes] = await Promise.all([
        api.get('/painel-admin/dashboard'),
        api.get('/painel-admin/empresas'),
      ]);
      const { totalEmpresas, totalMotoristas, totalFretes, empresasAtivas, empresasTrial } = dashboardRes.data;
      const empresasData = empresasRes.data;
      setEmpresas(empresasData || []);
      const ativas = (empresasData || []).filter((e: any) => e.status === 'ativa').length;
      const trial = (empresasData || []).filter((e: any) => e.status === 'trial').length;
      setStats([
        { label: 'Empresas Ativas', value: String(ativas), change: 'Cadastradas', icon: Building2, color: 'bg-blue-50 text-blue-600' },
        { label: 'Motoristas', value: String(totalMotoristas || 0), change: 'Sistema', icon: Users, color: 'bg-green-50 text-green-600' },
        { label: 'Fretes Ativos', value: String(totalFretes || 0), change: 'Em andamento', icon: Truck, color: 'bg-purple-50 text-purple-600' },
        { label: 'Empresas em Trial', value: String(trial), change: 'Período de teste', icon: DollarSign, color: 'bg-amber-50 text-amber-600' },
      ]);
    }
    load();
  }, []);

  const empresasTrial = empresas.filter(e => e.status === 'trial');

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center space-x-3 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="bg-gray-800 p-2 rounded-lg text-white"><Shield size={24} /></div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Visão Geral</h1>
          <p className="text-sm text-gray-500">Resumo da plataforma Matopiba Log</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 p-6 hover:shadow-md transition-all">
            <div className="flex items-center justify-between mb-4">
              <div className={`p-2.5 rounded-xl ${s.color}`}><s.icon size={22} /></div>
              <span className="text-xs text-gray-400 font-medium">{s.change}</span>
            </div>
            <p className="text-2xl font-bold text-gray-800">{s.value}</p>
            <p className="text-sm text-gray-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 p-6">
          <h3 className="font-bold text-gray-800 mb-4">Receita Mensal</h3>
          <div className="h-64 flex items-center justify-center bg-gray-50 rounded-xl border border-dashed border-gray-200">
            <div className="text-center text-gray-400"><BarChart3 size={48} className="mx-auto mb-2" /><p className="text-sm font-medium">Gráfico de receita</p></div>
          </div>
        </div>
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <h3 className="font-bold text-gray-800 mb-3 flex items-center"><Clock size={16} className="mr-1.5 text-amber-500" /> Empresas em Trial</h3>
            {empresasTrial.length === 0 ? <p className="text-sm text-gray-400 text-center py-4">Nenhuma</p> : empresasTrial.map((e: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-3 bg-amber-50 rounded-xl mb-2">
                <span className="text-sm font-medium text-gray-700">{e.nome}</span>
                <span className="text-xs font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">Trial</span>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <h3 className="font-bold text-gray-800 mb-3 flex items-center"><AlertTriangle size={16} className="mr-1.5 text-red-500" /> Alertas</h3>
            <div className="space-y-2">
              <div className="flex items-center space-x-2 p-2.5 bg-red-50 rounded-xl text-sm"><span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" /><span className="text-gray-700">Empresas ativas monitoradas</span></div>
              <div className="flex items-center space-x-2 p-2.5 bg-yellow-50 rounded-xl text-sm"><span className="w-2 h-2 rounded-full bg-yellow-500 flex-shrink-0" /><span className="text-gray-700">{empresasTrial.length} empresas em trial</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
