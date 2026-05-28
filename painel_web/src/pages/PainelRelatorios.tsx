import React from 'react';
import { Shield, FileText, Download, Filter } from 'lucide-react';

export const PainelRelatorios: React.FC = () => {
  const relatorios = [
    { nome: 'Relatório de Fretes', desc: 'Fretes realizados por período', cor: 'text-blue-600 bg-blue-50' },
    { nome: 'Relatório Financeiro', desc: 'Receitas, despesas e balanço', cor: 'text-green-600 bg-green-50' },
    { nome: 'Relatório de Motoristas', desc: 'Atividades dos motoristas', cor: 'text-purple-600 bg-purple-50' },
    { nome: 'Relatório por Empresa', desc: 'Dados consolidados por empresa', cor: 'text-amber-600 bg-amber-50' },
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
          <div key={r.nome} className="bg-white rounded-2xl border border-gray-100 p-6 hover:shadow-md transition-all cursor-pointer">
            <div className="flex items-start justify-between">
              <div className={`p-3 rounded-xl ${r.cor}`}><FileText size={24} /></div>
              <span className="p-2 hover:bg-gray-100 rounded-lg"><Download size={18} className="text-gray-400" /></span>
            </div>
            <h3 className="text-lg font-bold text-gray-800 mt-3">{r.nome}</h3>
            <p className="text-sm text-gray-500 mt-1">{r.desc}</p>
            <div className="mt-3 flex items-center text-xs text-gray-400"><Filter size={12} className="mr-1" />Filtrar por período</div>
          </div>
        ))}
      </div>
    </div>
  );
};
