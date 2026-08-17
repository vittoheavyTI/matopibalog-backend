import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Check, X, RefreshCw } from 'lucide-react';
import api from '../api';

// Painel super-admin: solicitações comerciais de add-ons pendentes (Fatia 2).
// Consultar → aprovar (add-on vira 'ativa') / recusar ('inativa'). NÃO gera
// cobrança real (billing production desligado); auditoria registrada no backend.
type Solicitacao = {
  id: string;
  empresa_id: string;
  empresa_nome: string | null;
  codigo: string | null;
  funcionalidade_nome: string | null;
  em_breve: boolean;
  preco_mensal: number | null;
  solicitado_em: string | null;
};

const brl = (v: number | null) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

export const SolicitacoesComerciais: React.FC = () => {
  const [itens, setItens] = useState<Solicitacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);
  const [agindo, setAgindo] = useState<string | null>(null);

  const carregar = useCallback((sinal?: { vivo: boolean }) => {
    setLoading(true);
    setErro(false);
    api.get('/painel-admin/solicitacoes-comerciais')
      .then(({ data }) => { if (!sinal || sinal.vivo) setItens(Array.isArray(data?.solicitacoes) ? data.solicitacoes : []); })
      .catch(() => { if (!sinal || sinal.vivo) setErro(true); })
      .finally(() => { if (!sinal || sinal.vivo) setLoading(false); });
  }, []);

  useEffect(() => {
    const sinal = { vivo: true };
    carregar(sinal);
    return () => { sinal.vivo = false; };
  }, [carregar]);

  async function acao(id: string, tipo: 'aprovar' | 'recusar') {
    setAgindo(id);
    try {
      await api.post(`/painel-admin/solicitacoes-comerciais/${id}/${tipo}`, tipo === 'recusar' ? { motivo: 'Recusado pelo super-admin.' } : {});
      setItens((s) => s.filter((x) => x.id !== id));
    } catch { /* mantém item; usuário pode tentar de novo */ }
    finally { setAgindo(null); }
  }

  // Painel não-intrusivo: só aparece quando HÁ solicitações pendentes. Durante o
  // carregamento/erro/vazio, não renderiza nada (não polui a tela nem colide com
  // o "carregando" da página hospedeira).
  if (loading || erro || itens.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-gray-900">
          <ClipboardList size={18} className="text-blue-600" />
          <h3 className="font-bold">Solicitações comerciais (add-ons) pendentes</h3>
          <span className="rounded-full bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5">{itens.length}</span>
        </div>
        <button type="button" onClick={() => carregar()} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"><RefreshCw size={14} />Atualizar</button>
      </div>
      <p className="text-xs text-gray-500">Aprovar ativa o serviço para a empresa (sem cobrança real — billing de produção desligado). ERP/SSO seguem “em preparação” tecnicamente mesmo se aprovados comercialmente.</p>

      {itens.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr><th className="px-3 py-2">Empresa</th><th className="px-3 py-2">Serviço</th><th className="px-3 py-2">Valor/mês</th><th className="px-3 py-2"></th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {itens.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2 font-medium text-gray-900">{s.empresa_nome || s.empresa_id}</td>
                  <td className="px-3 py-2 text-gray-700">{s.funcionalidade_nome}{s.em_breve && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-500">em preparação</span>}</td>
                  <td className="px-3 py-2 text-gray-700">{brl(s.preco_mensal)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button type="button" disabled={agindo === s.id} onClick={() => acao(s.id, 'aprovar')} className="mr-2 inline-flex items-center gap-1 rounded-lg bg-green-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-800 disabled:opacity-60"><Check size={14} />Aprovar</button>
                    <button type="button" disabled={agindo === s.id} onClick={() => acao(s.id, 'recusar')} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"><X size={14} />Recusar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
