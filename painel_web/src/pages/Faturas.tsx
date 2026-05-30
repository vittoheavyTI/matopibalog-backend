import React, { useState, useEffect } from 'react';
import api from '../api';
import { CreditCard, Download, Search } from 'lucide-react';

interface Fatura {
  id: string;
  empresa_id: string;
  asaas_id: string;
  valor: number;
  tipo_pagamento: 'PIX' | 'BOLETO' | 'CARTAO';
  status: 'pendente' | 'pago' | 'vencido' | 'cancelado' | 'estornado';
  invoice_url: string;
  pix_qr_code: string;
  due_date: string;
  pago_em: string;
  created_at: string;
  empresas?: { nome: string };
}

const statusMap: Record<string, { label: string; color: string }> = {
  pendente: { label: 'Pendente', color: 'bg-yellow-100 text-yellow-800' },
  pago: { label: 'Pago', color: 'bg-green-100 text-green-800' },
  vencido: { label: 'Vencido', color: 'bg-red-100 text-red-800' },
  cancelado: { label: 'Cancelado', color: 'bg-gray-100 text-gray-800' },
  estornado: { label: 'Estornado', color: 'bg-purple-100 text-purple-800' },
};

export const Faturas: React.FC = () => {
  const [faturas, setFaturas] = useState<Fatura[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    carregarFaturas();
  }, []);

  const carregarFaturas = async () => {
    try {
      const response = await api.get('/pagamentos/cobrancas/all');
      setFaturas(response.data || []);
    } catch (err) {
      console.error('Erro ao carregar faturas:', err);
    } finally {
      setLoading(false);
    }
  };

  const filtered = faturas.filter(f =>
    f.empresas?.nome?.toLowerCase().includes(search.toLowerCase()) ||
    f.asaas_id?.toLowerCase().includes(search.toLowerCase())
  );

  const totalPendente = faturas.filter(f => f.status === 'pendente').reduce((s, f) => s + Number(f.valor), 0);
  const totalPago = faturas.filter(f => f.status === 'pago').reduce((s, f) => s + Number(f.valor), 0);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <CreditCard className="text-blue-600" size={28} />
        <h1 className="text-2xl font-bold text-gray-900">Faturas</h1>
      </div>

      {/* Cards resumo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="text-sm text-gray-500">Total Pendente</div>
          <div className="text-2xl font-bold text-yellow-600">R$ {totalPendente.toFixed(2)}</div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="text-sm text-gray-500">Total Recebido</div>
          <div className="text-2xl font-bold text-green-600">R$ {totalPago.toFixed(2)}</div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="text-sm text-gray-500">Total Faturas</div>
          <div className="text-2xl font-bold text-blue-600">{faturas.length}</div>
        </div>
      </div>

      {/* Busca */}
      <div className="relative mb-4">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Buscar por empresa ou ID..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
        />
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-500">Nenhuma fatura encontrada.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left p-4 font-medium text-gray-600">Empresa</th>
                  <th className="text-left p-4 font-medium text-gray-600">Valor</th>
                  <th className="text-left p-4 font-medium text-gray-600">Tipo</th>
                  <th className="text-left p-4 font-medium text-gray-600">Status</th>
                  <th className="text-left p-4 font-medium text-gray-600">Vencimento</th>
                  <th className="text-left p-4 font-medium text-gray-600">Pagamento</th>
                  <th className="text-left p-4 font-medium text-gray-600">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((f) => {
                  const st = statusMap[f.status] || { label: f.status, color: 'bg-gray-100 text-gray-800' };
                  return (
                    <tr key={f.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="p-4 font-medium text-gray-900">{f.empresas?.nome || '—'}</td>
                      <td className="p-4 text-gray-700">R$ {Number(f.valor).toFixed(2)}</td>
                      <td className="p-4 text-gray-500">{f.tipo_pagamento || '—'}</td>
                      <td className="p-4"><span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span></td>
                      <td className="p-4 text-gray-500">{f.due_date ? new Date(f.due_date).toLocaleDateString('pt-BR') : '—'}</td>
                      <td className="p-4 text-gray-500">{f.pago_em ? new Date(f.pago_em).toLocaleDateString('pt-BR') : '—'}</td>
                      <td className="p-4">
                        <div className="flex gap-2">
                          {f.invoice_url && (
                            <a href={f.invoice_url} target="_blank" rel="noopener noreferrer" className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-blue-600">
                              <Download size={16} />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
