import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, FileText, TrendingUp, Users, Building2, ArrowRight } from 'lucide-react';

export const PainelRelatorios: React.FC = () => {
  const navigate = useNavigate();

  const relatorios = [
    { nome: 'Relatório de Fretes', desc: 'Fretes por período com comissão, despesas e balanço completo', cor: 'text-blue-600 bg-blue-50', icon: FileText, rota: '/relatorios' },
    { nome: 'Relatório Financeiro', desc: 'Resumo consolidado de receitas, despesas e resultado por motorista', cor: 'text-green-600 bg-green-50', icon: TrendingUp, rota: '/relatorios' },
    { nome: 'Relatório de Motoristas', desc: 'Histórico detalhado de viagens e desempenho por motorista', cor: 'text-purple-600 bg-purple-50', icon: Users, rota: '/relatorios/resumo' },
    { nome: 'Relatório por Empresa', desc: 'Dados consolidados de fretes e despesas por período', cor: 'text-amber-600 bg-amber-50', icon: Building2, rota: '/relatorios' },
  ];

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center space-x-3 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="bg-gray-800 p-2 rounded-lg text-white"><Shield size={24} /></div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Relatórios</h1>
          <p className="text-sm text-gray-500">Relatórios financeiros e operacionais</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {relatorios.map(r => (
          <div key={r.nome} onClick={() => navigate(r.rota)} className="bg-white rounded-2xl border border-gray-100 p-6 hover:shadow-md hover:border-blue-200 transition-all cursor-pointer group">
            <div className="flex items-start justify-between">
              <div className={`p-3 rounded-xl ${r.cor}`}><r.icon size={24} /></div>
              <span className="p-2 bg-gray-50 group-hover:bg-blue-50 rounded-lg transition-colors">
                <ArrowRight size={18} className="text-gray-400 group-hover:text-blue-500 transition-colors" />
              </span>
            </div>
            <h3 className="text-lg font-bold text-gray-800 mt-3">{r.nome}</h3>
            <p className="text-sm text-gray-500 mt-1">{r.desc}</p>
            <div className="mt-4 flex items-center text-xs font-bold text-blue-500 group-hover:text-blue-600 transition-colors">
              <ArrowRight size={12} className="mr-1" /> Abrir relatório
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
