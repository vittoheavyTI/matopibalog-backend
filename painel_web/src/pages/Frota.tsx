import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  ClipboardList,
  Eye,
  FileText,
  Gauge,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Truck,
  Trash2,
  UserRoundCheck,
  Wrench,
  X,
} from 'lucide-react';
import api from '../api';
import { ArquivoPreviewModal, type ArquivoPreview } from '../components/ArquivoPreviewModal';
import { usePermissions } from '../hooks/usePermissions';

type Asset = {
  id: string;
  asset_type: string;
  internal_identifier: string;
  plate?: string | null;
  brand?: string | null;
  model?: string | null;
  status: string;
};

type CompositionMember = {
  id: string;
  asset_id: string;
  member_role: string;
  position_label?: string | null;
  valid_until?: string | null;
};

type Composition = {
  id: string;
  code: string;
  name?: string | null;
  status: string;
  vehicle_composition_members?: CompositionMember[];
};

type TireInstallation = {
  id: string;
  asset_id: string;
  position_label: string;
  installed_at?: string | null;
  removed_at?: string | null;
};

type TireEvent = {
  id: string;
  event_type: string;
  occurred_at?: string | null;
  reason?: string | null;
};

type Tire = {
  id: string;
  fire_number: string;
  brand?: string | null;
  model?: string | null;
  size?: string | null;
  status: string;
  current_asset_id?: string | null;
  tire_installations?: TireInstallation[];
  tire_events?: TireEvent[];
};

type Maintenance = {
  id: string;
  asset_id: string;
  maintenance_type: string;
  category: string;
  status: string;
  supplier?: string | null;
  work_order?: string | null;
  notes?: string | null;
  scheduled_at?: string | null;
  created_at?: string | null;
};

type FleetDocument = {
  id: string;
  asset_id: string;
  document_type: string;
  storage_path: string;
  status: string;
  expires_at?: string | null;
  nome_arquivo?: string | null;
  nome_documento?: string | null;
  mime?: string | null;
};

type DriverAssignment = {
  id: string;
  driver_id: string;
  asset_id?: string | null;
  composition_id?: string | null;
  assignment_status?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
};

type FreightAssignment = {
  id: string;
  frete_id: string;
  asset_id?: string | null;
  composition_id?: string | null;
  assignment_status?: string | null;
  assigned_from?: string | null;
};

type OdometerEvent = {
  id: string;
  asset_id: string;
  event_type: string;
  reading_km: number;
  occurred_at?: string | null;
};

type AssetDetail = {
  asset: Asset;
  current_compositions?: CompositionMember[];
  composition_memberships?: CompositionMember[];
  driver_assignments?: DriverAssignment[];
  freight_assignments?: FreightAssignment[];
  documents?: FleetDocument[];
  odometers?: OdometerEvent[];
  maintenance?: Maintenance[];
  tires?: Tire[];
  legacy_bridge?: { message?: string };
};

type CompositionDetail = {
  composition: Composition;
  members?: (CompositionMember & { fleet_assets?: Asset })[];
  driver_assignments?: DriverAssignment[];
  freight_assignments?: FreightAssignment[];
  legacy_bridge?: { message?: string };
};

type Overview = {
  summary: {
    assets_total: number;
    assets_active: number;
    assets_available: number;
    compositions_active: number;
    tires_installed: number;
    tires_stock: number;
    maintenance_open: number;
    documents_attention: number;
    active_freight_assignments: number;
  };
  attention: { code: string; label: string; count: number }[];
  assets: Asset[];
  compositions: Composition[];
  tires: Tire[];
  maintenance: Maintenance[];
  documents: FleetDocument[];
  driver_assignments: DriverAssignment[];
  freight_assignments?: FreightAssignment[];
  odometers?: OdometerEvent[];
};

type Motorista = { id: string; nome: string };

const assetTypeLabel: Record<string, string> = {
  truck: 'Caminhao',
  tractor: 'Cavalo mecanico',
  semitrailer: 'Semirreboque',
  trailer: 'Reboque',
  dolly: 'Dolly',
  implement: 'Implemento',
  other: 'Outro',
};

const statusLabel: Record<string, string> = {
  active: 'Ativo',
  inactive: 'Inativo',
  maintenance: 'Manutencao',
  sold: 'Vendido',
  archived: 'Arquivado',
  stock: 'Estoque',
  installed: 'Instalado',
  retread: 'Recapagem',
  retired: 'Baixado',
  lost: 'Perdido',
  open: 'Aberta',
  scheduled: 'Agendada',
  completed: 'Concluida',
  cancelled: 'Cancelada',
};

const maintenanceCategoryLabel: Record<string, string> = {
  engine: 'Motor',
  transmission: 'Transmissao',
  oil: 'Oleo',
  filters: 'Filtros',
  brake: 'Freio',
  suspension: 'Suspensao',
  electrical: 'Eletrica',
  tires: 'Pneus',
  other: 'Outros',
};

const emptyOverview: Overview = {
  summary: {
    assets_total: 0,
    assets_active: 0,
    assets_available: 0,
    compositions_active: 0,
    tires_installed: 0,
    tires_stock: 0,
    maintenance_open: 0,
    documents_attention: 0,
    active_freight_assignments: 0,
  },
  attention: [],
  assets: [],
  compositions: [],
  tires: [],
  maintenance: [],
  documents: [],
  driver_assignments: [],
  freight_assignments: [],
  odometers: [],
};

const apiMessage = (error: unknown, fallback: string) => {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message || fallback;
  }
  return fallback;
};

const shortDate = (iso?: string | null) => {
  if (!iso) return '-';
  const date = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('pt-BR');
};

const assetLabel = (asset?: Asset) => {
  if (!asset) return '-';
  return [asset.plate, asset.internal_identifier].filter(Boolean).join(' - ') || asset.id;
};

const metricCards = [
  ['assets_active', 'Ativos operando', Truck],
  ['assets_available', 'Disponiveis', ShieldCheck],
  ['compositions_active', 'Composicoes ativas', Boxes],
  ['tires_installed', 'Pneus instalados', Gauge],
  ['tires_stock', 'Pneus em estoque', Gauge],
  ['maintenance_open', 'Manutencoes abertas', Wrench],
  ['documents_attention', 'Documentos em atencao', FileText],
] as const;

export const Frota: React.FC = () => {
  const { can } = usePermissions();
  const canManage = can('fleet.manage');
  const [overview, setOverview] = useState<Overview>(emptyOverview);
  const [motoristas, setMotoristas] = useState<Motorista[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [assetType, setAssetType] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [assetDetail, setAssetDetail] = useState<AssetDetail | null>(null);
  const [compositionDetail, setCompositionDetail] = useState<CompositionDetail | null>(null);
  const [arquivoPreview, setArquivoPreview] = useState<ArquivoPreview | null>(null);
  const [panel, setPanel] = useState('asset');
  const [assetForm, setAssetForm] = useState({ asset_type: 'tractor', internal_identifier: '', plate: '', brand: '', model: '' });
  const [compositionForm, setCompositionForm] = useState({ code: '', name: '', asset_id: '', member_role: 'primary_power' });
  const [driverForm, setDriverForm] = useState({ driver_id: '', target_type: 'composition', target_id: '' });
  const [tireForm, setTireForm] = useState({ fire_number: '', brand: '', model: '', size: '', current_asset_id: '', position_label: '' });
  const [maintenanceForm, setMaintenanceForm] = useState({ asset_id: '', maintenance_type: 'preventive', category: 'other', status: 'open', supplier: '', work_order: '', cost: '', odometer_km: '', scheduled_at: '', completed_at: '', downtime_minutes: '', notes: '' });
  const [documentForm, setDocumentForm] = useState({ asset_id: '', document_type: '', nome_documento: '', descricao: '', expires_at: '', file: null as File | null });
  const [odometerForm, setOdometerForm] = useState({ asset_id: '', reading_km: '', event_type: 'manual' });

  const assetById = useMemo(() => {
    const map = new Map<string, Asset>();
    overview.assets.forEach((asset) => map.set(asset.id, asset));
    return map;
  }, [overview.assets]);

  const driverById = useMemo(() => {
    const map = new Map<string, string>();
    motoristas.forEach((motorista) => map.set(motorista.id, motorista.nome));
    return map;
  }, [motoristas]);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro('');
    try {
      const { data } = await api.get('/fleet/overview', {
        params: {
          q: q || undefined,
          status: status || undefined,
          asset_type: assetType || undefined,
        },
      });
      setOverview({ ...emptyOverview, ...(data || {}) });
    } catch (error) {
      setErro(apiMessage(error, 'Nao foi possivel carregar a frota.'));
    } finally {
      setLoading(false);
    }
  }, [assetType, q, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void carregar(); }, 0);
    return () => window.clearTimeout(timer);
  }, [carregar]);

  useEffect(() => {
    api.get('/admin/motoristas')
      .then(({ data }) => {
        const lista = (Array.isArray(data) ? data : []).map((motorista: { id: string; usuarios?: { nome?: string | null } | null }) => ({
          id: motorista.id,
          nome: motorista.usuarios?.nome || motorista.id,
        }));
        setMotoristas(lista);
      })
      .catch(() => setMotoristas([]));
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const runMutation = async (action: () => Promise<unknown>, success: string) => {
    setSaving(true);
    try {
      await action();
      setToast({ kind: 'ok', text: success });
      await carregar();
    } catch (error) {
      setToast({ kind: 'error', text: apiMessage(error, 'Nao foi possivel salvar a operacao de frota.') });
    } finally {
      setSaving(false);
    }
  };

  const abrirAtivo = async (assetId: string) => {
    setDetailLoading(true);
    setCompositionDetail(null);
    try {
      const { data } = await api.get(`/fleet/assets/${assetId}`);
      setAssetDetail(data);
    } catch (error) {
      setToast({ kind: 'error', text: apiMessage(error, 'Nao foi possivel abrir o detalhe do ativo.') });
    } finally {
      setDetailLoading(false);
    }
  };

  const abrirComposicao = async (compositionId: string) => {
    setDetailLoading(true);
    setAssetDetail(null);
    try {
      const { data } = await api.get(`/fleet/compositions/${compositionId}`);
      setCompositionDetail(data);
    } catch (error) {
      setToast({ kind: 'error', text: apiMessage(error, 'Nao foi possivel abrir a composicao.') });
    } finally {
      setDetailLoading(false);
    }
  };

  const fecharDetalhe = () => {
    setAssetDetail(null);
    setCompositionDetail(null);
  };

  const visualizarDocumento = async (documento: FleetDocument) => {
    try {
      const { data } = await api.get(`/fleet/assets/${documento.asset_id}/documents/${documento.id}/url`);
      setArquivoPreview({
        url: data.url,
        nome: data.nome_documento || data.nome_arquivo || documento.nome_documento || documento.nome_arquivo || documento.document_type,
        mime: data.mime || documento.mime,
      });
    } catch (error) {
      setToast({ kind: 'error', text: apiMessage(error, 'Nao foi possivel gerar a pre-visualizacao.') });
    }
  };

  const criarAtivo = (event: React.FormEvent) => {
    event.preventDefault();
    void runMutation(async () => {
      await api.post('/fleet/assets', assetForm);
      setAssetForm({ asset_type: 'tractor', internal_identifier: '', plate: '', brand: '', model: '' });
    }, 'Ativo cadastrado.');
  };

  const criarComposicao = (event: React.FormEvent) => {
    event.preventDefault();
    void runMutation(async () => {
      const { data } = await api.post('/fleet/compositions', { code: compositionForm.code, name: compositionForm.name });
      if (compositionForm.asset_id && data?.id) {
        await api.post(`/fleet/compositions/${data.id}/members`, {
          asset_id: compositionForm.asset_id,
          member_role: compositionForm.member_role,
          position_order: 1,
        });
      }
      setCompositionForm({ code: '', name: '', asset_id: '', member_role: 'primary_power' });
    }, 'Composicao montada.');
  };

  const atribuirMotorista = (event: React.FormEvent) => {
    event.preventDefault();
    const payload = driverForm.target_type === 'asset'
      ? { driver_id: driverForm.driver_id, asset_id: driverForm.target_id }
      : { driver_id: driverForm.driver_id, composition_id: driverForm.target_id };
    void runMutation(async () => {
      await api.post('/fleet/driver-handoffs', payload);
      setDriverForm({ driver_id: '', target_type: 'composition', target_id: '' });
    }, 'Motorista trocado com fechamento dos vinculos anteriores.');
  };

  const registrarPneu = (event: React.FormEvent) => {
    event.preventDefault();
    void runMutation(async () => {
      const { data } = await api.post('/fleet/tires', {
        fire_number: tireForm.fire_number,
        brand: tireForm.brand,
        model: tireForm.model,
        size: tireForm.size,
        status: 'stock',
      });
      if (tireForm.current_asset_id && data?.id) {
        await api.post(`/fleet/tires/${data.id}/installations`, {
          asset_id: tireForm.current_asset_id,
          position_label: tireForm.position_label,
        });
      }
      setTireForm({ fire_number: '', brand: '', model: '', size: '', current_asset_id: '', position_label: '' });
    }, 'Pneu registrado.');
  };

  const registrarManutencao = (event: React.FormEvent) => {
    event.preventDefault();
    void runMutation(async () => {
      await api.post('/fleet/maintenance', maintenanceForm);
      setMaintenanceForm({ asset_id: '', maintenance_type: 'preventive', category: 'other', status: 'open', supplier: '', work_order: '', cost: '', odometer_km: '', scheduled_at: '', completed_at: '', downtime_minutes: '', notes: '' });
    }, 'Manutencao registrada.');
  };

  const registrarDocumento = (event: React.FormEvent) => {
    event.preventDefault();
    void runMutation(async () => {
      if (!documentForm.file) throw new Error('missing_file');
      const formData = new FormData();
      formData.append('document_type', documentForm.document_type);
      formData.append('documento', documentForm.file);
      if (documentForm.nome_documento) formData.append('nome_documento', documentForm.nome_documento);
      if (documentForm.descricao) formData.append('descricao', documentForm.descricao);
      if (documentForm.expires_at) formData.append('expires_at', documentForm.expires_at);
      formData.append('client_request_id', `fleet-doc:${documentForm.asset_id}:${Date.now()}`);
      await api.post(`/fleet/assets/${documentForm.asset_id}/documents`, formData);
      setDocumentForm({ asset_id: '', document_type: '', nome_documento: '', descricao: '', expires_at: '', file: null });
    }, 'Documento enviado ao ativo.');
  };

  const registrarOdometro = (event: React.FormEvent) => {
    event.preventDefault();
    void runMutation(async () => {
      await api.post('/fleet/odometer-events', odometerForm);
      setOdometerForm({ asset_id: '', reading_km: '', event_type: 'manual' });
    }, 'Odometro registrado.');
  };

  const removerPneu = (installationId: string) => {
    void runMutation(async () => {
      await api.patch(`/fleet/tire-installations/${installationId}/remove`, { removal_reason: 'remocao_web' });
    }, 'Pneu removido da posicao.');
  };

  const tabs = [
    ['asset', 'Cadastrar ativo', Truck],
    ['composition', 'Montar composicao', Boxes],
    ['driver', 'Atribuir motorista', UserRoundCheck],
    ['tire', 'Registrar pneu', Gauge],
    ['maintenance', 'Registrar manutencao', Wrench],
    ['document', 'Adicionar documento', FileText],
    ['odometer', 'Registrar odometro', ClipboardList],
  ] as const;

  const activeDriverFor = (target: { asset_id?: string | null; composition_id?: string | null }) => {
    const assignment = overview.driver_assignments.find((item) => (
      (target.asset_id && item.asset_id === target.asset_id) || (target.composition_id && item.composition_id === target.composition_id)
    ));
    return assignment ? driverById.get(assignment.driver_id) || assignment.driver_id : 'Sem motorista ativo';
  };

  const hasFleetData = overview.assets.length > 0 || overview.compositions.length > 0 || overview.tires.length > 0 || overview.maintenance.length > 0;

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4">
      {toast && (
        <div role="status" className={`fixed right-6 top-20 z-30 rounded-lg px-4 py-3 text-sm font-semibold shadow ${toast.kind === 'ok' ? 'bg-green-700 text-white' : 'bg-red-600 text-white'}`}>
          {toast.text}
        </div>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Truck className="text-green-700" size={24} aria-hidden="true" />
            <h1 className="text-2xl font-bold text-gray-900">Frota</h1>
          </div>
          <p className="mt-1 text-sm text-gray-500">Disponibilidade, pendencias, composicoes, ativos, pneus e manutencao.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(190px,1fr)_150px_150px_auto]">
          <label className="relative text-xs font-medium text-gray-600">
            Buscar
            <Search className="pointer-events-none absolute bottom-2.5 left-2 text-gray-400" size={14} aria-hidden="true" />
            <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Placa, codigo ou identificador" className="mt-1 w-full rounded-lg border border-gray-300 py-2 pl-8 pr-3 text-sm" />
          </label>
          <label className="text-xs font-medium text-gray-600">
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="">Todos</option>
              <option value="active">Ativo</option>
              <option value="maintenance">Manutencao</option>
              <option value="inactive">Inativo</option>
              <option value="archived">Arquivado</option>
            </select>
          </label>
          <label className="text-xs font-medium text-gray-600">
            Tipo
            <select value={assetType} onChange={(event) => setAssetType(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="">Todos</option>
              {Object.entries(assetTypeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <button onClick={carregar} disabled={loading} className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>
      </div>

      {erro && (
        <div role="alert" className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {erro}
        </div>
      )}

      <section aria-labelledby="resumo-frota">
        <h2 id="resumo-frota" className="mb-2 text-sm font-bold uppercase text-gray-500">Resumo Operacional</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {metricCards.map(([key, label, Icon]) => (
            <div key={key} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-gray-500">
                <Icon size={16} aria-hidden="true" /> {label}
              </div>
              <p className="mt-2 text-2xl font-bold text-gray-900">{overview.summary[key]}</p>
            </div>
          ))}
        </div>
      </section>

      {!loading && !hasFleetData && (
        <section className="rounded-lg border border-dashed border-green-300 bg-green-50 p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-bold text-green-900">Cadastre o primeiro ativo</h2>
              <p className="mt-1 text-sm text-green-800">Depois monte uma composicao para transformar a base da Fleet Foundation em operacao diaria.</p>
            </div>
            {canManage && (
              <button onClick={() => setPanel('asset')} className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800">
                <Plus size={16} /> Comecar pela frota
              </button>
            )}
          </div>
        </section>
      )}

      <section aria-labelledby="pendencias-frota" className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="pendencias-frota" className="text-lg font-bold text-gray-900">Pendencias</h2>
          <AlertTriangle className={overview.attention.length ? 'text-amber-600' : 'text-green-600'} size={20} aria-hidden="true" />
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {overview.attention.length === 0 ? (
            <div className="rounded-lg border border-green-100 bg-green-50 px-3 py-3 text-sm font-semibold text-green-800">Nenhuma excecao operacional ativa.</div>
          ) : overview.attention.map((item) => (
            <div key={item.code} className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-3">
              <p className="text-sm font-bold text-amber-900">{item.label}</p>
              <p className="text-2xl font-bold text-amber-700">{item.count}</p>
            </div>
          ))}
        </div>
      </section>

      {canManage && (
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap gap-2">
            {tabs.map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPanel(id)}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${panel === id ? 'bg-gray-900 text-white' : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
              >
                <Icon size={16} aria-hidden="true" /> {label}
              </button>
            ))}
          </div>

          {panel === 'asset' && (
            <form onSubmit={criarAtivo} className="grid gap-3 md:grid-cols-6">
              <select value={assetForm.asset_type} onChange={(event) => setAssetForm({ ...assetForm, asset_type: event.target.value })} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                {Object.entries(assetTypeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <input required value={assetForm.internal_identifier} onChange={(event) => setAssetForm({ ...assetForm, internal_identifier: event.target.value })} placeholder="Identificador" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input value={assetForm.plate} onChange={(event) => setAssetForm({ ...assetForm, plate: event.target.value.toUpperCase() })} placeholder="Placa" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input value={assetForm.brand} onChange={(event) => setAssetForm({ ...assetForm, brand: event.target.value })} placeholder="Marca" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input value={assetForm.model} onChange={(event) => setAssetForm({ ...assetForm, model: event.target.value })} placeholder="Modelo" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <button disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-60"><Plus size={16} /> Salvar</button>
            </form>
          )}

          {panel === 'composition' && (
            <form onSubmit={criarComposicao} className="grid gap-3 md:grid-cols-5">
              <input required value={compositionForm.code} onChange={(event) => setCompositionForm({ ...compositionForm, code: event.target.value })} placeholder="Codigo da composicao" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input value={compositionForm.name} onChange={(event) => setCompositionForm({ ...compositionForm, name: event.target.value })} placeholder="Nome operacional" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <select value={compositionForm.asset_id} onChange={(event) => setCompositionForm({ ...compositionForm, asset_id: event.target.value })} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">Adicionar ativo depois</option>
                {overview.assets.map((asset) => <option key={asset.id} value={asset.id}>{assetLabel(asset)}</option>)}
              </select>
              <select value={compositionForm.member_role} onChange={(event) => setCompositionForm({ ...compositionForm, member_role: event.target.value })} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="primary_power">Tracao principal</option>
                <option value="trailer">Carreta</option>
                <option value="dolly">Dolly</option>
                <option value="implement">Implemento</option>
                <option value="accessory">Acessorio</option>
              </select>
              <button disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-60"><Boxes size={16} /> Montar</button>
            </form>
          )}

          {panel === 'driver' && (
            <form onSubmit={atribuirMotorista} className="grid gap-3 md:grid-cols-4">
              <select required value={driverForm.driver_id} onChange={(event) => setDriverForm({ ...driverForm, driver_id: event.target.value })} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">Motorista</option>
                {motoristas.map((motorista) => <option key={motorista.id} value={motorista.id}>{motorista.nome}</option>)}
              </select>
              <select value={driverForm.target_type} onChange={(event) => setDriverForm({ ...driverForm, target_type: event.target.value, target_id: '' })} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="composition">Composicao</option>
                <option value="asset">Ativo isolado</option>
              </select>
              <select required value={driverForm.target_id} onChange={(event) => setDriverForm({ ...driverForm, target_id: event.target.value })} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">Destino</option>
                {driverForm.target_type === 'asset'
                  ? overview.assets.map((asset) => <option key={asset.id} value={asset.id}>{assetLabel(asset)}</option>)
                  : overview.compositions.map((composition) => <option key={composition.id} value={composition.id}>{composition.code}</option>)}
              </select>
              <button disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-60"><UserRoundCheck size={16} /> Atribuir</button>
            </form>
          )}

          {panel === 'tire' && (
            <form onSubmit={registrarPneu} className="grid gap-3 md:grid-cols-7">
              <input required value={tireForm.fire_number} onChange={(event) => setTireForm({ ...tireForm, fire_number: event.target.value })} placeholder="Numero de fogo" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input value={tireForm.brand} onChange={(event) => setTireForm({ ...tireForm, brand: event.target.value })} placeholder="Marca" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input value={tireForm.model} onChange={(event) => setTireForm({ ...tireForm, model: event.target.value })} placeholder="Modelo" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input value={tireForm.size} onChange={(event) => setTireForm({ ...tireForm, size: event.target.value })} placeholder="Medida" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <select value={tireForm.current_asset_id} onChange={(event) => setTireForm({ ...tireForm, current_asset_id: event.target.value })} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">Estoque</option>
                {overview.assets.map((asset) => <option key={asset.id} value={asset.id}>{assetLabel(asset)}</option>)}
              </select>
              <input required={Boolean(tireForm.current_asset_id)} value={tireForm.position_label} onChange={(event) => setTireForm({ ...tireForm, position_label: event.target.value })} placeholder="Posicao" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <button disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-60"><Gauge size={16} /> Registrar</button>
            </form>
          )}

          {panel === 'maintenance' && (
            <form onSubmit={registrarManutencao} className="grid gap-3 md:grid-cols-6">
              <select required value={maintenanceForm.asset_id} onChange={(event) => setMaintenanceForm({ ...maintenanceForm, asset_id: event.target.value })} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">Ativo</option>
                {overview.assets.map((asset) => <option key={asset.id} value={asset.id}>{assetLabel(asset)}</option>)}
              </select>
              <select value={maintenanceForm.maintenance_type} onChange={(event) => setMaintenanceForm({ ...maintenanceForm, maintenance_type: event.target.value })} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="preventive">Preventiva</option>
                <option value="corrective">Corretiva</option>
              </select>
              <select value={maintenanceForm.category} onChange={(event) => setMaintenanceForm({ ...maintenanceForm, category: event.target.value })} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                {Object.entries(maintenanceCategoryLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select value={maintenanceForm.status} onChange={(event) => setMaintenanceForm({ ...maintenanceForm, status: event.target.value })} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="open">Aberta</option>
                <option value="scheduled">Agendada</option>
                <option value="completed">Concluida</option>
                <option value="cancelled">Cancelada</option>
              </select>
              <input value={maintenanceForm.work_order} onChange={(event) => setMaintenanceForm({ ...maintenanceForm, work_order: event.target.value })} placeholder="OS" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input value={maintenanceForm.supplier} onChange={(event) => setMaintenanceForm({ ...maintenanceForm, supplier: event.target.value })} placeholder="Fornecedor" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input type="number" min="0" step="0.01" value={maintenanceForm.cost} onChange={(event) => setMaintenanceForm({ ...maintenanceForm, cost: event.target.value })} placeholder="Custo" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input type="number" min="0" step="0.1" value={maintenanceForm.odometer_km} onChange={(event) => setMaintenanceForm({ ...maintenanceForm, odometer_km: event.target.value })} placeholder="Km" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input type="datetime-local" value={maintenanceForm.scheduled_at} onChange={(event) => setMaintenanceForm({ ...maintenanceForm, scheduled_at: event.target.value })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input type="datetime-local" value={maintenanceForm.completed_at} onChange={(event) => setMaintenanceForm({ ...maintenanceForm, completed_at: event.target.value })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input type="number" min="0" step="1" value={maintenanceForm.downtime_minutes} onChange={(event) => setMaintenanceForm({ ...maintenanceForm, downtime_minutes: event.target.value })} placeholder="Parada min" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input value={maintenanceForm.notes} onChange={(event) => setMaintenanceForm({ ...maintenanceForm, notes: event.target.value })} placeholder="Observacao" className="rounded-lg border border-gray-300 px-3 py-2 text-sm md:col-span-2" />
              <button disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-60"><Wrench size={16} /> Registrar</button>
            </form>
          )}

          {panel === 'document' && (
            <form onSubmit={registrarDocumento} className="grid gap-3 md:grid-cols-6">
              <select required value={documentForm.asset_id} onChange={(event) => setDocumentForm({ ...documentForm, asset_id: event.target.value })} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">Ativo</option>
                {overview.assets.map((asset) => <option key={asset.id} value={asset.id}>{assetLabel(asset)}</option>)}
              </select>
              <input required value={documentForm.document_type} onChange={(event) => setDocumentForm({ ...documentForm, document_type: event.target.value })} placeholder="Tipo de documento" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input value={documentForm.nome_documento} onChange={(event) => setDocumentForm({ ...documentForm, nome_documento: event.target.value })} placeholder="Nome do documento" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input value={documentForm.descricao} onChange={(event) => setDocumentForm({ ...documentForm, descricao: event.target.value })} placeholder="Descricao" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input type="date" value={documentForm.expires_at} onChange={(event) => setDocumentForm({ ...documentForm, expires_at: event.target.value })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input required type="file" accept=".pdf,.xml,image/jpeg,image/png,image/webp" onChange={(event) => setDocumentForm({ ...documentForm, file: event.target.files?.[0] || null })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <button disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-60 md:col-span-6"><FileText size={16} /> Enviar documento</button>
            </form>
          )}

          {panel === 'odometer' && (
            <form onSubmit={registrarOdometro} className="grid gap-3 md:grid-cols-4">
              <select required value={odometerForm.asset_id} onChange={(event) => setOdometerForm({ ...odometerForm, asset_id: event.target.value })} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">Ativo</option>
                {overview.assets.map((asset) => <option key={asset.id} value={asset.id}>{assetLabel(asset)}</option>)}
              </select>
              <input required type="number" min="0" step="0.1" value={odometerForm.reading_km} onChange={(event) => setOdometerForm({ ...odometerForm, reading_km: event.target.value })} placeholder="Leitura km" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <select value={odometerForm.event_type} onChange={(event) => setOdometerForm({ ...odometerForm, event_type: event.target.value })} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="manual">Manual</option>
                <option value="check_in">Check-in</option>
                <option value="check_out">Check-out</option>
                <option value="correction">Correcao</option>
              </select>
              <button disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-60"><ClipboardList size={16} /> Registrar</button>
            </form>
          )}
        </section>
      )}

      <section aria-labelledby="composicoes-frota" className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-4 py-3">
          <h2 id="composicoes-frota" className="text-lg font-bold text-gray-900">Composicoes</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {overview.compositions.length === 0 ? (
            <p className="p-6 text-sm text-gray-500">Nenhuma composicao cadastrada.</p>
          ) : overview.compositions.map((composition) => (
            <div key={composition.id} className="grid gap-3 px-4 py-3 md:grid-cols-[1.1fr_1.2fr_1fr_auto] md:items-center">
              <div>
                <p className="font-bold text-gray-900">{composition.code}</p>
                <p className="text-sm text-gray-500">{composition.name || 'Sem nome operacional'}</p>
              </div>
              <p className="text-sm text-gray-700">
                {(composition.vehicle_composition_members || []).filter((member) => !member.valid_until).length} ativo(s) vinculados
              </p>
              <p className="text-sm font-semibold text-gray-700">{activeDriverFor({ composition_id: composition.id })}</p>
              <button type="button" onClick={() => { void abrirComposicao(composition.id); }} className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                <Eye size={16} /> Detalhar
              </button>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="ativos-frota" className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-4 py-3">
          <h2 id="ativos-frota" className="text-lg font-bold text-gray-900">Ativos</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {overview.assets.length === 0 ? (
            <p className="p-6 text-sm text-gray-500">Nenhum ativo encontrado.</p>
          ) : overview.assets.map((asset) => (
            <div key={asset.id} className="grid gap-3 px-4 py-3 md:grid-cols-[1.2fr_1fr_1fr_1fr_auto] md:items-center">
              <div>
                <p className="font-bold text-gray-900">{assetLabel(asset)}</p>
                <p className="text-sm text-gray-500">{assetTypeLabel[asset.asset_type] || asset.asset_type}</p>
              </div>
              <p className="text-sm text-gray-700">{[asset.brand, asset.model].filter(Boolean).join(' ') || '-'}</p>
              <p className="text-sm font-semibold text-gray-700">{statusLabel[asset.status] || asset.status}</p>
              <p className="text-sm text-gray-600">{activeDriverFor({ asset_id: asset.id })}</p>
              <button type="button" onClick={() => { void abrirAtivo(asset.id); }} className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                <Eye size={16} /> Detalhar
              </button>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section aria-labelledby="pneus-frota" className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-4 py-3">
            <h2 id="pneus-frota" className="text-lg font-bold text-gray-900">Pneus</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {overview.tires.length === 0 ? (
              <p className="p-6 text-sm text-gray-500">Nenhum pneu registrado.</p>
            ) : overview.tires.map((tire) => (
              <div key={tire.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold text-gray-900">{tire.fire_number}</p>
                  <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">{statusLabel[tire.status] || tire.status}</span>
                </div>
                <p className="mt-1 text-sm text-gray-600">{[tire.brand, tire.model, tire.size].filter(Boolean).join(' - ') || '-'}</p>
                <p className="mt-1 text-xs text-gray-500">Ativo atual: {assetLabel(assetById.get(tire.current_asset_id || ''))}</p>
                <div className="mt-2 space-y-1">
                  {(tire.tire_installations || []).slice(0, 3).map((installation) => (
                    <div key={installation.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                      <span>{assetLabel(assetById.get(installation.asset_id))} / {installation.position_label} / {installation.removed_at ? `removido em ${shortDate(installation.removed_at)}` : 'instalado'}</span>
                      {canManage && !installation.removed_at && (
                        <button type="button" onClick={() => removerPneu(installation.id)} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2 py-1 font-semibold text-gray-700 hover:bg-gray-100">
                          <Trash2 size={13} /> Remover
                        </button>
                      )}
                    </div>
                  ))}
                  {(tire.tire_events || []).slice(0, 2).map((event) => (
                    <p key={event.id} className="text-xs text-gray-500">{event.event_type} em {shortDate(event.occurred_at)}{event.reason ? ` - ${event.reason}` : ''}</p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="manutencoes-frota" className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-4 py-3">
            <h2 id="manutencoes-frota" className="text-lg font-bold text-gray-900">Manutencoes</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {overview.maintenance.length === 0 ? (
              <p className="p-6 text-sm text-gray-500">Nenhuma manutencao registrada.</p>
            ) : overview.maintenance.map((item) => (
              <div key={item.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold text-gray-900">{maintenanceCategoryLabel[item.category] || item.category}</p>
                  <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">{statusLabel[item.status] || item.status}</span>
                </div>
                <p className="mt-1 text-sm text-gray-600">{assetLabel(assetById.get(item.asset_id))} - {item.supplier || 'Fornecedor nao informado'}</p>
                <p className="mt-1 text-xs text-gray-500">{item.notes || `Criada em ${shortDate(item.created_at)}`}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {(assetDetail || compositionDetail || detailLoading) && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-3" role="dialog" aria-modal="true">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <div>
                <p className="text-lg font-bold text-gray-900">
                  {assetDetail ? assetLabel(assetDetail.asset) : compositionDetail?.composition.code || 'Detalhe'}
                </p>
                <p className="text-xs font-semibold text-gray-500">
                  {assetDetail ? 'Ativo Fleet' : 'Composicao Fleet'}
                </p>
              </div>
              <button type="button" onClick={fecharDetalhe} className="rounded-lg p-2 text-gray-600 hover:bg-gray-100" aria-label="Fechar">
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto p-4">
              {detailLoading && <p className="text-sm font-semibold text-gray-500">Carregando detalhe...</p>}

              {assetDetail && !detailLoading && (
                <div className="grid gap-4 lg:grid-cols-2">
                  <section className="rounded-lg border border-gray-200 p-4">
                    <h3 className="font-bold text-gray-900">Operacao</h3>
                    <dl className="mt-3 grid gap-2 text-sm">
                      <div className="flex justify-between gap-3"><dt className="text-gray-500">Status</dt><dd className="font-semibold text-gray-800">{statusLabel[assetDetail.asset.status] || assetDetail.asset.status}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-gray-500">Tipo</dt><dd className="font-semibold text-gray-800">{assetTypeLabel[assetDetail.asset.asset_type] || assetDetail.asset.asset_type}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-gray-500">Motorista atual</dt><dd className="font-semibold text-gray-800">{activeDriverFor({ asset_id: assetDetail.asset.id })}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-gray-500">Composicao atual</dt><dd className="font-semibold text-gray-800">{assetDetail.current_compositions?.length || 0}</dd></div>
                    </dl>
                  </section>

                  <section className="rounded-lg border border-gray-200 p-4">
                    <h3 className="font-bold text-gray-900">Documentos</h3>
                    <div className="mt-3 space-y-2">
                      {(assetDetail.documents || []).length === 0 ? <p className="text-sm text-gray-500">Nenhum documento.</p> : assetDetail.documents?.map((documento) => (
                        <div key={documento.id} className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-gray-800">{documento.nome_documento || documento.nome_arquivo || documento.document_type}</p>
                            <p className="text-xs text-gray-500">{documento.expires_at ? `Vence em ${shortDate(documento.expires_at)}` : statusLabel[documento.status] || documento.status}</p>
                          </div>
                          <button type="button" onClick={() => { void visualizarDocumento(documento); }} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100">
                            <Eye size={14} /> Ver
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-lg border border-gray-200 p-4">
                    <h3 className="font-bold text-gray-900">Odometro</h3>
                    <div className="mt-3 space-y-2">
                      {(assetDetail.odometers || []).length === 0 ? <p className="text-sm text-gray-500">Sem leituras.</p> : assetDetail.odometers?.slice(0, 6).map((item) => (
                        <p key={item.id} className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{Number(item.reading_km).toLocaleString('pt-BR')} km / {item.event_type} / {shortDate(item.occurred_at)}</p>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-lg border border-gray-200 p-4">
                    <h3 className="font-bold text-gray-900">Pneus e manutencao</h3>
                    <div className="mt-3 space-y-2 text-sm text-gray-700">
                      {(assetDetail.tires || []).slice(0, 5).map((tire) => <p key={tire.id} className="rounded-lg bg-gray-50 px-3 py-2">{tire.fire_number} / {statusLabel[tire.status] || tire.status}</p>)}
                      {(assetDetail.maintenance || []).slice(0, 5).map((item) => <p key={item.id} className="rounded-lg bg-gray-50 px-3 py-2">{maintenanceCategoryLabel[item.category] || item.category} / {statusLabel[item.status] || item.status} / {shortDate(item.created_at)}</p>)}
                      {!(assetDetail.tires || []).length && !(assetDetail.maintenance || []).length && <p className="text-gray-500">Sem pneus ou manutencoes no detalhe.</p>}
                    </div>
                  </section>

                  <section className="rounded-lg border border-gray-200 p-4 lg:col-span-2">
                    <h3 className="font-bold text-gray-900">Vinculos e fretes</h3>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {(assetDetail.driver_assignments || []).slice(0, 5).map((item) => <p key={item.id} className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{driverById.get(item.driver_id) || item.driver_id} / {statusLabel[item.assignment_status || ''] || item.assignment_status || '-'} / {shortDate(item.valid_from)}</p>)}
                      {(assetDetail.freight_assignments || []).slice(0, 5).map((item) => <p key={item.id} className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">Frete {item.frete_id} / {statusLabel[item.assignment_status || ''] || item.assignment_status || '-'} / {shortDate(item.assigned_from)}</p>)}
                    </div>
                    <p className="mt-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">{assetDetail.legacy_bridge?.message}</p>
                  </section>
                </div>
              )}

              {compositionDetail && !detailLoading && (
                <div className="grid gap-4 lg:grid-cols-2">
                  <section className="rounded-lg border border-gray-200 p-4">
                    <h3 className="font-bold text-gray-900">Ativos da composicao</h3>
                    <div className="mt-3 space-y-2">
                      {(compositionDetail.members || []).length === 0 ? <p className="text-sm text-gray-500">Sem membros vinculados.</p> : compositionDetail.members?.map((member) => (
                        <p key={member.id} className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{assetLabel(member.fleet_assets || assetById.get(member.asset_id))} / {member.member_role} / {member.valid_until ? `encerrado em ${shortDate(member.valid_until)}` : 'ativo'}</p>
                      ))}
                    </div>
                  </section>
                  <section className="rounded-lg border border-gray-200 p-4">
                    <h3 className="font-bold text-gray-900">Motoristas e fretes</h3>
                    <div className="mt-3 space-y-2">
                      {(compositionDetail.driver_assignments || []).slice(0, 5).map((item) => <p key={item.id} className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{driverById.get(item.driver_id) || item.driver_id} / {statusLabel[item.assignment_status || ''] || item.assignment_status || '-'}</p>)}
                      {(compositionDetail.freight_assignments || []).slice(0, 5).map((item) => <p key={item.id} className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">Frete {item.frete_id} / {statusLabel[item.assignment_status || ''] || item.assignment_status || '-'}</p>)}
                      {!(compositionDetail.driver_assignments || []).length && !(compositionDetail.freight_assignments || []).length && <p className="text-sm text-gray-500">Sem vinculos recentes.</p>}
                    </div>
                  </section>
                  <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 lg:col-span-2">{compositionDetail.legacy_bridge?.message}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ArquivoPreviewModal arquivo={arquivoPreview} onClose={() => setArquivoPreview(null)} />
    </div>
  );
};
