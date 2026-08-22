import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  ClipboardList,
  FileText,
  Gauge,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Truck,
  UserRoundCheck,
  Wrench,
} from 'lucide-react';
import api from '../api';
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
  removed_at?: string | null;
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
};

type DriverAssignment = {
  id: string;
  driver_id: string;
  asset_id?: string | null;
  composition_id?: string | null;
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
  const [erro, setErro] = useState('');
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [panel, setPanel] = useState('asset');
  const [assetForm, setAssetForm] = useState({ asset_type: 'tractor', internal_identifier: '', plate: '', brand: '', model: '' });
  const [compositionForm, setCompositionForm] = useState({ code: '', name: '', asset_id: '', member_role: 'primary_power' });
  const [driverForm, setDriverForm] = useState({ driver_id: '', target_type: 'composition', target_id: '' });
  const [tireForm, setTireForm] = useState({ fire_number: '', brand: '', model: '', size: '', current_asset_id: '', position_label: '' });
  const [maintenanceForm, setMaintenanceForm] = useState({ asset_id: '', maintenance_type: 'preventive', category: 'other', status: 'open', supplier: '', notes: '' });
  const [documentForm, setDocumentForm] = useState({ asset_id: '', document_type: '', storage_path: '', expires_at: '' });
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
      await api.post('/fleet/driver-assignments', payload);
      setDriverForm({ driver_id: '', target_type: 'composition', target_id: '' });
    }, 'Motorista atribuido.');
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
      setMaintenanceForm({ asset_id: '', maintenance_type: 'preventive', category: 'other', status: 'open', supplier: '', notes: '' });
    }, 'Manutencao registrada.');
  };

  const registrarDocumento = (event: React.FormEvent) => {
    event.preventDefault();
    void runMutation(async () => {
      await api.post(`/fleet/assets/${documentForm.asset_id}/documents`, {
        document_type: documentForm.document_type,
        storage_path: documentForm.storage_path,
        expires_at: documentForm.expires_at || undefined,
      });
      setDocumentForm({ asset_id: '', document_type: '', storage_path: '', expires_at: '' });
    }, 'Documento vinculado ao ativo.');
  };

  const registrarOdometro = (event: React.FormEvent) => {
    event.preventDefault();
    void runMutation(async () => {
      await api.post('/fleet/odometer-events', odometerForm);
      setOdometerForm({ asset_id: '', reading_km: '', event_type: 'manual' });
    }, 'Odometro registrado.');
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
              <input value={maintenanceForm.supplier} onChange={(event) => setMaintenanceForm({ ...maintenanceForm, supplier: event.target.value })} placeholder="Fornecedor" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input value={maintenanceForm.notes} onChange={(event) => setMaintenanceForm({ ...maintenanceForm, notes: event.target.value })} placeholder="Observacao" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <button disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-60"><Wrench size={16} /> Registrar</button>
            </form>
          )}

          {panel === 'document' && (
            <form onSubmit={registrarDocumento} className="grid gap-3 md:grid-cols-5">
              <select required value={documentForm.asset_id} onChange={(event) => setDocumentForm({ ...documentForm, asset_id: event.target.value })} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">Ativo</option>
                {overview.assets.map((asset) => <option key={asset.id} value={asset.id}>{assetLabel(asset)}</option>)}
              </select>
              <input required value={documentForm.document_type} onChange={(event) => setDocumentForm({ ...documentForm, document_type: event.target.value })} placeholder="Tipo de documento" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input required value={documentForm.storage_path} onChange={(event) => setDocumentForm({ ...documentForm, storage_path: event.target.value })} placeholder="Link ou caminho do arquivo" className="rounded-lg border border-gray-300 px-3 py-2 text-sm md:col-span-2" />
              <input type="date" value={documentForm.expires_at} onChange={(event) => setDocumentForm({ ...documentForm, expires_at: event.target.value })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <button disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-60 md:col-span-5"><FileText size={16} /> Vincular documento</button>
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
            <div key={composition.id} className="grid gap-3 px-4 py-3 md:grid-cols-[1.1fr_1.2fr_1fr] md:items-center">
              <div>
                <p className="font-bold text-gray-900">{composition.code}</p>
                <p className="text-sm text-gray-500">{composition.name || 'Sem nome operacional'}</p>
              </div>
              <p className="text-sm text-gray-700">
                {(composition.vehicle_composition_members || []).filter((member) => !member.valid_until).length} ativo(s) vinculados
              </p>
              <p className="text-sm font-semibold text-gray-700">{activeDriverFor({ composition_id: composition.id })}</p>
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
            <div key={asset.id} className="grid gap-3 px-4 py-3 md:grid-cols-[1.2fr_1fr_1fr_1fr] md:items-center">
              <div>
                <p className="font-bold text-gray-900">{assetLabel(asset)}</p>
                <p className="text-sm text-gray-500">{assetTypeLabel[asset.asset_type] || asset.asset_type}</p>
              </div>
              <p className="text-sm text-gray-700">{[asset.brand, asset.model].filter(Boolean).join(' ') || '-'}</p>
              <p className="text-sm font-semibold text-gray-700">{statusLabel[asset.status] || asset.status}</p>
              <p className="text-sm text-gray-600">{activeDriverFor({ asset_id: asset.id })}</p>
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
    </div>
  );
};
