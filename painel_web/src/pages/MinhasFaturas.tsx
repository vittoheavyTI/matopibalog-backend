import React, { useState, useEffect } from 'react';
import { Receipt, AlertCircle } from 'lucide-react';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';

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
}

const statusMap: Record<string, { label: string; color: string }> = {
  pendente: { label: 'Pendente', color: 'bg-yellow-100 text-yellow-800' },
  pago:     { label: 'Pago',     color: 'bg-green-100 text-green-800'  },
  vencido:  { label: 'Vencido',  color: 'bg-red-100 text-red-800'      },
  cancelado:{ label: 'Cancelado',color: 'bg-gray-100 text-gray-800'    },
  estornado:{ label: 'Estornado',color: 'bg-purple-100 text-purple-800'},
};

export const MinhasFaturas: React.FC = () => {
  const { user } = useAuth();
  const [faturas, setFaturas] = useState<Fatura[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid) return;
    setLoading(true);
    setErro(null);
    setFaturas([]);

    const carregarFaturas = async () => {
      try {
        // :empresa_id é ignorado pelo backend para admin comum —
        // verificarEmpresa usa sempre a empresa do token JWT.
        const res = await api.get(`/pagamentos/cobrancas/${user.uid}`);
        const dados: Fatura[] = res.data || [];
        // Ordenar por due_date antes de separar próxima/histórico
        dados.sort((a, b) => {
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
        });
        setFaturas(dados);
      } catch (err) {
        setErro('Não foi possível carregar suas faturas.');
      } finally {
        setLoading(false);
      }
    };

    carregarFaturas();
  }, [user?.uid]);

  const proximaFatura = faturas.find(f => f.status === 'pendente' || f.status === 'vencido');
  const historico     = faturas.filter(f => f !== proximaFatura);

  return (
    <div className="space-y-6 pb-20 px-6">

      <div className="flex items-center gap-3">
        <Receipt className="text-blue-600" size={28} />
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Minhas Faturas</h2>
          <p className="text-gray-500 text-sm">Acompanhe as faturas da sua empresa</p>
        </div>
      </div>

      {loading && (
        <div className="p-8 text-center text-gray-500">Carregando...</div>
      )}

      {erro && (
        <div className="flex items-center gap-2 p-4 bg-red-50 text-red-700 rounded-xl">
          <AlertCircle size={18} /> {erro}
        </div>
      )}

      {!loading && !erro && (
        <>
          {proximaFatura ? (
            <div className={`rounded-xl p-6 border-2 shadow-sm ${
              proximaFatura.status === 'vencido'
                ? 'border-red-300 bg-red-50'
                : 'border-yellow-300 bg-yellow-50'
            }`}>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
                {proximaFatura.status === 'vencido' ? '⚠️ Fatura Vencida' : 'Próxima Fatura'}
              </p>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="text-3xl font-bold text-gray-800">
                    R$ {Number(proximaFatura.valor).toFixed(2)}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    Vencimento:{' '}
                    {proximaFatura.due_date
                      ? new Date(proximaFatura.due_date + 'T00:00:00').toLocaleDateString('pt-BR')
                      : '—'}
                  </div>
                </div>
                <span className={`self-start sm:self-auto px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest ${statusMap[proximaFatura.status]?.color}`}>
                  {statusMap[proximaFatura.status]?.label}
                </span>
              </div>
            </div>
          ) : (
            <div className="rounded-xl p-5 bg-green-50 border border-green-200 text-green-700 text-sm font-medium">
              ✅ Nenhuma fatura pendente. Tudo em dia!
            </div>
          )}

          <div>
            <h3 className="text-base font-semibold text-gray-700 mb-3">Histórico</h3>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              {historico.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">
                  Nenhum histórico disponível.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-50 text-gray-600 text-xs font-bold uppercase tracking-wider">
                        <th className="p-4 border-b">Vencimento</th>
                        <th className="p-4 border-b">Tipo</th>
                        <th className="p-4 border-b">Valor</th>
                        <th className="p-4 border-b">Status</th>
                        <th className="p-4 border-b">Pago em</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {historico.map(f => {
                        const st = statusMap[f.status] || { label: f.status, color: 'bg-gray-100 text-gray-800' };
                        return (
                          <tr key={f.id} className="hover:bg-gray-50/50 transition-colors">
                            <td className="p-4 text-sm text-gray-700">
                              {f.due_date
                                ? new Date(f.due_date + 'T00:00:00').toLocaleDateString('pt-BR')
                                : '—'}
                            </td>
                            <td className="p-4 text-sm text-gray-500">{f.tipo_pagamento || '—'}</td>
                            <td className="p-4 text-sm font-bold text-gray-800">
                              R$ {Number(f.valor).toFixed(2)}
                            </td>
                            <td className="p-4">
                              <span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest ${st.color}`}>
                                {st.label}
                              </span>
                            </td>
                            <td className="p-4 text-sm text-gray-500">
                              {f.pago_em
                                ? new Date(f.pago_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
                                : '—'}
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
        </>
      )}
    </div>
  );
};
