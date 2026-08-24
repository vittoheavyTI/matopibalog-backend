import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, ClipboardCheck, ExternalLink, Factory, MapPin, Play, RefreshCw, Route, ShieldAlert, Sparkles, Target, Users, XCircle } from 'lucide-react';
import api from '../api';
import { useLancamentosRealtime } from '../hooks/useLancamentosRealtime';

type Unidade = { id: string; nome: string; codigo?: string | null };
type Campaign = { id: string; reference_code: string; name: string; cargo_name: string; status: string; planning_status: string; created_at?: string };
type PlanDetail = {
  plan: { id: string; version_number: number; status: string; result_summary?: any };
  planned_trips: Array<{ id: string; planned_quantity: number; quantity_unit: string; required_capacity_kg: number; status: string; candidate_asset_id?: string | null; candidate_composition_id?: string | null }>;
  exceptions: Array<{ id: string; exception_type: string; severity: string; status: string }>;
};
type MaterializationPreview = {
  summary: { requested: number; already_materialized: number; ready: number; created?: number; blocked: number; failed?: number; retryable?: number };
  items: Array<{ planned_trip_id: string; status: string; frete_id?: string; reason?: string; retryable?: boolean }>;
};
type ReplanPreview = {
  blocked: boolean;
  blocking_trip_ids: string[];
  executed_trip_count: number;
  committed_trip_count: number;
  cancelled_trip_count: number;
  uncommitted_trip_count: number;
  residual_total_ton: number;
  has_residual: boolean;
};
type Orchestration = {
  next_action: string;
  next_action_reason_text: string;
  objective: { cargo_name: string; target_quantity: number; quantity_unit: string | null; origins: string[]; destination: string | null };
  route_context: Array<{ origin: string; destination: string; route_source: string; distance_km: number | null; duration_minutes: number | null; warnings: string[] }>;
  plan_summary: { plan: { id: string; version_number: number; status: string }; exceptions_open: number } | null;
};

type OriginEntry = { name: string; target_quantity: number | ''; quantity_unit: string };
const emptyOriginEntry = (): OriginEntry => ({ name: '', target_quantity: '', quantity_unit: 'ton' });
const emptyObjective = {
  name: '', cargo_name: '',
  origins: [emptyOriginEntry()] as OriginEntry[],
  destination: '', priority: 'normal', planned_start: '', planned_end: '',
  operational_unit_ids: [] as string[],
};
const emptyMaterialization = { modalidade_calculo: 'valor_fixo', valor_frete: '', valor_tonelada_km: '' };

// "O que preciso fazer agora?" (§35/§36) — rótulo + ação sugerida em pt-BR para
// cada next_action determinístico devolvido por GET .../orchestration.
const NEXT_ACTION_COPY: Record<string, { label: string; tone: 'info' | 'warning' | 'success' | 'neutral' }> = {
  COMPLETE_MISSING_OBJECTIVE: { label: 'Complete o objetivo (origem, destino e quantidade) para o sistema planejar.', tone: 'info' },
  GENERATE_PLAN: { label: 'Objetivo pronto — gere o plano para ver capacidade e viagens.', tone: 'info' },
  REVIEW_CAPACITY_GAP: { label: 'A capacidade própria não cobre toda a demanda. Revise antes de aprovar.', tone: 'warning' },
  REVIEW_BLOCKING_EXCEPTION: { label: 'Há um bloqueio que impede seguir. Revise as exceções do plano.', tone: 'warning' },
  APPROVE_PLAN: { label: 'Plano pronto para revisão e aprovação.', tone: 'success' },
  REPLAN_REQUIRED: { label: 'Replanejamento necessário: capacidade insuficiente para a demanda restante.', tone: 'warning' },
  REPLAN_RECOMMENDED: { label: 'Uma exceção de execução sugere replanejar o restante da demanda.', tone: 'warning' },
  REPLAN_AWAITING_APPROVAL: { label: 'Há um replanejamento gerado aguardando revisão e aprovação.', tone: 'warning' },
  READY_FOR_DISPATCH: { label: 'Há viagens prontas para designar ou ofertar a motoristas.', tone: 'success' },
  READY_FOR_MATERIALIZATION: { label: 'Há viagens com executor definido, prontas para virar frete.', tone: 'success' },
  REVIEW_EXECUTION_EXCEPTION: { label: 'Há uma exceção de execução que merece revisão.', tone: 'warning' },
  EXECUTION_IN_PROGRESS: { label: 'Operação em execução, sem pendências no momento.', tone: 'neutral' },
  CAMPAIGN_COMPLETE: { label: 'Todas as viagens planejadas foram concluídas.', tone: 'success' },
  CAMPAIGN_CANCELLED: { label: 'Esta campanha foi cancelada.', tone: 'neutral' },
};

function apiError(error: any) {
  const denial = error?.response?.data?.denial;
  if (denial === 'entitlement_denied') return 'Campanhas de escoamento ainda não estão habilitadas no contrato desta empresa.';
  if (denial === 'permission_denied') return 'Seu perfil não tem permissão para operar campanhas de escoamento.';
  if (denial === 'scope_denied') return 'A unidade selecionada está fora do seu escopo operacional.';
  return error?.response?.data?.message || 'Não foi possível concluir a operação.';
}

function statusTone(status: string) {
  if (status === 'APPROVED') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'READY_FOR_REVIEW') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (status === 'CANCELLED' || status === 'REJECTED') return 'bg-rose-50 text-rose-700 border-rose-200';
  return 'bg-slate-50 text-slate-700 border-slate-200';
}

export function OperationCampaigns() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [objectiveForm, setObjectiveForm] = useState(emptyObjective);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [orchestration, setOrchestration] = useState<Orchestration | null>(null);
  const [materializationForm, setMaterializationForm] = useState(emptyMaterialization);
  const [materializationPreview, setMaterializationPreview] = useState<MaterializationPreview | null>(null);
  const [replanPreview, setReplanPreview] = useState<ReplanPreview | null>(null);
  const [replanReason, setReplanReason] = useState('');
  const [showReplan, setShowReplan] = useState(false);

  const selected = useMemo(() => campaigns.find((item) => item.id === selectedId) || campaigns[0] || null, [campaigns, selectedId]);

  async function carregar() {
    setLoading(true);
    setMessage(null);
    try {
      const [campaignRes, unidadesRes] = await Promise.all([
        api.get('/operation-campaigns'),
        api.get('/operation-campaigns/context').catch(() => ({ data: { unidades: [] } })),
      ]);
      const itens = campaignRes.data?.itens || [];
      setCampaigns(itens);
      setSelectedId((current) => current || itens[0]?.id || '');
      setUnidades(Array.isArray(unidadesRes.data?.unidades) ? unidadesRes.data.unidades : []);
    } catch (error) {
      setMessage({ type: 'error', text: apiError(error) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  // "O que preciso fazer agora?" (§35/§36): carrega a orquestração (next_action)
  // e, se já existir um plano, o detalhe completo dele — a cada troca de
  // campanha selecionada. Corrige de quebra o gap anterior em que reabrir uma
  // campanha existente não recarregava o plano já gerado.
  const carregarOrquestracao = useCallback(async (campaignId: string) => {
    try {
      const { data } = await api.get(`/operation-campaigns/${campaignId}/orchestration`);
      setOrchestration(data);
      if (data.plan_summary?.plan?.id) {
        const { data: planData } = await api.get(`/operation-campaigns/${campaignId}/plans/${data.plan_summary.plan.id}`);
        setPlan(planData);
      } else {
        setPlan(null);
      }
    } catch (error) {
      setOrchestration(null);
      setPlan(null);
    }
  }, []);

  useEffect(() => {
    if (selected) carregarOrquestracao(selected.id);
    else { setOrchestration(null); setPlan(null); }
  }, [selected?.id, carregarOrquestracao]);

  // Fluxo guiado (§13/§57-58): um único objetivo (nome, carga, quantidade,
  // origem, destino) cria a campanha, os locais, a demanda e já gera o plano —
  // em vez de 4 passos separados. Janela/prioridade/unidade ficam em "avançado".
  async function criarObjetivo(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const { data } = await api.post('/operation-campaigns/objective', {
        name: objectiveForm.name,
        cargo_name: objectiveForm.cargo_name,
        origins: objectiveForm.origins.map((o) => ({
          name: o.name, target_quantity: Number(o.target_quantity || 0), quantity_unit: o.quantity_unit,
        })),
        destination: objectiveForm.destination,
        priority: objectiveForm.priority,
        planned_start: objectiveForm.planned_start || undefined,
        planned_end: objectiveForm.planned_end || undefined,
        operational_unit_ids: objectiveForm.operational_unit_ids,
        client_request_id: `objective-${Date.now()}`,
      });
      setCampaigns((items) => [data.campaign, ...items.filter((item) => item.id !== data.campaign.id)]);
      setSelectedId(data.campaign.id);
      setObjectiveForm(emptyObjective);
      setShowAdvanced(false);
      setMessage({ type: 'ok', text: 'Objetivo registrado — plano gerado, pronto para revisão.' });
    } catch (error) {
      setMessage({ type: 'error', text: apiError(error) });
    } finally {
      setSaving(false);
    }
  }

  async function aprovarPlano() {
    if (!selected || !plan) return;
    setSaving(true);
    setMessage(null);
    try {
      const { data } = await api.post(`/operation-campaigns/${selected.id}/plans/${plan.plan.id}/approve`, { client_request_id: `approve-${Date.now()}` });
      setPlan(data);
      setMaterializationPreview(null);
      await Promise.all([carregar(), carregarOrquestracao(selected.id)]);
      setMessage({ type: 'ok', text: 'Plano aprovado.' });
    } catch (error) {
      setMessage({ type: 'error', text: apiError(error) });
    } finally {
      setSaving(false);
    }
  }

  // Replan pós-aprovação (§35-37): preview read-only antes de confirmar. Nunca
  // duplica lógica de residual/comprometido no front — só exibe o que o backend
  // já calculou (campaignReplanService.previewReplan).
  async function abrirReplan() {
    if (!selected) return;
    setShowReplan(true);
    setSaving(true);
    setMessage(null);
    try {
      const { data } = await api.get(`/operation-campaigns/${selected.id}/replan/preview`);
      setReplanPreview(data);
    } catch (error) {
      setMessage({ type: 'error', text: apiError(error) });
    } finally {
      setSaving(false);
    }
  }

  async function confirmarReplan() {
    if (!selected || !replanReason.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      await api.post(`/operation-campaigns/${selected.id}/replan`, {
        reason: replanReason.trim(),
        client_request_id: `replan-${Date.now()}`,
      });
      setShowReplan(false);
      setReplanPreview(null);
      setReplanReason('');
      await carregarOrquestracao(selected.id);
      setMessage({ type: 'ok', text: 'Replanejamento gerado — pronto para revisão e aprovação.' });
    } catch (error) {
      setMessage({ type: 'error', text: apiError(error) });
    } finally {
      setSaving(false);
    }
  }

  // Multi-origem (§56-61): 1 origem por padrão, "+ Adicionar origem" para mais.
  // Cada origem carrega a própria quantidade (autoridade única) — o total é
  // sempre derivado (soma), nunca redigitado.
  function adicionarOrigem() {
    setObjectiveForm((current) => ({ ...current, origins: [...current.origins, emptyOriginEntry()] }));
  }
  function removerOrigem(index: number) {
    setObjectiveForm((current) => ({ ...current, origins: current.origins.filter((_, i) => i !== index) }));
  }
  function atualizarOrigem(index: number, patch: Partial<OriginEntry>) {
    setObjectiveForm((current) => ({
      ...current,
      origins: current.origins.map((o, i) => (i === index ? { ...o, ...patch } : o)),
    }));
  }
  const totalOrigemQuantidade = objectiveForm.origins.reduce((sum, o) => sum + (Number(o.target_quantity) || 0), 0);

  function toggleUnit(id: string) {
    setObjectiveForm((current) => ({
      ...current,
      operational_unit_ids: current.operational_unit_ids.includes(id)
        ? current.operational_unit_ids.filter((unitId) => unitId !== id)
        : [...current.operational_unit_ids, id],
    }));
  }

  function materializationPayload() {
    const payload: any = {
      modalidade_calculo: materializationForm.modalidade_calculo,
      client_request_id: `materialize-${Date.now()}`,
    };
    if (materializationForm.modalidade_calculo === 'tonelada_km') {
      payload.valor_tonelada_km = Number(materializationForm.valor_tonelada_km || 0);
    } else {
      payload.valor_frete = Number(materializationForm.valor_frete || 0);
    }
    return payload;
  }

  async function carregarPreviewMaterializacao() {
    if (!selected || !plan) return;
    setSaving(true);
    setMessage(null);
    try {
      const { data } = await api.get(`/operation-campaigns/${selected.id}/plans/${plan.plan.id}/materialization-preview`);
      setMaterializationPreview(data);
      setMessage({ type: 'ok', text: 'Preview de materialização pronto.' });
    } catch (error) {
      setMessage({ type: 'error', text: apiError(error) });
    } finally {
      setSaving(false);
    }
  }

  async function materializarFretes() {
    if (!selected || !plan || !materializationPreview) return;
    const ready = materializationPreview.summary.ready || 0;
    const existing = materializationPreview.summary.already_materialized || 0;
    const blocked = materializationPreview.summary.blocked || 0;
    const ok = window.confirm(`Materializar ${ready} frete(s), manter ${existing} já existente(s) e deixar ${blocked} bloqueado(s)?`);
    if (!ok) return;
    setSaving(true);
    setMessage(null);
    try {
      const { data } = await api.post(`/operation-campaigns/${selected.id}/plans/${plan.plan.id}/materialize`, materializationPayload());
      setMaterializationPreview(data);
      setMessage({ type: 'ok', text: `${data.summary.created || 0} frete(s) materializado(s).` });
    } catch (error) {
      setMessage({ type: 'error', text: apiError(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Campanhas de Escoamento</h1>
            <p className="text-sm text-slate-500">Planeje capacidade própria até o plano aprovado, sem gerar fretes.</p>
          </div>
          <button onClick={carregar} disabled={loading || saving} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60">
            <RefreshCw size={16} /> Atualizar
          </button>
        </div>

        {message && (
          <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${message.type === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
            {message.type === 'ok' ? <CheckCircle2 size={16} /> : <ShieldAlert size={16} />}
            <span>{message.text}</span>
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <section className="space-y-4">
            <form onSubmit={criarObjetivo} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-800"><Target size={16} /> Novo objetivo</div>
              <p className="mb-3 text-xs text-slate-500">O que você precisa transportar, quanto, de onde para onde. O sistema monta o plano.</p>
              <div className="space-y-3">
                <input required placeholder="Nome do objetivo (ex.: Escoamento safra verão)" value={objectiveForm.name} onChange={(e) => setObjectiveForm({ ...objectiveForm, name: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                <input required placeholder="O que precisa transportar (ex.: Soja)" value={objectiveForm.cargo_name} onChange={(e) => setObjectiveForm({ ...objectiveForm, cargo_name: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                <div className="space-y-2">
                  <span className="flex items-center gap-1 text-sm font-medium text-slate-700"><MapPin size={15} /> De onde (quanto em cada origem)</span>
                  {objectiveForm.origins.map((entry, index) => (
                    <div key={index} className="flex gap-2">
                      <input required placeholder={`Origem ${index + 1}`} value={entry.name} onChange={(e) => atualizarOrigem(index, { name: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                      <input required type="number" min="0" step="0.001" placeholder="Qtd." value={entry.target_quantity} onChange={(e) => atualizarOrigem(index, { target_quantity: e.target.value === '' ? '' : Number(e.target.value) })} className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                      <select value={entry.quantity_unit} onChange={(e) => atualizarOrigem(index, { quantity_unit: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-2 text-sm">
                        <option value="ton">t</option>
                        <option value="kg">kg</option>
                      </select>
                      {objectiveForm.origins.length > 1 && (
                        <button type="button" onClick={() => removerOrigem(index)} aria-label={`Remover origem ${index + 1}`} className="rounded-lg border border-slate-200 px-2 text-slate-500 hover:bg-slate-100"><XCircle size={16} /></button>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={adicionarOrigem} className="text-xs font-semibold text-emerald-700 hover:underline">+ Adicionar origem</button>
                  {objectiveForm.origins.length > 1 && (
                    <p className="text-xs text-slate-500">Total: {totalOrigemQuantidade.toLocaleString('pt-BR')} (soma automática, não redigite)</p>
                  )}
                </div>
                <label className="block space-y-1 text-sm font-medium text-slate-700">
                  <span className="flex items-center gap-1"><Factory size={15} /> Para onde</span>
                  <input required placeholder="Destino" value={objectiveForm.destination} onChange={(e) => setObjectiveForm({ ...objectiveForm, destination: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                </label>

                <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-xs font-semibold uppercase text-slate-500 hover:text-slate-700">
                  <span>Avançado (janela, prioridade, unidade)</span>
                  <ChevronDown size={14} className={showAdvanced ? 'rotate-180 transition-transform' : 'transition-transform'} />
                </button>
                {showAdvanced && (
                  <div className="space-y-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <div className="grid gap-2 md:grid-cols-2">
                      <label className="space-y-1 text-xs font-medium text-slate-600">
                        <span>Início da janela</span>
                        <input type="date" value={objectiveForm.planned_start} onChange={(e) => setObjectiveForm({ ...objectiveForm, planned_start: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                      </label>
                      <label className="space-y-1 text-xs font-medium text-slate-600">
                        <span>Fim da janela</span>
                        <input type="date" value={objectiveForm.planned_end} onChange={(e) => setObjectiveForm({ ...objectiveForm, planned_end: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                      </label>
                    </div>
                    <label className="space-y-1 text-xs font-medium text-slate-600">
                      <span>Prioridade</span>
                      <select value={objectiveForm.priority} onChange={(e) => setObjectiveForm({ ...objectiveForm, priority: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                        <option value="low">Baixa</option>
                        <option value="normal">Normal</option>
                        <option value="high">Alta</option>
                        <option value="urgent">Urgente</option>
                      </select>
                    </label>
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase text-slate-500">Unidades</p>
                      <div className="max-h-32 space-y-1 overflow-auto rounded-lg border border-slate-200 bg-white p-2">
                        {unidades.map((unidade) => (
                          <label key={unidade.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-50">
                            <input type="checkbox" checked={objectiveForm.operational_unit_ids.includes(unidade.id)} onChange={() => toggleUnit(unidade.id)} className="h-4 w-4 rounded border-slate-300" />
                            <span>{unidade.nome}</span>
                          </label>
                        ))}
                        {!unidades.length && <p className="px-2 py-3 text-sm text-slate-500">Unidades indisponíveis para seleção.</p>}
                      </div>
                    </div>
                  </div>
                )}

                <button disabled={saving || loading} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
                  <Sparkles size={16} /> Gerar plano
                </button>
              </div>
            </form>

            <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <div className="mb-2 text-sm font-semibold text-slate-800">Em andamento</div>
              <div className="space-y-2">
                {campaigns.map((item) => (
                  <button key={item.id} onClick={() => setSelectedId(item.id)} className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${selected?.id === item.id ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">{item.reference_code}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusTone(item.status)}`}>{item.status}</span>
                    </div>
                    <p className="mt-1 text-slate-600">{item.name}</p>
                  </button>
                ))}
                {!campaigns.length && <p className="px-2 py-4 text-center text-sm text-slate-500">{loading ? 'Carregando...' : 'Nenhuma campanha encontrada.'}</p>}
              </div>
            </div>
          </section>

          <section className="space-y-4">
            {selected ? (
              <>
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-500">{selected.reference_code}</p>
                      <h2 className="text-xl font-semibold text-slate-900">{selected.name}</h2>
                      <p className="text-sm text-slate-500">
                        {selected.cargo_name}
                        {orchestration?.objective?.origins?.length && orchestration?.objective?.destination
                          ? ` · ${orchestration.objective.origins.join(', ')} → ${orchestration.objective.destination}` : ''}
                        {orchestration?.objective?.target_quantity
                          ? ` · ${orchestration.objective.target_quantity.toLocaleString('pt-BR')} ${orchestration.objective.quantity_unit === 'kg' ? 'kg' : 't'}` : ''}
                      </p>
                    </div>
                    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(selected.status)}`}>{selected.planning_status}</span>
                  </div>
                  {!!orchestration?.route_context?.length && (
                    <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                      {orchestration.route_context.map((r, i) => (
                        <p key={i} className="flex items-center gap-1 text-xs text-slate-500">
                          <Route size={12} />
                          {r.origin} → {r.destination} · Distância: {r.distance_km != null ? `${r.distance_km.toLocaleString('pt-BR')} km` : 'não disponível'}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                {orchestration && (() => {
                  const copy = NEXT_ACTION_COPY[orchestration.next_action] || { label: orchestration.next_action_reason_text, tone: 'neutral' as const };
                  const toneClass = copy.tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800'
                    : copy.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : copy.tone === 'info' ? 'border-sky-200 bg-sky-50 text-sky-800'
                    : 'border-slate-200 bg-slate-50 text-slate-700';
                  return (
                    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${toneClass}`}>
                      <Activity size={16} className="mt-0.5 shrink-0" />
                      <div>
                        <p className="font-semibold">O que fazer agora</p>
                        <p>{copy.label}</p>
                      </div>
                    </div>
                  );
                })()}

                {orchestration && !showReplan && (orchestration.next_action === 'REPLAN_RECOMMENDED' || orchestration.next_action === 'REPLAN_REQUIRED') && (
                  <button onClick={abrirReplan} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60">
                    <RefreshCw size={16} /> Replanejar restante
                  </button>
                )}

                {showReplan && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm">
                    <h3 className="mb-3 text-sm font-semibold text-amber-900">Replanejar o restante</h3>
                    {replanPreview ? (
                      replanPreview.blocked ? (
                        <p className="text-sm text-amber-800">
                          Não é possível replanejar agora: há {replanPreview.blocking_trip_ids.length} viagem(ns) em estado inconsistente que precisam de revisão antes.
                        </p>
                      ) : !replanPreview.has_residual ? (
                        <p className="text-sm text-amber-800">Não há demanda residual — a meta já está totalmente executada ou comprometida.</p>
                      ) : (
                        <div className="space-y-3">
                          <div className="grid gap-3 md:grid-cols-4">
                            <Metric label="Já concluído" value={String(replanPreview.executed_trip_count)} />
                            <Metric label="Já comprometido" value={String(replanPreview.committed_trip_count)} />
                            <Metric label="Cancelado/liberado" value={String(replanPreview.cancelled_trip_count)} />
                            <Metric label="Restante (t)" value={replanPreview.residual_total_ton.toLocaleString('pt-BR')} />
                          </div>
                          <label className="block space-y-1 text-sm font-medium text-amber-900">
                            <span>Motivo do replanejamento</span>
                            <input required value={replanReason} onChange={(e) => setReplanReason(e.target.value)} placeholder="Ex.: frete cancelado, recurso indisponível" className="w-full rounded-lg border border-amber-300 px-3 py-2 text-sm" />
                          </label>
                          <div className="flex gap-2">
                            <button onClick={confirmarReplan} disabled={saving || !replanReason.trim()} className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-60"><CheckCircle2 size={16} /> Confirmar replanejamento</button>
                            <button onClick={() => { setShowReplan(false); setReplanPreview(null); }} className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100">Cancelar</button>
                          </div>
                        </div>
                      )
                    ) : (
                      <p className="text-sm text-amber-700">Carregando prévia...</p>
                    )}
                  </div>
                )}

                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Route size={16} /> Plano</h3>
                    {plan?.plan.status === 'READY_FOR_REVIEW' && (
                      <button onClick={aprovarPlano} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"><ClipboardCheck size={16} /> Aprovar</button>
                    )}
                  </div>
                  {plan ? (
                    <div className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-4">
                        <Metric label="Versão" value={`v${plan.plan.version_number}`} />
                        <Metric label="Viagens" value={String(plan.plan.result_summary?.planned_trips || plan.planned_trips.length)} />
                        <Metric label="Bloqueios" value={String(plan.plan.result_summary?.hard_exceptions || 0)} />
                        <Metric label="Alertas" value={String(plan.plan.result_summary?.warning_exceptions || plan.exceptions.length)} />
                      </div>
                      {plan.plan.status === 'APPROVED' && (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                          <div className="grid gap-3 md:grid-cols-[160px_1fr_auto_auto] md:items-end">
                            <label className="space-y-1 text-sm font-medium text-emerald-900">
                              <span>Modalidade</span>
                              <select value={materializationForm.modalidade_calculo} onChange={(e) => { setMaterializationForm({ ...materializationForm, modalidade_calculo: e.target.value }); setMaterializationPreview(null); }} className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm">
                                <option value="valor_fixo">Valor fixo</option>
                                <option value="tonelada_km">Tonelada/km</option>
                              </select>
                            </label>
                            {materializationForm.modalidade_calculo === 'tonelada_km' ? (
                              <label className="space-y-1 text-sm font-medium text-emerald-900">
                                <span>Valor por t/km</span>
                                <input type="number" min="0" step="0.0001" value={materializationForm.valor_tonelada_km} onChange={(e) => { setMaterializationForm({ ...materializationForm, valor_tonelada_km: e.target.value }); setMaterializationPreview(null); }} className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm" />
                              </label>
                            ) : (
                              <label className="space-y-1 text-sm font-medium text-emerald-900">
                                <span>Valor por frete</span>
                                <input type="number" min="0" step="0.01" value={materializationForm.valor_frete} onChange={(e) => { setMaterializationForm({ ...materializationForm, valor_frete: e.target.value }); setMaterializationPreview(null); }} className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm" />
                              </label>
                            )}
                            <button type="button" onClick={carregarPreviewMaterializacao} disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"><RefreshCw size={16} /> Preview</button>
                            <button type="button" onClick={materializarFretes} disabled={saving || !materializationPreview || !materializationPreview.summary.ready} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"><Play size={16} /> Materializar fretes</button>
                          </div>
                          {materializationPreview && (
                            <div className="mt-3 grid gap-2 md:grid-cols-5">
                              <Metric label="Prontos" value={String(materializationPreview.summary.ready || 0)} />
                              <Metric label="Existentes" value={String(materializationPreview.summary.already_materialized || 0)} />
                              <Metric label="Criados" value={String(materializationPreview.summary.created || 0)} />
                              <Metric label="Bloqueados" value={String(materializationPreview.summary.blocked || 0)} />
                              <Metric label="Falhas" value={String(materializationPreview.summary.failed || 0)} />
                            </div>
                          )}
                        </div>
                      )}
                      <div className="overflow-hidden rounded-lg border border-slate-200">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Qtd.</th><th className="px-3 py-2">Capacidade</th><th className="px-3 py-2">Recurso</th><th className="px-3 py-2">Status</th></tr></thead>
                          <tbody>
                            {plan.planned_trips.map((trip) => (
                              <tr key={trip.id} className="border-t border-slate-100">
                                <td className="px-3 py-2">{Number(trip.planned_quantity).toLocaleString('pt-BR')} {trip.quantity_unit}</td>
                                <td className="px-3 py-2">{Number(trip.required_capacity_kg).toLocaleString('pt-BR')} kg</td>
                                <td className="px-3 py-2">{trip.candidate_composition_id ? 'Composição' : trip.candidate_asset_id ? 'Ativo' : 'Sem alocação'}</td>
                                <td className="px-3 py-2">{trip.status}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {!!plan.exceptions.length && (
                        <div className="space-y-2">
                          {plan.exceptions.map((item) => (
                            <div key={item.id} className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                              <AlertTriangle size={16} /> {item.severity}: {item.exception_type}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-5 text-sm text-slate-500">
                      <XCircle size={16} /> Gere um plano para revisar capacidade, viagens planejadas e exceções.
                    </div>
                  )}
                </div>

                {selected.status === 'APPROVED' && <CampaignExecution campaignId={selected.id} />}
              </>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Selecione ou crie uma campanha para começar.</div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

// ---- Execução da campanha (progresso derivado read-only) -------------------
type TripDetail = {
  planned_trip_id: string;
  origem: string | null;
  destino: string | null;
  planned_quantity: number | null;
  quantity_unit: string;
  materialization: string;
  frete_id: string | null;
  execution_status: string | null;
  execution_bucket: string | null;
  readiness: string;
  attention: string[];
};
type Progress = {
  approved_plan: { id: string; version_number: number } | null;
  progress: {
    trips: { planned_total: number; not_materialized: number; materialized: number; in_execution: number; completed: number; cancelled: number; blocked: number; unknown: number };
    quantity: { unit: string; target: number; planned: number; materialized: number; completed: number; cancelled: number; remaining: number; coverage: { quantity_source: string; measured_actual_available: boolean; trips_with_quantity: number; trips_total: number; incompatible_units: boolean } };
  };
  trips_detail: TripDetail[];
  readiness: { total_operational_needs: number; ready_direct: number; ready_offer: number; blocked: number; already_assigned: number; executing: number; completed: number };
  health: { state: string; reason_code: string; reason_text: string };
  exceptions: Array<{ type: string; severity: string; planned_trip_id?: string }>;
  replan: { status: string; reason_code: string; suggested_next_step: string | null; remaining_quantity: number; quantity_unit: string };
  window: { state: string; planned_start: string | null; planned_end: string | null } | null;
  updated_at: string;
};
type EligibilityCandidate = { driver_id: string | null; asset_id: string | null; composition_id: string | null; eligibility: string; reasons: string[]; warnings: string[]; capacity_match: string; documents_status: string; maintenance_status: string; assignment_status: string; route_compatibility: string; capacity_kg: number | null };
type EligibilityResult = {
  summary: { total_candidates: number; eligible: number; eligible_with_warnings: number; ineligible: number; has_any_eligible: boolean };
  candidates: EligibilityCandidate[];
  truncated: boolean;
};
type DispatchOffer = { id: string; driver_id: string; asset_id: string | null; composition_id: string | null; status: string };
type DispatchRound = { id: string; mode: string; status: string; expires_at: string | null; winner_offer_id: string | null };

function candidateKey(c: { driver_id: string | null; asset_id: string | null; composition_id: string | null }) {
  return `${c.driver_id || ''}:${c.asset_id || ''}:${c.composition_id || ''}`;
}

const HEALTH_LABEL: Record<string, string> = {
  ON_TRACK: 'No prazo', ATTENTION: 'Atenção', CRITICAL: 'Crítico', COMPLETED: 'Concluída', NO_EXECUTION_YET: 'Sem execução ainda',
};
const HEALTH_TONE: Record<string, string> = {
  ON_TRACK: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ATTENTION: 'bg-amber-50 text-amber-700 border-amber-200',
  CRITICAL: 'bg-rose-50 text-rose-700 border-rose-200',
  NO_EXECUTION_YET: 'bg-slate-50 text-slate-700 border-slate-200',
};
const READINESS_LABEL: Record<string, string> = {
  COMPLETED: 'Concluído', ALREADY_EXECUTING: 'Em execução', ALREADY_ASSIGNED: 'Já designado',
  READY_FOR_DIRECT_ASSIGNMENT: 'Pronto para designação', READY_FOR_OFFER_DISPATCH: 'Pronto para futura oferta', BLOCKED: 'Bloqueado',
};
const BUCKET_LABEL: Record<string, string> = {
  IN_EXECUTION: 'Em execução', COMPLETED: 'Concluído', CANCELLED: 'Cancelado', UNKNOWN: 'Desconhecido',
};
const ELIG_LABEL: Record<string, string> = {
  ELIGIBLE: 'Elegível', ELIGIBLE_WITH_WARNINGS: 'Elegível com alertas', INELIGIBLE: 'Inelegível', UNKNOWN: 'Indeterminado',
};

function num(n: number | null | undefined) {
  return typeof n === 'number' ? n.toLocaleString('pt-BR') : '—';
}

function CampaignExecution({ campaignId }: { campaignId: string }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [eligTrip, setEligTrip] = useState<TripDetail | null>(null);
  const [elig, setElig] = useState<EligibilityResult | null>(null);
  const [eligLoading, setEligLoading] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [dispatchForm, setDispatchForm] = useState({ modalidade_calculo: 'valor_fixo', valor_frete: '', valor_tonelada_km: '', validade_minutos: '60' });
  const [dispatchAcao, setDispatchAcao] = useState<string | null>(null); // chave do candidato em ação, ou 'oferta'
  const [dispatchErro, setDispatchErro] = useState<string | null>(null);
  const [dispatchRound, setDispatchRound] = useState<DispatchRound | null>(null);
  const [dispatchOffers, setDispatchOffers] = useState<DispatchOffer[]>([]);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const carregar = useCallback(async () => {
    try {
      const { data } = await api.get(`/operation-campaigns/${campaignId}/progress`);
      if (data && data.progress) { setProgress(data); setStale(false); setError(null); }
    } catch (err) {
      setStale(true);
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => { setLoading(true); setProgress(null); setEligTrip(null); setElig(null); carregar(); }, [carregar]);

  // Refresh direcionado ao mudar frete (SSE, coalescido) — §101/§102.
  const onSync = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { carregar(); }, 600);
  }, [carregar]);
  useLancamentosRealtime(onSync, { enabled: true });
  // Limpa o debounce pendente no unmount — sem isto, um sync agendado pouco antes de sair da
  // tela ainda dispara carregar() (fetch + setState) num componente já desmontado.
  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current); }, []);

  // Fallback: reconciliação por polling leve (§103).
  useEffect(() => {
    const id = setInterval(() => { carregar(); }, 60000);
    return () => clearInterval(id);
  }, [carregar]);

  async function verElegibilidade(trip: TripDetail) {
    if (!progress?.approved_plan) return;
    setEligTrip(trip); setElig(null); setEligLoading(true);
    setSelecionados(new Set()); setDispatchErro(null); setDispatchRound(null); setDispatchOffers([]);
    try {
      const { data } = await api.get(`/operation-campaigns/${campaignId}/plans/${progress.approved_plan.id}/trips/${trip.planned_trip_id}/eligibility`);
      setElig(data);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setEligLoading(false);
    }
  }

  function dispatchBasePath() {
    return `/operation-campaigns/${campaignId}/plans/${progress?.approved_plan?.id}/trips/${eligTrip?.planned_trip_id}/dispatch`;
  }

  function materializationOptionsPayload() {
    const payload: Record<string, unknown> = { modalidade_calculo: dispatchForm.modalidade_calculo };
    if (dispatchForm.modalidade_calculo === 'tonelada_km') payload.valor_tonelada_km = Number(dispatchForm.valor_tonelada_km || 0);
    else payload.valor_frete = Number(dispatchForm.valor_frete || 0);
    return payload;
  }

  // Designação direta (§10/§30): UM candidato hoje elegível. O backend revalida a
  // elegibilidade no momento da mutação — o botão nunca é a autoridade, só o convite.
  async function designarDireto(c: EligibilityCandidate) {
    if (!eligTrip) return;
    const key = candidateKey(c);
    setDispatchAcao(key); setDispatchErro(null);
    try {
      const { data } = await api.post(`${dispatchBasePath()}/direct-assign`, {
        driver_id: c.driver_id, asset_id: c.asset_id, composition_id: c.composition_id,
        materialization_options: materializationOptionsPayload(),
      });
      setDispatchRound(data.round); setDispatchOffers(data.offers || []);
      setDispatchErro(data.materialization_error ? `Designado, mas a materialização falhou: ${data.materialization_error.message} Tente novamente em instantes.` : null);
      carregar();
    } catch (err) {
      setDispatchErro(apiError(err));
    } finally {
      setDispatchAcao(null);
    }
  }

  // Rodada de oferta (§11/§13): candidatos selecionados (ou todos os elegíveis, se
  // nenhum for marcado). O vencedor só é decidido depois, quando um motorista aceitar.
  async function criarOferta() {
    if (!eligTrip || !elig) return;
    setDispatchAcao('oferta'); setDispatchErro(null);
    try {
      const marcados = elig.candidates.filter((c) => selecionados.has(candidateKey(c)));
      const recipients = marcados.length
        ? marcados.map((c) => ({ driver_id: c.driver_id, asset_id: c.asset_id, composition_id: c.composition_id }))
        : undefined;
      const minutos = Math.max(1, Number(dispatchForm.validade_minutos || 60));
      const expiresAt = new Date(Date.now() + minutos * 60000).toISOString();
      const { data } = await api.post(`${dispatchBasePath()}/rounds`, {
        recipients, expires_at: expiresAt, materialization_options: materializationOptionsPayload(),
      });
      setDispatchRound(data.round); setDispatchOffers(data.offers || []);
      setSelecionados(new Set());
      if (data.excluded_requested_recipients?.length) {
        setDispatchErro(`${data.excluded_requested_recipients.length} candidato(s) selecionado(s) não estava(m) mais elegível(is) e foi(ram) excluído(s) da oferta.`);
      }
    } catch (err) {
      setDispatchErro(apiError(err));
    } finally {
      setDispatchAcao(null);
    }
  }

  async function cancelarOferta() {
    if (!eligTrip || !dispatchRound) return;
    setDispatchAcao('cancelar'); setDispatchErro(null);
    try {
      const { data } = await api.post(`${dispatchBasePath()}/rounds/${dispatchRound.id}/cancel`, {});
      setDispatchRound(data.round); setDispatchOffers(data.offers || []);
    } catch (err) {
      setDispatchErro(apiError(err));
    } finally {
      setDispatchAcao(null);
    }
  }

  function alternarSelecao(key: string) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm text-sm text-slate-500">
        <div className="flex items-center gap-2"><Activity size={16} /> Carregando execução da campanha…</div>
      </div>
    );
  }
  if (!progress) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm text-sm text-slate-500">
        <div className="flex items-center gap-2"><XCircle size={16} /> Execução indisponível no momento.{error ? ` ${error}` : ''}</div>
      </div>
    );
  }

  const t = progress.progress.trips;
  const q = progress.progress.quantity;
  const health = progress.health.state;
  const pct = q.target > 0 ? Math.min(100, Math.round((q.completed / q.target) * 100)) : null;

  return (
    <section className="space-y-4" aria-label="Execução da campanha">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Activity size={16} /> Execução da campanha</h3>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${HEALTH_TONE[health] || HEALTH_TONE.NO_EXECUTION_YET}`}>
              {(health === 'CRITICAL' || health === 'ATTENTION') && <AlertTriangle size={12} />}
              {HEALTH_LABEL[health] || health}
            </span>
            {progress.approved_plan && <span className="text-xs text-slate-500">Plano v{progress.approved_plan.version_number}</span>}
            {progress.window && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">{progress.window.state}</span>}
            <button onClick={carregar} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"><RefreshCw size={13} /> Atualizar</button>
          </div>
        </div>
        <p className="mt-1 text-xs text-slate-500">{progress.health.reason_text}</p>
        <p className="mt-1 text-[11px] text-slate-400">Atualizado em {new Date(progress.updated_at).toLocaleString('pt-BR')}{stale && ' — dados podem estar desatualizados'}</p>
      </div>

      {progress.replan.status !== 'REPLAN_NOT_NEEDED' && (
        <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${progress.replan.status === 'REPLAN_REQUIRED_BY_INVARIANT' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
          <AlertTriangle size={16} className="mt-0.5" />
          <div>
            <p className="font-semibold">{progress.replan.status === 'REPLAN_REQUIRED_BY_INVARIANT' ? 'Replanejamento necessário' : 'Replanejamento recomendado'}</p>
            <p>{progress.replan.suggested_next_step || progress.replan.reason_code}</p>
            {progress.replan.remaining_quantity > 0 && <p className="text-xs">Demanda restante: {num(progress.replan.remaining_quantity)} {progress.replan.quantity_unit}</p>}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <Metric label="Meta" value={`${num(q.target)} ${q.unit}`} />
          <Metric label="Planejado" value={String(t.planned_total)} />
          <Metric label="Materializado" value={String(t.materialized)} />
          <Metric label="Em execução" value={String(t.in_execution)} />
          <Metric label="Concluído" value={String(t.completed)} />
          <Metric label="Cancelado" value={String(t.cancelled)} />
          <Metric label="Restante" value={`${num(q.remaining)} ${q.unit}`} />
        </div>
        {pct !== null && (
          <div className="mt-3">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              {num(q.completed)} de {num(q.target)} {q.unit} concluído(s) ({pct}%). Fonte: quantidade planejada do frete{q.coverage.incompatible_units ? ' — unidades incompatíveis, ver por dimensão' : ''}.
            </p>
          </div>
        )}
        {(t.blocked > 0 || t.not_materialized > 0 || t.unknown > 0) && (
          <p className="mt-2 text-xs text-slate-500">
            {t.not_materialized > 0 && <span className="mr-3">Não materializado: {t.not_materialized}</span>}
            {t.blocked > 0 && <span className="mr-3 text-rose-600">Bloqueado (plano): {t.blocked}</span>}
            {t.unknown > 0 && <span className="text-amber-600">Estado desconhecido: {t.unknown}</span>}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 text-sm font-semibold text-slate-800">Viagens</div>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Rota</th>
                <th className="px-3 py-2">Qtd.</th>
                <th className="px-3 py-2">Materialização</th>
                <th className="px-3 py-2">Execução</th>
                <th className="px-3 py-2">Prontidão</th>
                <th className="px-3 py-2">Atenção</th>
                <th className="px-3 py-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {progress.trips_detail.map((trip) => (
                <tr key={trip.planned_trip_id} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-700">{trip.origem || '—'} → {trip.destino || '—'}</td>
                  <td className="px-3 py-2">{num(trip.planned_quantity)} {trip.quantity_unit}</td>
                  <td className="px-3 py-2">{trip.materialization === 'MATERIALIZED' ? 'Materializado' : trip.materialization === 'NOT_APPLICABLE' ? '—' : 'Não materializado'}</td>
                  <td className="px-3 py-2">{trip.execution_bucket ? (BUCKET_LABEL[trip.execution_bucket] || trip.execution_bucket) : '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${trip.readiness === 'BLOCKED' ? 'border-rose-200 bg-rose-50 text-rose-700' : trip.readiness === 'COMPLETED' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                      {READINESS_LABEL[trip.readiness] || trip.readiness}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-amber-700">{trip.attention.length ? trip.attention.join(', ') : '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      {trip.frete_id && (
                        <Link to={`/relatorios/viagens?frete=${encodeURIComponent(trip.frete_id)}`} className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"><ExternalLink size={12} /> Frete</Link>
                      )}
                      {(trip.readiness === 'BLOCKED' || trip.materialization === 'NOT_MATERIALIZED') && trip.materialization !== 'NOT_APPLICABLE' && (
                        <button onClick={() => verElegibilidade(trip)} className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:underline"><Users size={12} /> Despachar</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!progress.trips_detail.length && (
                <tr><td colSpan={7} className="px-3 py-5 text-center text-sm text-slate-500">Nenhuma viagem planejada neste plano.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {eligTrip && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Users size={15} /> Despacho — {eligTrip.origem || '—'} → {eligTrip.destino || '—'}</h4>
            <button onClick={() => { setEligTrip(null); setElig(null); }} className="text-xs text-slate-500 hover:underline">Fechar</button>
          </div>
          {eligLoading && <p className="text-sm text-slate-500">Calculando candidatos…</p>}
          {dispatchErro && <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{dispatchErro}</p>}

          {dispatchRound && (
            <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <p className="font-semibold">
                {dispatchRound.mode === 'DIRECT' ? 'Designação direta' : 'Rodada de oferta'} — {dispatchRound.status === 'ASSIGNED' ? 'designado' : dispatchRound.status === 'OPEN' ? 'aguardando resposta' : dispatchRound.status === 'CANCELLED' ? 'cancelada' : dispatchRound.status.toLowerCase()}
              </p>
              {dispatchRound.status === 'OPEN' && (
                <>
                  <p className="mt-1">{dispatchOffers.filter((o) => o.status === 'PENDING').length} oferta(s) pendente(s) de {dispatchOffers.length}. Válida até {dispatchRound.expires_at ? new Date(dispatchRound.expires_at).toLocaleString('pt-BR') : '—'}.</p>
                  <button onClick={cancelarOferta} disabled={dispatchAcao === 'cancelar'} className="mt-2 inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-white px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60">
                    <XCircle size={12} /> {dispatchAcao === 'cancelar' ? 'Cancelando…' : 'Cancelar rodada'}
                  </button>
                </>
              )}
            </div>
          )}

          {!eligLoading && elig && !(dispatchRound && dispatchRound.status !== 'CANCELLED') && (
            <>
              <p className="mb-2 text-xs text-slate-500">{elig.summary.eligible} elegível(is), {elig.summary.eligible_with_warnings} com alertas, {elig.summary.ineligible} inelegível(is){elig.truncated ? ' (lista limitada)' : ''}.</p>

              <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 sm:grid-cols-4">
                <label className="text-xs text-slate-600 sm:col-span-1">
                  <span>Modalidade</span>
                  <select value={dispatchForm.modalidade_calculo} onChange={(e) => setDispatchForm({ ...dispatchForm, modalidade_calculo: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm">
                    <option value="valor_fixo">Valor fixo</option>
                    <option value="tonelada_km">Tonelada/km</option>
                  </select>
                </label>
                {dispatchForm.modalidade_calculo === 'tonelada_km' ? (
                  <label className="text-xs text-slate-600">
                    <span>Valor por tonelada/km</span>
                    <input type="number" min="0" step="0.0001" value={dispatchForm.valor_tonelada_km} onChange={(e) => setDispatchForm({ ...dispatchForm, valor_tonelada_km: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm" />
                  </label>
                ) : (
                  <label className="text-xs text-slate-600">
                    <span>Valor por frete</span>
                    <input type="number" min="0" step="0.01" value={dispatchForm.valor_frete} onChange={(e) => setDispatchForm({ ...dispatchForm, valor_frete: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm" />
                  </label>
                )}
                <label className="text-xs text-slate-600">
                  <span>Validade da oferta (min)</span>
                  <input type="number" min="1" step="1" value={dispatchForm.validade_minutos} onChange={(e) => setDispatchForm({ ...dispatchForm, validade_minutos: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm" />
                </label>
                <div className="flex items-end">
                  <button onClick={criarOferta} disabled={dispatchAcao !== null} className="inline-flex w-full items-center justify-center gap-1 rounded-lg bg-emerald-700 px-2 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
                    {dispatchAcao === 'oferta' ? 'Criando…' : selecionados.size ? `Ofertar a ${selecionados.size} selecionado(s)` : 'Ofertar a todos elegíveis'}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {elig.candidates.map((c, i) => {
                  const key = candidateKey(c);
                  const podeDespachar = c.eligibility === 'ELIGIBLE' || c.eligibility === 'ELIGIBLE_WITH_WARNINGS';
                  return (
                    <div key={`${key}-${i}`} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-2 font-medium text-slate-800">
                          {podeDespachar && (
                            <input type="checkbox" checked={selecionados.has(key)} onChange={() => alternarSelecao(key)} className="h-3.5 w-3.5 rounded border-slate-300" aria-label="Selecionar para oferta" />
                          )}
                          {c.composition_id ? 'Composição' : 'Ativo'} · motorista {c.driver_id ? c.driver_id.slice(0, 8) : '—'}
                        </span>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${c.eligibility === 'ELIGIBLE' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : c.eligibility === 'ELIGIBLE_WITH_WARNINGS' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>{ELIG_LABEL[c.eligibility] || c.eligibility}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        Capacidade: {c.capacity_match} · Documentos: {c.documents_status} · Manutenção: {c.maintenance_status} · Rota: {c.route_compatibility}
                      </p>
                      {!!c.reasons.length && <p className="mt-1 text-xs text-rose-600">Bloqueios: {c.reasons.join(', ')}</p>}
                      {!!c.warnings.length && <p className="mt-1 text-xs text-amber-600">Alertas: {c.warnings.join(', ')}</p>}
                      {podeDespachar && (
                        <button onClick={() => designarDireto(c)} disabled={dispatchAcao !== null} className="mt-2 inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60">
                          <Play size={12} /> {dispatchAcao === key ? 'Designando…' : 'Designar diretamente'}
                        </button>
                      )}
                    </div>
                  );
                })}
                {!elig.candidates.length && <p className="text-sm text-slate-500">Nenhum candidato encontrado no escopo.</p>}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
