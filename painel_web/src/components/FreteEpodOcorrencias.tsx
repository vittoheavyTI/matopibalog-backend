import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, Clock, AlertTriangle, Upload, MapPin, RefreshCw, Plus } from 'lucide-react';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';

// Painel de ePOD (comprovação de entrega) + ocorrências logísticas de UM frete.
// Autocontido: busca os próprios dados ao montar (só monta quando o frete é
// expandido → lazy) + polling leve (20s) enquanto aberto + refetch pós-ação.
// Validação é POR EVIDÊNCIA (aprovar/rejeitar cada uma); o status geral é
// derivado no backend. Só admin valida/rejeita; o motorista registra/anexa.

type StatusEpod = 'registrado' | 'parcial' | 'validado' | 'rejeitado';
type StatusEvidencia = 'pendente' | 'aprovada' | 'rejeitada';
type Epod = {
  id: string; status: StatusEpod;
  comprovado_em: string; recebido_por: string | null; observacao: string | null;
  latitude: number | null; longitude: number | null; motivo_rejeicao: string | null;
};
type Evidencia = {
  id: string; nome_arquivo: string | null; mime: string | null; created_at: string;
  status: StatusEvidencia; validado_em: string | null; rejeitado_em: string | null; motivo_rejeicao: string | null;
};
type Ocorrencia = {
  id: string; tipo: string; descricao: string; ocorrido_em: string;
  status: 'aberta' | 'em_analise' | 'resolvida'; impacto: string | null;
  resolucao: string | null; resolvida_em: string | null;
};

const TIPOS_OCORRENCIA: { v: string; l: string }[] = [
  { v: 'atraso', l: 'Atraso' }, { v: 'avaria', l: 'Avaria' }, { v: 'recusa', l: 'Recusa' },
  { v: 'reentrega', l: 'Reentrega' }, { v: 'extravio', l: 'Extravio' },
  { v: 'divergencia', l: 'Divergência' }, { v: 'outro', l: 'Outro' },
];
const rotuloTipo = (t: string) => TIPOS_OCORRENCIA.find(x => x.v === t)?.l || 'Outro';

const fmt = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf';

function BadgeEpod({ status }: { status: StatusEpod }) {
  const map = {
    registrado: { cls: 'bg-amber-100 text-amber-700', icon: Clock, txt: 'Aguardando validação' },
    parcial: { cls: 'bg-blue-100 text-blue-700', icon: Clock, txt: 'Parcial' },
    validado: { cls: 'bg-green-100 text-green-700', icon: CheckCircle2, txt: 'Validado' },
    rejeitado: { cls: 'bg-red-100 text-red-700', icon: XCircle, txt: 'Rejeitado' },
  }[status];
  const Icon = map.icon;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${map.cls}`}><Icon size={12} /> {map.txt}</span>;
}

function BadgeEvidencia({ status }: { status: StatusEvidencia }) {
  const map = {
    pendente: { cls: 'bg-amber-100 text-amber-700', txt: 'Pendente' },
    aprovada: { cls: 'bg-green-100 text-green-700', txt: 'Aprovada' },
    rejeitada: { cls: 'bg-red-100 text-red-700', txt: 'Rejeitada' },
  }[status];
  return <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${map.cls}`}>{map.txt}</span>;
}

function BadgeOcorrencia({ status }: { status: Ocorrencia['status'] }) {
  const map = {
    aberta: { cls: 'bg-amber-100 text-amber-700', txt: 'Aberta' },
    em_analise: { cls: 'bg-blue-100 text-blue-700', txt: 'Em análise' },
    resolvida: { cls: 'bg-green-100 text-green-700', txt: 'Resolvida' },
  }[status];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${map.cls}`}>{map.txt}</span>;
}

const SecTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">{children}</p>
);

export const FreteEpodOcorrencias: React.FC<{ freteId: string }> = ({ freteId }) => {
  const { user } = useAuth();
  const ehAdmin = user?.is_super_admin === true || user?.role === 'admin';

  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  const [epod, setEpod] = useState<Epod | null>(null);
  const [evidencias, setEvidencias] = useState<Evidencia[]>([]);
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([]);

  // silent=true (polling/refetch pós-ação) não pisca o "Carregando"; só um discreto
  // indicador "atualizando". A primeira carga usa o spinner cheio.
  const carregar = useCallback(async (silent = false) => {
    if (silent) setAtualizando(true); else setCarregando(true);
    setErro(false);
    try {
      const [epodRes, ocorRes] = await Promise.all([
        api.get(`/fretes/${freteId}/epod`),
        api.get(`/fretes/${freteId}/ocorrencias`),
      ]);
      setEpod(epodRes.data?.epod ?? null);
      setEvidencias(epodRes.data?.evidencias ?? []);
      setOcorrencias(Array.isArray(ocorRes.data) ? ocorRes.data : []);
    } catch {
      if (!silent) setErro(true);
    } finally {
      if (silent) setAtualizando(false); else setCarregando(false);
    }
  }, [freteId]);

  useEffect(() => { carregar(); }, [carregar]);

  // Polling leve (60s) enquanto a seção está aberta, PAUSADO quando a aba não está
  // visível — reflete no painel as ações do app/motorista sem refresh manual, sem
  // pesar no rate limit. Ações do próprio usuário já fazem refetch imediato.
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      carregar(true);
    }, 60000);
    return () => clearInterval(id);
  }, [carregar]);

  const abrirEvidencia = async (url: string) => {
    try {
      const res = await api.get(url);
      if (res.data?.url) window.open(res.data.url, '_blank', 'noopener,noreferrer');
    } catch { /* link indisponível: tentar de novo */ }
  };

  if (carregando) {
    return <div className="border-t border-gray-100 pt-2 mt-1"><p className="text-xs text-gray-400">Carregando comprovação e ocorrências…</p></div>;
  }
  if (erro) {
    return (
      <div className="border-t border-gray-100 pt-2 mt-1 flex items-center justify-between">
        <p className="text-xs text-red-600">Não foi possível carregar a comprovação/ocorrências.</p>
        <button onClick={() => carregar()} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline font-semibold"><RefreshCw size={12} /> Tentar novamente</button>
      </div>
    );
  }

  return (
    <div className="border-t border-gray-100 pt-2 mt-1 space-y-3">
      {atualizando && <p className="text-[10px] text-gray-400 inline-flex items-center gap-1"><RefreshCw size={10} className="animate-spin" /> atualizando…</p>}
      <BlocoEpod
        freteId={freteId} epod={epod} evidencias={evidencias} ehAdmin={ehAdmin}
        onMudou={() => carregar(true)} abrirEvidencia={abrirEvidencia}
      />
      <BlocoOcorrencias
        freteId={freteId} ocorrencias={ocorrencias} ehAdmin={ehAdmin} onMudou={() => carregar(true)}
      />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ePOD
// ─────────────────────────────────────────────────────────────────────────────
const BlocoEpod: React.FC<{
  freteId: string; epod: Epod | null; evidencias: Evidencia[]; ehAdmin: boolean;
  onMudou: () => void; abrirEvidencia: (url: string) => void;
}> = ({ freteId, epod, evidencias, ehAdmin, onMudou, abrirEvidencia }) => {
  const [form, setForm] = useState(false);
  const [recebidoPor, setRecebidoPor] = useState('');
  const [observacao, setObservacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erroAcao, setErroAcao] = useState('');
  const [motivoComprov, setMotivoComprov] = useState('');
  const [rejeitandoComprov, setRejeitandoComprov] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const registrar = async () => {
    setSalvando(true); setErroAcao('');
    try {
      await api.post(`/fretes/${freteId}/epod`, { recebido_por: recebidoPor || undefined, observacao: observacao || undefined });
      setForm(false); setRecebidoPor(''); setObservacao('');
      onMudou();
    } catch (e: any) {
      setErroAcao(e?.response?.data?.message || 'Não foi possível registrar a comprovação.');
    } finally { setSalvando(false); }
  };

  const anexar = async (file: File | null) => {
    if (!file) return;
    setSalvando(true); setErroAcao('');
    try {
      const fd = new FormData(); fd.append('evidencia', file);
      await api.post(`/fretes/${freteId}/epod/evidencias`, fd);
      if (fileRef.current) fileRef.current.value = '';
      onMudou();
    } catch (e: any) {
      setErroAcao(e?.response?.data?.message || 'Não foi possível anexar a evidência.');
    } finally { setSalvando(false); }
  };

  const aprovarPendentes = async () => {
    setSalvando(true); setErroAcao('');
    try { await api.post(`/fretes/${freteId}/epod/aprovar-pendentes`); onMudou(); }
    catch (e: any) { setErroAcao(e?.response?.data?.message || 'Não foi possível aprovar as evidências.'); }
    finally { setSalvando(false); }
  };

  const rejeitarComprovacao = async () => {
    setSalvando(true); setErroAcao('');
    try {
      await api.post(`/fretes/${freteId}/epod/rejeitar`, { motivo_rejeicao: motivoComprov });
      setRejeitandoComprov(false); setMotivoComprov('');
      onMudou();
    } catch (e: any) {
      setErroAcao(e?.response?.data?.message || 'Não foi possível rejeitar a comprovação.');
    } finally { setSalvando(false); }
  };

  const temPendente = evidencias.some(e => e.status === 'pendente');

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <SecTitle>Comprovante de entrega</SecTitle>
        {epod && <BadgeEpod status={epod.status} />}
      </div>

      {!epod ? (
        <div>
          {!form ? (
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-400">Entrega ainda não comprovada.</p>
              <button onClick={() => setForm(true)} className="inline-flex items-center gap-1 text-xs text-green-700 hover:underline font-semibold"><Plus size={12} /> Registrar comprovação</button>
            </div>
          ) : (
            <div className="bg-gray-50 rounded-lg p-2 space-y-2">
              <input value={recebidoPor} onChange={e => setRecebidoPor(e.target.value)} placeholder="Quem recebeu (opcional)" className="w-full text-xs border border-gray-200 rounded px-2 py-1" />
              <textarea value={observacao} onChange={e => setObservacao(e.target.value)} placeholder="Observação (opcional)" rows={2} className="w-full text-xs border border-gray-200 rounded px-2 py-1" />
              <div className="flex items-center gap-2">
                <button disabled={salvando} onClick={registrar} className="text-xs bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white rounded px-3 py-1 font-semibold">{salvando ? 'Salvando…' : 'Salvar comprovação'}</button>
                <button onClick={() => setForm(false)} className="text-xs text-gray-500 hover:underline">Cancelar</button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-gray-50 rounded-lg p-2 space-y-1 text-xs text-gray-700">
          <p><span className="font-semibold">Comprovado em:</span> {fmt(epod.comprovado_em)}</p>
          {epod.recebido_por && <p><span className="font-semibold">Recebido por:</span> {epod.recebido_por}</p>}
          {epod.observacao && <p><span className="font-semibold">Observação:</span> {epod.observacao}</p>}
          {(epod.latitude != null && epod.longitude != null) && (
            <p className="inline-flex items-center gap-1"><MapPin size={12} className="text-gray-400" /> {epod.latitude.toFixed(5)}, {epod.longitude.toFixed(5)}</p>
          )}
          {epod.status === 'rejeitado' && epod.motivo_rejeicao && (
            <p className="text-red-600"><span className="font-semibold">Motivo da rejeição:</span> {epod.motivo_rejeicao}</p>
          )}

          {/* Evidências — status individual + validação por evidência (admin) */}
          <div className="pt-1">
            <p className="text-[11px] font-semibold text-gray-500">Evidências ({evidencias.length})</p>
            {evidencias.length === 0 ? (
              <p className="text-xs text-gray-400">Nenhuma evidência anexada. É necessária pelo menos uma evidência aprovada para validar.</p>
            ) : (
              <ul className="space-y-1 mt-1">
                {evidencias.map(ev => (
                  <EvidenciaItem key={ev.id} freteId={freteId} ev={ev} ehAdmin={ehAdmin} onMudou={onMudou} abrirEvidencia={abrirEvidencia} />
                ))}
              </ul>
            )}
            <label className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline font-semibold cursor-pointer mt-1">
              <Upload size={12} /> Anexar evidência
              <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={e => anexar(e.target.files?.[0] || null)} />
            </label>
          </div>

          {/* Ações gerais do admin: aprovar todas as pendentes + rejeitar comprovação */}
          {ehAdmin && evidencias.length > 0 && (
            <div className="pt-1 border-t border-gray-200 mt-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {temPendente && (
                  <button disabled={salvando} onClick={aprovarPendentes} className="text-xs bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white rounded px-3 py-1 font-semibold">Aprovar pendentes</button>
                )}
                {epod.status !== 'rejeitado' && !rejeitandoComprov && (
                  <button disabled={salvando} onClick={() => setRejeitandoComprov(true)} className="text-xs bg-red-50 hover:bg-red-100 text-red-700 rounded px-3 py-1 font-semibold">Rejeitar comprovação</button>
                )}
              </div>
              {rejeitandoComprov && (
                <div className="space-y-2">
                  <input value={motivoComprov} onChange={e => setMotivoComprov(e.target.value)} placeholder="Motivo da rejeição da comprovação" className="w-full text-xs border border-gray-200 rounded px-2 py-1" />
                  <div className="flex items-center gap-2">
                    <button disabled={salvando || !motivoComprov.trim()} onClick={rejeitarComprovacao} className="text-xs bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded px-3 py-1 font-semibold">Confirmar rejeição</button>
                    <button onClick={() => { setRejeitandoComprov(false); setMotivoComprov(''); }} className="text-xs text-gray-500 hover:underline">Cancelar</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {erroAcao && <p className="text-xs text-red-600 mt-1">{erroAcao}</p>}
    </div>
  );
};

const EvidenciaItem: React.FC<{
  freteId: string; ev: Evidencia; ehAdmin: boolean; onMudou: () => void; abrirEvidencia: (url: string) => void;
}> = ({ freteId, ev, ehAdmin, onMudou, abrirEvidencia }) => {
  const [salvando, setSalvando] = useState(false);
  const [rejeitando, setRejeitando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [erroAcao, setErroAcao] = useState('');

  const validar = async (status: StatusEvidencia, motivoTxt?: string) => {
    setSalvando(true); setErroAcao('');
    try {
      await api.post(`/fretes/${freteId}/epod/evidencias/${ev.id}/validacao`, { status, motivo_rejeicao: motivoTxt || undefined });
      setRejeitando(false); setMotivo('');
      onMudou();
    } catch (e: any) {
      setErroAcao(e?.response?.data?.message || 'Não foi possível validar a evidência.');
    } finally { setSalvando(false); }
  };

  return (
    <li className="bg-white rounded px-2 py-1">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-gray-700 inline-flex items-center gap-1">
          <BadgeEvidencia status={ev.status} /> {ev.nome_arquivo || 'Evidência'}
        </span>
        <button onClick={() => abrirEvidencia(`/fretes/${freteId}/epod/evidencias/${ev.id}/url`)} className="text-blue-600 hover:underline font-semibold whitespace-nowrap">Baixar</button>
      </div>
      {ev.status === 'rejeitada' && ev.motivo_rejeicao && (
        <p className="text-red-600 mt-0.5">Motivo: {ev.motivo_rejeicao}</p>
      )}
      {ehAdmin && (
        <div className="flex items-center gap-3 mt-1">
          {ev.status !== 'aprovada' && (
            <button disabled={salvando} onClick={() => validar('aprovada')} className="text-green-700 hover:underline font-semibold">Aprovar</button>
          )}
          {ev.status !== 'rejeitada' && !rejeitando && (
            <button disabled={salvando} onClick={() => setRejeitando(true)} className="text-red-700 hover:underline font-semibold">Rejeitar</button>
          )}
        </div>
      )}
      {rejeitando && (
        <div className="mt-1 space-y-1">
          <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Motivo da rejeição" className="w-full text-xs border border-gray-200 rounded px-2 py-1" />
          <div className="flex items-center gap-2">
            <button disabled={salvando || !motivo.trim()} onClick={() => validar('rejeitada', motivo)} className="text-xs bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded px-3 py-1 font-semibold">Confirmar</button>
            <button onClick={() => { setRejeitando(false); setMotivo(''); }} className="text-xs text-gray-500 hover:underline">Cancelar</button>
          </div>
        </div>
      )}
      {erroAcao && <p className="text-red-600 mt-1">{erroAcao}</p>}
    </li>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Ocorrências
// ─────────────────────────────────────────────────────────────────────────────
const BlocoOcorrencias: React.FC<{
  freteId: string; ocorrencias: Ocorrencia[]; ehAdmin: boolean; onMudou: () => void;
}> = ({ freteId, ocorrencias, ehAdmin, onMudou }) => {
  const [form, setForm] = useState(false);
  const [tipo, setTipo] = useState('atraso');
  const [descricao, setDescricao] = useState('');
  const [impacto, setImpacto] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erroAcao, setErroAcao] = useState('');
  const [filtro, setFiltro] = useState<'todas' | Ocorrencia['status']>('todas');

  const criar = async () => {
    if (descricao.trim().length < 3) { setErroAcao('Descreva a ocorrência.'); return; }
    setSalvando(true); setErroAcao('');
    try {
      await api.post(`/fretes/${freteId}/ocorrencias`, { tipo, descricao, impacto: impacto || undefined });
      setForm(false); setDescricao(''); setImpacto(''); setTipo('atraso');
      onMudou();
    } catch (e: any) {
      setErroAcao(e?.response?.data?.message || 'Não foi possível registrar a ocorrência.');
    } finally { setSalvando(false); }
  };

  const lista = filtro === 'todas' ? ocorrencias : ocorrencias.filter(o => o.status === filtro);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <SecTitle>Ocorrências {ocorrencias.length > 0 && <span className="text-gray-400 normal-case font-normal">({ocorrencias.length})</span>}</SecTitle>
        <button onClick={() => setForm(v => !v)} className="inline-flex items-center gap-1 text-xs text-green-700 hover:underline font-semibold"><Plus size={12} /> Registrar ocorrência</button>
      </div>

      {form && (
        <div className="bg-gray-50 rounded-lg p-2 space-y-2 mb-2">
          <select value={tipo} onChange={e => setTipo(e.target.value)} className="w-full text-xs border border-gray-200 rounded px-2 py-1 bg-white">
            {TIPOS_OCORRENCIA.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
          <textarea value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Descrição da ocorrência" rows={2} className="w-full text-xs border border-gray-200 rounded px-2 py-1" />
          <input value={impacto} onChange={e => setImpacto(e.target.value)} placeholder="Impacto na entrega (opcional)" className="w-full text-xs border border-gray-200 rounded px-2 py-1" />
          <div className="flex items-center gap-2">
            <button disabled={salvando} onClick={criar} className="text-xs bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white rounded px-3 py-1 font-semibold">{salvando ? 'Salvando…' : 'Salvar ocorrência'}</button>
            <button onClick={() => setForm(false)} className="text-xs text-gray-500 hover:underline">Cancelar</button>
          </div>
        </div>
      )}

      {ocorrencias.length === 0 ? (
        <p className="text-xs text-gray-400">Nenhuma ocorrência registrada.</p>
      ) : (
        <>
          <div className="flex items-center gap-1 mb-1">
            {(['todas', 'aberta', 'em_analise', 'resolvida'] as const).map(f => (
              <button key={f} onClick={() => setFiltro(f)} className={`text-[11px] rounded-full px-2 py-0.5 font-semibold ${filtro === f ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {f === 'todas' ? 'Todas' : f === 'aberta' ? 'Abertas' : f === 'em_analise' ? 'Em análise' : 'Resolvidas'}
              </button>
            ))}
          </div>
          <ul className="space-y-1">
            {lista.map(o => (
              <OcorrenciaItem key={o.id} freteId={freteId} ocorrencia={o} ehAdmin={ehAdmin} onMudou={onMudou} />
            ))}
            {lista.length === 0 && <li className="text-xs text-gray-400">Nenhuma ocorrência neste filtro.</li>}
          </ul>
        </>
      )}
      {erroAcao && <p className="text-xs text-red-600 mt-1">{erroAcao}</p>}
    </div>
  );
};

const OcorrenciaItem: React.FC<{
  freteId: string; ocorrencia: Ocorrencia; ehAdmin: boolean; onMudou: () => void;
}> = ({ freteId, ocorrencia: o, ehAdmin, onMudou }) => {
  const [resolvendo, setResolvendo] = useState(false);
  const [resolucao, setResolucao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erroAcao, setErroAcao] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const mudarStatus = async (status: Ocorrencia['status'], resolucaoTxt?: string) => {
    setSalvando(true); setErroAcao('');
    try {
      await api.patch(`/fretes/${freteId}/ocorrencias/${o.id}`, { status, resolucao: resolucaoTxt || undefined });
      setResolvendo(false); setResolucao('');
      onMudou();
    } catch (e: any) {
      setErroAcao(e?.response?.data?.message || 'Não foi possível atualizar a ocorrência.');
    } finally { setSalvando(false); }
  };

  const anexar = async (file: File | null) => {
    if (!file) return;
    setSalvando(true); setErroAcao('');
    try {
      const fd = new FormData(); fd.append('evidencia', file);
      await api.post(`/fretes/${freteId}/ocorrencias/${o.id}/evidencias`, fd);
      if (fileRef.current) fileRef.current.value = '';
      onMudou();
    } catch (e: any) {
      setErroAcao(e?.response?.data?.message || 'Não foi possível anexar a evidência.');
    } finally { setSalvando(false); }
  };

  return (
    <li className="bg-gray-50 rounded-lg px-2 py-1.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-gray-700 inline-flex items-center gap-1"><AlertTriangle size={12} className="text-amber-500" /> {rotuloTipo(o.tipo)}</span>
        <BadgeOcorrencia status={o.status} />
      </div>
      <p className="text-gray-700 mt-0.5">{o.descricao}</p>
      <p className="text-gray-400 mt-0.5">{fmt(o.ocorrido_em)}{o.impacto ? ` · Impacto: ${o.impacto}` : ''}</p>
      {o.status === 'resolvida' && o.resolucao && <p className="text-green-700 mt-0.5"><span className="font-semibold">Resolução:</span> {o.resolucao}</p>}

      <div className="flex items-center gap-3 mt-1">
        <label className="inline-flex items-center gap-1 text-blue-600 hover:underline font-semibold cursor-pointer">
          <Upload size={12} /> Anexar
          <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={e => anexar(e.target.files?.[0] || null)} />
        </label>
        {ehAdmin && o.status === 'aberta' && (
          <button disabled={salvando} onClick={() => mudarStatus('em_analise')} className="text-blue-700 hover:underline font-semibold">Marcar em análise</button>
        )}
        {ehAdmin && o.status !== 'resolvida' && (
          <button disabled={salvando} onClick={() => setResolvendo(v => !v)} className="text-green-700 hover:underline font-semibold">Resolver</button>
        )}
      </div>

      {resolvendo && (
        <div className="mt-1 space-y-1">
          <input value={resolucao} onChange={e => setResolucao(e.target.value)} placeholder="Como foi resolvida?" className="w-full text-xs border border-gray-200 rounded px-2 py-1" />
          <div className="flex items-center gap-2">
            <button disabled={salvando || !resolucao.trim()} onClick={() => mudarStatus('resolvida', resolucao)} className="text-xs bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white rounded px-3 py-1 font-semibold">Confirmar</button>
            <button onClick={() => { setResolvendo(false); setResolucao(''); }} className="text-xs text-gray-500 hover:underline">Cancelar</button>
          </div>
        </div>
      )}
      {erroAcao && <p className="text-red-600 mt-1">{erroAcao}</p>}
    </li>
  );
};

export default FreteEpodOcorrencias;
