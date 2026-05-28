import React from 'react';
import { Check, Truck } from 'lucide-react';

const planos = [
  {
    nome: 'Básico',
    preco: 49.90,
    descricao: 'Para pequenas frotas',
    features: ['Até 3 motoristas', 'Gestão de fretes', 'Relatórios básicos', 'Suporte via email'],
    cor: '#3b82f6',
  },
  {
    nome: 'Profissional',
    preco: 99.90,
    descricao: 'Para frotas em crescimento',
    features: ['Até 10 motoristas', 'Gestão de fretes + despesas', 'Relatórios avançados', 'Suporte prioritário', 'App motorista'],
    cor: '#8b5cf6',
    destaque: true,
  },
  {
    nome: 'Empresarial',
    preco: 199.90,
    descricao: 'Para operações completas',
    features: ['Motoristas ilimitados', 'Todas as funcionalidades', 'API de integração', 'Suporte 24h', 'Personalização', 'Contrato digital'],
    cor: '#059669',
  },
];

export const PlanosPublicos: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
      <div className="max-w-7xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Truck className="text-blue-600" size={32} />
            <h1 className="text-3xl font-bold text-gray-900">Matopiba Log</h1>
          </div>
          <p className="text-xl text-gray-600">Planos para todos os tamanhos de frota</p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {planos.map((plano) => (
            <div
              key={plano.nome}
              className={`relative bg-white rounded-2xl shadow-lg p-8 flex flex-col transition-transform hover:scale-105 ${
                plano.destaque ? 'ring-2 ring-blue-500 shadow-xl' : ''
              }`}
            >
              {plano.destaque && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-4 py-1 rounded-full text-sm font-semibold">
                  Mais Popular
                </div>
              )}
              <h3 className="text-2xl font-bold text-gray-900 mb-2">{plano.nome}</h3>
              <p className="text-gray-500 mb-6">{plano.descricao}</p>
              <div className="mb-8">
                <span className="text-4xl font-bold text-gray-900">R$ {plano.preco.toFixed(2)}</span>
                <span className="text-gray-500">/mês</span>
              </div>
              <ul className="space-y-3 mb-8 flex-1">
                {plano.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-gray-700">
                    <Check size={18} className="text-green-500 shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <button
                className={`w-full py-3 rounded-xl text-white font-semibold transition-colors ${
                  plano.destaque ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-800 hover:bg-gray-900'
                }`}
                onClick={() => window.location.href = '/cadastro?plano=' + plano.nome.toLowerCase()}
              >
                Começar Agora
              </button>
            </div>
          ))}
        </div>

        <div className="text-center mt-12">
          <p className="text-gray-500">
            Já tem cadastro?{' '}
            <a href="/login" className="text-blue-600 hover:underline font-medium">Fazer Login</a>
          </p>
        </div>
      </div>
    </div>
  );
};
