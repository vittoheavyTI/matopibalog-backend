import React, { useState } from 'react';
import { Route as RouteIcon, Fuel, MapPin, Info, AlertTriangle } from 'lucide-react';
import api from '../api';

// Route Intelligence V1 — estimativa read-only. Sempre mostra a FONTE (Manual /
// Provedor / Indisponível) e nunca apresenta dado desconhecido como zero.

type Estimate = {
  ok?: boolean;
  origin?: string; destination?: string;
  route_source?: 'MANUAL' | 'PROVIDER' | 'UNAVAILABLE';
  provider?: string | null;
  availability?: string;
  distance_km?: number | null;
  duration_minutes?: number | null;
  tolls_amount?: number | null;
  truck_restrictions_status?: string;
  manual_fallback_supported?: boolean;
  fuel?: { status: string; liters: number | null; cost: number | null };
  cost?: { fuel_cost: number | null; tolls_cost: number | null; estimated_route_cost: number | null; partial: boolean };
  warnings?: string[];
};

const brl = (v: number | null | undefined) => (v == null ? 'Indisponível' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const fmtKm = (v: number | null | undefined) => (v == null ? 'Indisponível' : `${v.toLocaleString('pt-BR')} km`);
const fmtMin = (v: number | null | undefined) => (v == null ? 'Indisponível' : `${Math.floor(v / 60)}h ${v % 60}min`);
const fonteLabel: Record<string, string> = { MANUAL: 'Manual', PROVIDER: 'Provedor', UNAVAILABLE: 'Indisponível' };

export const RotaInteligente: React.FC = () => {
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [manualDistance, setManualDistance] = useState('');
  const [consumo, setConsumo] = useState('');
  const [preco, setPreco] = useState('');
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [est, setEst] = useState<Estimate | null>(null);

  async function estimar() {
    if (!origin.trim() || !destination.trim()) { setErro('Informe origem e destino.'); return; }
    setLoading(true); setErro(null); setEst(null);
    const payload: Record<string, unknown> = { origin: origin.trim(), destination: destination.trim() };
    const md = Number(manualDistance);
    if (Number.isFinite(md) && md > 0) payload.manual = { distance_km: md };
    const params: Record<string, number> = {};
    if (Number(consumo) > 0) params.consumption_km_per_liter = Number(consumo);
    if (Number(preco) > 0) params.fuel_price_per_liter = Number(preco);
    if (Object.keys(params).length) payload.params = params;
    try {
      const { data } = await api.post('/route-intelligence/estimate', payload);
      setEst(data);
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setErro(err?.response?.data?.message || 'Não foi possível estimar a rota agora.');
    } finally { setLoading(false); }
  }

  return (
    <div className="mx-auto max-w-3xl p-4">
      <div className="mb-1 flex items-center gap-2">
        <RouteIcon className="text-green-700" size={21} aria-hidden="true" />
        <h1 className="text-xl font-bold text-gray-800">Rota inteligente</h1>
      </div>
      <p className="mb-4 inline-flex items-start gap-1 text-xs text-gray-500">
        <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>Estime distância, tempo, pedágio e combustível. Valores desconhecidos aparecem como “Indisponível”, nunca zero.</span>
      </p>

      <div className="grid gap-3 rounded-2xl border border-gray-100 bg-white p-5 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-gray-600">Origem</span>
          <input aria-label="Origem" value={origin} onChange={(e) => setOrigin(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="Cidade/UF de origem" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-gray-600">Destino</span>
          <input aria-label="Destino" value={destination} onChange={(e) => setDestination(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="Cidade/UF de destino" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-gray-600">Distância manual (km) <span className="font-normal text-gray-400">opcional</span></span>
          <input aria-label="Distância manual" inputMode="decimal" value={manualDistance} onChange={(e) => setManualDistance(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="Se souber a distância" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-600">Consumo (km/L)</span>
            <input aria-label="Consumo" inputMode="decimal" value={consumo} onChange={(e) => setConsumo(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="ex: 2,5" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-600">Diesel (R$/L)</span>
            <input aria-label="Preço do diesel" inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="ex: 6,00" />
          </label>
        </div>
        <div className="sm:col-span-2">
          <button type="button" onClick={estimar} disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-green-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-60">
            <MapPin size={16} /> {loading ? 'Calculando…' : 'Estimar rota'}
          </button>
        </div>
      </div>

      {erro && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{erro}</div>}

      {est?.ok && (
        <div className="mt-4 space-y-3 rounded-2xl border border-gray-100 bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-gray-800">{est.origin} → {est.destination}</p>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${est.route_source === 'UNAVAILABLE' ? 'bg-gray-100 text-gray-500' : 'bg-green-50 text-green-700'}`}>
              Fonte: {fonteLabel[est.route_source || ''] || est.route_source}{est.provider ? ` (${est.provider})` : ''}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
            <div><p className="text-gray-400">Distância</p><p className="font-semibold">{fmtKm(est.distance_km)}</p></div>
            <div><p className="text-gray-400">Duração</p><p className="font-semibold">{fmtMin(est.duration_minutes)}</p></div>
            <div><p className="text-gray-400">Pedágio</p><p className="font-semibold">{brl(est.tolls_amount)}</p></div>
            <div><p className="text-gray-400">Restrição caminhão</p><p className="font-semibold">{est.truck_restrictions_status === 'UNAVAILABLE' ? 'Não confirmada' : est.truck_restrictions_status}</p></div>
          </div>
          <div className="flex items-center gap-2 border-t border-gray-100 pt-3 text-sm">
            <Fuel size={16} className="text-gray-500" />
            {est.fuel?.status === 'KNOWN'
              ? <span>Combustível estimado: <b>{est.fuel.liters} L</b> · <b>{brl(est.fuel.cost)}</b></span>
              : <span className="text-gray-500">Combustível: informe consumo (km/L) e preço do diesel para estimar.</span>}
          </div>
          <div className="rounded-xl bg-gray-50 p-3 text-sm">
            Custo estimado{est.cost?.partial ? ' (parcial)' : ''}: <b>{brl(est.cost?.estimated_route_cost)}</b>
            {est.cost?.partial && <span className="ml-1 text-xs text-gray-500">— alguns valores são desconhecidos.</span>}
          </div>
          {est.availability === 'UNAVAILABLE' && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
              O provedor de rotas não está habilitado. Informe a distância manualmente para calcular custo/combustível.
            </div>
          )}
          {est.warnings && est.warnings.length > 0 && (
            <ul className="space-y-1 text-xs text-amber-700">
              {est.warnings.map((w, i) => <li key={i} className="flex items-start gap-1"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{w}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
