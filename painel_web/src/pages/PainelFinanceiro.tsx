import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle, CreditCard, DollarSign,
  LayoutDashboard, Receipt, Shield,
} from 'lucide-react';
import api from '../api';
import { Faturas } from './Faturas';
import { PainelAssinaturas } from './PainelAssinaturas';
import { calculateContractedMrr, formatCurrency, getActiveRecurringContracts, getContractMonthlyPrice } from '../utils';

type AbaFinanceiro = 'visao-geral' | 'assinaturas' | 'faturas' | 'alertas';

export const PainelFinanceiro: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [stats, setStats] = useState({ receitaTotal: 0, ativas: 0, inadimplentes: 0 });
  const [empresas, setEmpresas] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      const response = await api.get('/painel-admin/empresas');
      const lista = response.data || [];
      const contratosAtivos = getActiveRecurringContracts(lista);
      const alertas = lista.filter((e: any) => ['suspenso', 'bloqueado', 'expirado'].includes(e.status));
      setEmpresas(lista);
      setStats({ receitaTotal: calculateContractedMrr(lista), ativas: contratosAtivos.length, inadimplentes: alertas.length });
    }
    load();
  }, []);

  const abaParam = searchParams.get('aba');
  const abaAtiva: AbaFinanceiro = ['assinaturas', 'faturas', 'alertas'].includes(abaParam || '')
    ? abaParam as AbaFinanceiro
    : 'visao-geral';
  const trocarAba = (aba: AbaFinanceiro) => setSearchParams(aba === 'visao-geral' ? {} : { aba });
  const alertas = empresas.filter((e: any) => ['suspenso', 'bloqueado', 'expirado'].includes(e.status));
  const empresasComMrr = getActiveRecurringContracts(empresas);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center space-x-3 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="bg-gray-800 p-2 rounded-lg text-white"><Shield size={24} /></div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-800">Financeiro</h1>
          <p className="text-sm text-gray-500">Receitas, assinaturas, faturas e alertas das contas da plataforma — somente leitura</p>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl p-1.5 flex flex-wrap gap-1 shadow-sm">
        {([
          ['visao-geral', 'Visão geral', LayoutDashboard],
          ['assinaturas', 'Assinaturas', CreditCard],
          ['faturas', 'Faturas', Receipt],
          ['alertas', 'Inadimplência / Alertas', AlertTriangle],
        ] as const).map(([aba, label, Icon]) => (
          <button key={aba} onClick={() => trocarAba(aba)} className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${abaAtiva === aba ? 'bg-green-700 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
            <Icon size={16} />{label}
          </button>
        ))}
      </div>

      {abaAtiva === 'assinaturas' && <PainelAssinaturas embedded />}
      {abaAtiva === 'faturas' && <Faturas embedded />}

      {abaAtiva === 'alertas' && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="font-bold text-gray-800">Contas que exigem atenção</h3>
            <p className="text-sm text-gray-500">Contas suspensas, bloqueadas ou expiradas. A regularização continua no fluxo existente de faturas.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead><tr className="bg-gray-50 text-gray-600 text-xs font-bold uppercase tracking-wider"><th className="px-4 py-2.5">Conta</th><th className="px-4 py-2.5">Tipo</th><th className="px-4 py-2.5">Plano</th><th className="px-4 py-2.5">Status</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {alertas.map((e: any) => <tr key={e.id}><td className="px-4 py-3 font-semibold text-gray-800">{e.nome}</td><td className="px-4 py-3 text-sm text-gray-600">{e.tipo === 'autonomo' ? 'Autônomo' : 'Empresa / Transportadora'}</td><td className="px-4 py-3 text-sm text-gray-600">{e.planos?.nome || 'Sem plano'}</td><td className="px-4 py-3"><span className="px-2.5 py-1 rounded-full bg-red-50 text-red-700 text-xs font-bold">{e.status}</span></td></tr>)}
                {alertas.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-gray-400">Nenhuma conta com alerta financeiro.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {abaAtiva === 'visao-geral' && <>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 p-4"><div className="flex items-center mb-2"><div className="p-2 bg-green-50 rounded-xl mr-3"><DollarSign size={20} className="text-green-600" /></div><p className="text-sm text-gray-500">MRR contratado</p></div><p className="text-2xl font-black text-gray-800">{formatCurrency(stats.receitaTotal)}</p><p className="text-xs text-gray-400">Mensalidades recorrentes de assinaturas ativas</p></div>
          <div className="bg-white rounded-2xl border border-gray-100 p-4"><div className="flex items-center mb-2"><div className="p-2 bg-blue-50 rounded-xl mr-3"><CreditCard size={20} className="text-blue-600" /></div><p className="text-sm text-gray-500">Assinaturas Ativas</p></div><p className="text-2xl font-black text-blue-600">{stats.ativas}</p></div>
          <button onClick={() => trocarAba('alertas')} className="text-left bg-white rounded-2xl border border-gray-100 p-4 hover:border-red-200"><div className="flex items-center mb-2"><div className="p-2 bg-red-50 rounded-xl mr-3"><AlertTriangle size={20} className="text-red-600" /></div><p className="text-sm text-gray-500">Inadimplência / Alertas</p></div><p className="text-2xl font-black text-red-600">{stats.inadimplentes}</p></button>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between"><h3 className="font-bold text-gray-800">MRR por conta</h3><span className="text-xs text-gray-400">{empresasComMrr.length} conta{empresasComMrr.length !== 1 ? 's' : ''}</span></div>
          <div className="overflow-x-auto"><table className="w-full text-left">
            <thead><tr className="bg-gray-50 text-gray-600 text-xs font-bold uppercase tracking-wider"><th className="px-4 py-2.5 border-b">Conta</th><th className="px-4 py-2.5 border-b">Plano</th><th className="px-4 py-2.5 border-b">Status</th><th className="px-4 py-2.5 border-b text-right">Valor Mensal</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {empresasComMrr.map((e: any) => <tr key={e.id} className="hover:bg-gray-50/50">
                <td className="px-4 py-2.5"><p className="font-semibold text-gray-800">{e.nome}</p><p className="text-xs text-gray-400">{e.tipo === 'autonomo' ? 'Autônomo' : 'Empresa / Transportadora'} · {e.cnpj || 'sem documento'}</p></td>
                <td className="px-4 py-2.5 text-sm text-gray-600">{e.planos?.nome || <span className="text-gray-400 italic">Sem plano</span>}</td>
                <td className="px-4 py-2.5"><span className="flex items-center gap-1 text-green-600 text-xs font-bold"><CheckCircle size={13} />Assinatura ativa</span></td>
                <td className="px-4 py-2.5 text-right font-bold text-gray-800">{formatCurrency(getContractMonthlyPrice(e))}</td>
              </tr>)}
              {empresasComMrr.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-gray-400">Nenhuma assinatura ativa com mensalidade</td></tr>}
            </tbody>
            {empresasComMrr.length > 0 && <tfoot><tr className="bg-gray-50 border-t-2 border-gray-200"><td colSpan={3} className="px-4 py-2.5 text-sm font-bold text-gray-600 uppercase">Total MRR contratado</td><td className="px-4 py-2.5 text-right text-lg font-black text-green-600">{formatCurrency(stats.receitaTotal)}</td></tr></tfoot>}
          </table></div>
        </div>
      </>}
    </div>
  );
};
