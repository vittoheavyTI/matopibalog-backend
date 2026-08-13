import React, { useEffect, useState, useCallback } from 'react';
import { CreditCard, RefreshCw, AlertTriangle, ShieldCheck, Clock, PlayCircle, GitCompare } from 'lucide-react';
import api from '../api';

// Super Admin › Billing (macrofrente 3A-2, §36/§56).
// Visão do estado financeiro automático por empresa + ações de contingência DRY
// (planejar / reconciliar) — nenhuma execução real de Asaas nesta tela (o Gate
// sandbox executa). Backend é a autoridade.

type Empresa = { id: string; nome: string };
type UltimaCobranca = { status: string | null; valor: number | null; vencimento: string | null } | null;
type Overview = {
  empresa_id: string; empresa_nome: string | null; plano_nome: string | null; situacao_comercial: string | null;
  trial_ends_at: string | null; asaas_customer: string | null; tem_customer: boolean;
  asaas_subscription: string | null; tem_assinatura: boolean; billing_status: string | null;
  proxima_cobranca: string | null; ultima_cobranca: UltimaCobranca;
  inadimplente: boolean; suspender: boolean; em_graca: boolean; dias_atraso: number; trial_protege: boolean;
  ultimo_webhook: { tipo: string | null; status: string | null; em: string | null } | null;
  billing_updated_at: string | null;
};

function fmtMoeda(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtData(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

export const PainelBilling: React.FC = () => {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(false);
  const [plano, setPlano] = useState<unknown>(null);
  const [reconc, setReconc] = useState<unknown>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [providerMode, setProviderMode] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    api.get('/painel-admin/empresas').then(({ data }) => {
      const lista = Array.isArray(data) ? data : (data?.empresas || []);
      setEmpresas(lista.map((e: { id: string; nome: string }) => ({ id: e.id, nome: e.nome })));
    }).catch(() => setEmpresas([]));
  }, []);

  const carregarOverview = useCallback(async (id: string) => {
    if (!id) { setOverview(null); return; }
    setCarregando(true); setErro(false); setPlano(null); setReconc(null);
    try {
      const { data } = await api.get(`/pagamentos/billing/overview/${id}`);
      setOverview(data.overview);
      setProviderMode(data.policy?.provider_mode ?? null);
      try { const j = await api.get(`/pagamentos/billing/jobs?empresa_id=${id}`); setJobs(j.data.contagem || null); } catch { setJobs(null); }
    } catch {
      setErro(true);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { if (empresaId) carregarOverview(empresaId); }, [empresaId, carregarOverview]);

  const notificar = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000); };

  async function planejar() {
    try { const { data } = await api.post(`/pagamentos/billing/ensure-plan/${empresaId}`, {}); setPlano(data.plano); notificar('Plano gerado (dry-run).'); }
    catch { notificar('Erro ao planejar.'); }
  }
  async function reconciliar() {
    try { const { data } = await api.post(`/pagamentos/billing/reconciliar-plan/${empresaId}`, {}); setReconc(data.reconciliacao); notificar('Reconciliação avaliada (dry-run).'); }
    catch { notificar('Erro ao reconciliar.'); }
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {toast && <div className="fixed top-6 right-6 z-[100] px-5 py-3 rounded-xl shadow-2xl text-sm font-bold text-white bg-gray-800" role="status">{toast}</div>}
      <div className="flex items-center gap-2.5">
        <div className="bg-gray-800 p-1.5 rounded-lg text-white"><CreditCard size={18} /></div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800 leading-tight">Billing</h1>
          <p className="text-sm text-gray-500">Estado financeiro automático e contingência (dry-run)</p>
        </div>
        {providerMode && (
          <span className={`ml-auto px-2.5 py-1 rounded-lg text-xs font-bold uppercase ${providerMode === 'fake' ? 'bg-gray-100 text-gray-600' : 'bg-amber-100 text-amber-700'}`} title="Modo do provedor de billing">
            {providerMode === 'sandbox' ? 'SANDBOX' : providerMode}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="py-2 px-3 border-2 border-gray-100 rounded-xl bg-gray-50/50 text-sm min-w-64" aria-label="Empresa">
          <option value="">Selecione uma empresa…</option>
          {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
        {empresaId && <button onClick={() => carregarOverview(empresaId)} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 rounded-xl font-medium text-sm hover:bg-gray-200"><RefreshCw size={15} />Atualizar</button>}
      </div>

      {carregando && <div className="text-center text-gray-500 py-16">Carregando billing…</div>}

      {!carregando && erro && (
        <div className="text-center py-16">
          <AlertTriangle className="mx-auto text-red-400 mb-2" size={32} />
          <p className="text-gray-600 mb-3">Não foi possível carregar o billing.</p>
          <button onClick={() => carregarOverview(empresaId)} className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700"><RefreshCw size={15} />Tentar novamente</button>
        </div>
      )}

      {!carregando && !erro && !empresaId && (
        <div className="text-center py-16 text-gray-500"><CreditCard className="mx-auto text-gray-300 mb-2" size={32} />Selecione uma empresa para ver o billing.</div>
      )}

      {!carregando && !erro && overview && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card label="Situação" valor={overview.situacao_comercial || '—'} icon={ShieldCheck} />
            <Card label="Plano" valor={overview.plano_nome || '—'} icon={CreditCard} />
            <Card label="Próxima cobrança" valor={fmtData(overview.proxima_cobranca)} icon={Clock} />
            <Card label="Inadimplência" valor={overview.trial_protege ? 'Trial protege' : (overview.suspender ? `Suspender (${overview.dias_atraso}d)` : (overview.inadimplente ? `Em graça (${overview.dias_atraso}d)` : 'Em dia'))} icon={AlertTriangle} destaque={overview.suspender} />
          </div>

          <div className="rounded-2xl border border-gray-100 p-4 text-sm space-y-2">
            <Linha k="Customer Asaas" v={overview.tem_customer ? overview.asaas_customer : 'não vinculado'} />
            <Linha k="Assinatura Asaas" v={overview.tem_assinatura ? overview.asaas_subscription : 'não configurada'} />
            <Linha k="Billing status" v={overview.billing_status || '—'} />
            <Linha k="Última cobrança" v={overview.ultima_cobranca ? `${overview.ultima_cobranca.status} · ${fmtMoeda(overview.ultima_cobranca.valor)}` : '—'} />
            <Linha k="Último webhook" v={overview.ultimo_webhook ? `${overview.ultimo_webhook.tipo} (${overview.ultimo_webhook.status})` : '—'} />
            {jobs && <Linha k="Jobs (outbox)" v={`pendentes ${jobs.pending ?? 0} · processados ${jobs.processed ?? 0} · falhos ${jobs.failed ?? 0} · dead ${jobs.dead ?? 0}`} />}
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={planejar} className="flex items-center gap-1.5 px-4 py-2 bg-gray-800 text-white rounded-xl text-sm font-medium hover:bg-black"><PlayCircle size={16} />Ver plano (dry)</button>
            <button onClick={reconciliar} className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200"><GitCompare size={16} />Reconciliar (dry)</button>
          </div>

          {plano ? <details open className="bg-gray-50 rounded-lg p-2"><summary className="cursor-pointer text-xs font-bold text-gray-500 uppercase">Plano de billing (dry-run)</summary><pre className="text-xs text-gray-600 mt-2 overflow-x-auto">{JSON.stringify(plano, null, 2)}</pre></details> : null}
          {reconc ? <details open className="bg-gray-50 rounded-lg p-2"><summary className="cursor-pointer text-xs font-bold text-gray-500 uppercase">Reconciliação (dry-run)</summary><pre className="text-xs text-gray-600 mt-2 overflow-x-auto">{JSON.stringify(reconc, null, 2)}</pre></details> : null}
        </div>
      )}
    </div>
  );
};

const Card: React.FC<{ label: string; valor: string; icon: React.ComponentType<{ size?: number; className?: string }>; destaque?: boolean }> = ({ label, valor, icon: Icon, destaque }) => (
  <div className={`bg-white rounded-2xl border p-4 flex items-center gap-3 ${destaque ? 'border-red-200' : 'border-gray-100'}`}>
    <Icon size={20} className={destaque ? 'text-red-600' : 'text-gray-600'} />
    <div><div className="text-sm font-bold text-gray-800 leading-tight">{valor}</div><div className="text-xs text-gray-500 mt-0.5">{label}</div></div>
  </div>
);
const Linha: React.FC<{ k: string; v: string | null }> = ({ k, v }) => (
  <div className="flex items-center justify-between border-b border-gray-50 pb-1"><span className="text-gray-500">{k}</span><span className="font-semibold text-gray-700">{v || '—'}</span></div>
);
