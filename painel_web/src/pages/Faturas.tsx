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
  empresas?: {
    nome: string;
    tipo: string;
    status: string;
    plano_id: string | null;
    planos?: { nome: string } | null;
  };
}

const statusMap: Record<string, { label: string; color: string }> = {
  pendente: { label: 'Pendente', color: 'bg-yellow-100 text-yellow-800' },
  pago: { label: 'Pago', color: 'bg-green-100 text-green-800' },
  vencido: { label: 'Vencido', color: 'bg-red-100 text-red-800' },
  cancelado: { label: 'Cancelado', color: 'bg-gray-100 text-gray-800' },
  estornado: { label: 'Estornado', color: 'bg-purple-100 text-purple-800' },
};

export const Faturas: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const [faturas, setFaturas] = useState<Fatura[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState('todos');
  const [statusFiltro, setStatusFiltro] = useState('todos');
  const [vencimentoFiltro, setVencimentoFiltro] = useState('todos');
  const [planoFiltro, setPlanoFiltro] = useState('todos');

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

  const planos = Array.from(new Set(faturas.map(f => f.empresas?.planos?.nome).filter(Boolean) as string[])).sort();
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const filtered = faturas.filter(f => {
    const busca = search.toLowerCase();
    const porBusca = f.empresas?.nome?.toLowerCase().includes(busca) || f.asaas_id?.toLowerCase().includes(busca);
    const porTipo = tipoFiltro === 'todos'
      || (tipoFiltro === 'autonomos' ? f.empresas?.tipo === 'autonomo' : f.empresas?.tipo !== 'autonomo');
    const porStatus = statusFiltro === 'todos' || f.status === statusFiltro;
    const porPlano = planoFiltro === 'todos' || f.empresas?.planos?.nome === planoFiltro;
    const vencimento = f.due_date ? new Date(`${f.due_date}T00:00:00`) : null;
    const diasAteVencer = vencimento ? Math.ceil((vencimento.getTime() - hoje.getTime()) / 86400000) : null;
    const porVencimento = vencimentoFiltro === 'todos'
      || (vencimentoFiltro === 'vencidas' && diasAteVencer !== null && diasAteVencer < 0)
      || (vencimentoFiltro === 'proximos7' && diasAteVencer !== null && diasAteVencer >= 0 && diasAteVencer <= 7)
      || (vencimentoFiltro === 'sem_data' && !vencimento);
    return Boolean(porBusca && porTipo && porStatus && porPlano && porVencimento);
  });

  const totalPendente = faturas.filter(f => f.status === 'pendente').reduce((s, f) => s + Number(f.valor), 0);
  const totalPago = faturas.filter(f => f.status === 'pago').reduce((s, f) => s + Number(f.valor), 0);

  return (
    <div className="space-y-4 animate-fade-in">
      {!embedded && <div className="flex items-center space-x-3 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="bg-gray-800 p-2 rounded-lg text-white"><CreditCard size={24} /></div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Faturas</h1>
          <p className="text-sm text-gray-500">Faturas de todas as contas — somente leitura, sem emitir cobrança</p>
        </div>
      </div>}

      {/* Cards resumo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

      {/* Filtros globais — somente leitura, sem criar cobranças. */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 bg-white p-4 rounded-xl border border-gray-100">
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Empresa ou ID" value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-10 pr-3 py-2.5 border border-gray-200 rounded-xl outline-none text-sm" />
        </div>
        <select value={tipoFiltro} onChange={e => setTipoFiltro(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm">
          <option value="todos">Empresas e autônomos</option><option value="autonomos">Autônomos</option><option value="vinculados">Empresas</option>
        </select>
        <select value={statusFiltro} onChange={e => setStatusFiltro(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm">
          <option value="todos">Todos os status</option>{Object.entries(statusMap).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
        </select>
        <select value={vencimentoFiltro} onChange={e => setVencimentoFiltro(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm">
          <option value="todos">Todos os vencimentos</option><option value="vencidas">Vencidas</option><option value="proximos7">Próximos 7 dias</option><option value="sem_data">Sem vencimento</option>
        </select>
        <select value={planoFiltro} onChange={e => setPlanoFiltro(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm">
          <option value="todos">Todos os planos</option>{planos.map(plano => <option key={plano} value={plano}>{plano}</option>)}
        </select>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-500">Nenhuma fatura encontrada para os filtros selecionados.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Empresa</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Valor</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Tipo</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Vencimento</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Pagamento</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((f) => {
                  const st = statusMap[f.status] || { label: f.status, color: 'bg-gray-100 text-gray-800' };
                  return (
                    <tr key={f.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-medium text-gray-900">
                        <p>{f.empresas?.nome || '—'}</p>
                        <p className="text-[10px] uppercase text-gray-400">{f.empresas?.tipo === 'autonomo' ? 'Autônomo' : 'Empresa'} · {f.empresas?.status || 'sem status'} · {f.empresas?.planos?.nome || 'sem plano'}</p>
                      </td>
                      <td className="px-4 py-2.5 text-gray-700">R$ {Number(f.valor).toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-gray-500">{f.tipo_pagamento || '—'}</td>
                      <td className="px-4 py-2.5"><span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span></td>
                      <td className="px-4 py-2.5 text-gray-500">{f.due_date ? new Date(f.due_date).toLocaleDateString('pt-BR') : '—'}</td>
                      <td className="px-4 py-2.5 text-gray-500">{f.pago_em ? new Date(f.pago_em).toLocaleDateString('pt-BR') : '—'}</td>
                      <td className="px-4 py-2.5">
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
