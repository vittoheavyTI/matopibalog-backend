import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2, XCircle, Clock, AlertTriangle, Upload, MapPin, RefreshCw, Plus,
  ChevronDown, ChevronRight, Eye, ShieldAlert,
} from 'lucide-react';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';
import { ArquivoPreviewModal, type ArquivoPreview } from './ArquivoPreviewModal';

// Painel de ePOD (comprovação de entrega) + ocorrências logísticas de UM frete.
// Autocontido: busca os próprios dados ao montar (só monta quando o frete é
// expandido → lazy) + polling leve (60s) pausado em aba oculta + refetch pós-ação.
// Validação é POR EVIDÊNCIA (aprovar/rejeitar cada uma); o status geral é
// DERIVADO no backend (regra B) — o painel apenas CONSOME `epod.status`, nunca
// recalcula. Só admin valida/rejeita; o motorista registra/anexa.
//
// Organização visual (polimento):
//   • resumo compacto no topo (status + contagens + última atualização);
//   • evidências em 2 grupos: "Pendentes — ação necessária" e "Histórico";
//   • ações individuais junto do item; ações gerais em região separada;
//   • ocorrências separadas do ePOD, com empty-state claro.

type StatusEpod = 'registrado' | 'parcial' | 'validado' | 'rejeitado';
type StatusEvidencia = 'pendente' | 'aprovada' | 'rejeitada';
type Epod = {
  id: string; status: StatusEpod;
  comprovado_em: string; recebido_por: string | null; observacao: string | null;
  latitude: number | null; longitude: number | null; motivo_rejeicao: string | null;
  updated_at?: string | null; // já retornado pelo backend (COLUNAS_EPOD) — só passamos a exibir
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

// Espelha backend MAX_EVIDENCIAS (freteEpodController). O backend é a AUTORIDADE
// (retorna 409 ao exceder); aqui só usamos para um aviso/desabilitar preventivo.
const MAX_EVIDENCIAS_UI = 10;

const TIPOS_OCORRENCIA: { v: string; l: string }[] = [
  { v: 'atraso', l: 'Atraso' }, { v: 'avaria', l: 'Avaria' }, { v: 'recusa', l: 'Recusa' },
  { v: 'reentrega', l: 'Reentrega' }, { v: 'extravio', l: 'Extravio' },
  { v: 'divergencia', l: 'Divergência' }, { v: 'outro', l: 'Outro' },
];
const rotuloTipo = (t: string) => TIPOS_OCORRENCIA.find(x => x.v === t)?.l || 'Outro';

const fmt = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf';
// Foco visível para navegação por teclado (a11y) — aplicado nos controles de ação.
const FOCO = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-gray-400';

// Extrai a mensagem de erro de uma ação de forma tipada (sem `any`) e trata 429
// com orientação amigável — o 429 NÃO desloga (ver AuthContext/#376).
type ApiErro = { response?: { status?: number; data?: { message?: string } } };
const msgErro = (e: unknown, fallback: string): string => {
  const err = e as ApiErro;
  if (err?.response?.status === 429) return 'Muitas solicitações agora. Aguarde alguns segundos e tente novamente.';
  return err?.response?.data?.message || fallback;
};

function BadgeEpod({ status }: { status: StatusEpod }) {
  const map = {
    registrado: { cls: 'bg-amber-100 text-amber-700', icon: Clock, txt: 'Aguardando validação' },
    parcial: { cls: 'bg-blue-100 text-blue-700', icon: Clock, txt: 'Parcial' },
    validado: { cls: 'bg-green-100 text-green-700', icon: CheckCircle2, txt: 'Validado' },
    rejeitado: { cls: 'bg-red-100 text-red-700', icon: XCircle, txt: 'Rejeitado' },
  }[status];
  const Icon = map.icon;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${map.cls}`}><Icon size={12} aria-hidden="true" /> {map.txt}</span>;
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
  <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">{children}</p>
);

// Chip de contagem do resumo. Comunica por número + rótulo (não só cor) — a11y.
const Contagem: React.FC<{ n: number; label: string; cls: string; mudo?: boolean }> = ({ n, label, cls, mudo }) => (
  <span
    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${mudo ? 'bg-gray-100 text-gray-500' : cls}`}
    aria-label={`${n} ${label}`}
  >
    <span className="tabular-nums">{n}</span> <span className="font-medium">{label}</span>
  </span>
);

const ErroAcao: React.FC<{ msg: string }> = ({ msg }) =>
  msg ? <p role="alert" className="text-xs text-red-600 mt-1">{msg}</p> : null;

export const FreteEpodOcorrencias: React.FC<{ freteId: string }> = ({ freteId }) => {
  const { user } = useAuth();
  const ehAdmin = user?.is_super_admin === true || user?.role === 'admin';

  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  const [epod, setEpod] = useState<Epod | null>(null);
  const [evidencias, setEvidencias] = useState<Evidencia[]>([]);
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([]);
  const [arquivoPreview, setArquivoPreview] = useState<ArquivoPreview | null>(null);

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

  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial ao montar (fetch-on-mount)
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
      if (res.data?.url) {
        setArquivoPreview({
          url: res.data.url,
          nome: res.data?.nome_arquivo || 'Evidencia',
          mime: res.data?.mime || null,
        });
      }
    } catch { /* link indisponível: tentar de novo */ }
  };

  if (carregando) {
    return <div className="border-t border-gray-100 pt-2 mt-1"><p className="text-xs text-gray-400">Carregando comprovação e ocorrências…</p></div>;
  }
  if (erro) {
    return (
      <div className="border-t border-gray-100 pt-2 mt-1 flex items-center justify-between gap-2 flex-wrap">
        <p role="alert" className="text-xs text-red-600">Não foi possível carregar a comprovação/ocorrências.</p>
        <button onClick={() => carregar()} className={`inline-flex items-center gap-1 text-xs text-blue-600 hover:underline font-semibold ${FOCO}`}><RefreshCw size={12} aria-hidden="true" /> Tentar novamente</button>
      </div>
    );
  }

  return (
    <div className="border-t border-gray-100 pt-2 mt-1 space-y-4">
      {atualizando && <p className="text-[10px] text-gray-400 inline-flex items-center gap-1" aria-live="polite"><RefreshCw size={10} className="animate-spin" aria-hidden="true" /> atualizando…</p>}
      <BlocoEpod
        freteId={freteId} epod={epod} evidencias={evidencias} ehAdmin={ehAdmin}
        onMudou={() => carregar(true)} abrirEvidencia={abrirEvidencia}
      />
      <BlocoOcorrencias
        freteId={freteId} ocorrencias={ocorrencias} ehAdmin={ehAdmin} onMudou={() => carregar(true)}
      />
      <ArquivoPreviewModal arquivo={arquivoPreview} onClose={() => setArquivoPreview(null)} />
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
  const [confirmandoAprovar, setConfirmandoAprovar] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pendentes = evidencias.filter(e => e.status === 'pendente');
  const historico = evidencias.filter(e => e.status !== 'pendente'); // aprovadas + rejeitadas, ordem cronológica preservada
  const nAprov = evidencias.filter(e => e.status === 'aprovada').length;
  const nRej = evidencias.filter(e => e.status === 'rejeitada').length;
  const noLimite = evidencias.length >= MAX_EVIDENCIAS_UI;
  // Histórico começa aberto quando não há pendentes (nada mais a priorizar).
  const [histAberto, setHistAberto] = useState(pendentes.length === 0);

  const registrar = async () => {
    setSalvando(true); setErroAcao('');
    try {
      await api.post(`/fretes/${freteId}/epod`, { recebido_por: recebidoPor || undefined, observacao: observacao || undefined });
      setForm(false); setRecebidoPor(''); setObservacao('');
      onMudou();
    } catch (e) {
      setErroAcao(msgErro(e, 'Não foi possível registrar a comprovação.'));
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
    } catch (e) {
      setErroAcao(msgErro(e, 'Não foi possível anexar a evidência.'));
    } finally { setSalvando(false); }
  };

  const aprovarPendentes = async () => {
    setSalvando(true); setErroAcao('');
    try { await api.post(`/fretes/${freteId}/epod/aprovar-pendentes`); setConfirmandoAprovar(false); onMudou(); }
    catch (e) { setErroAcao(msgErro(e, 'Não foi possível aprovar as evidências.')); }
    finally { setSalvando(false); }
  };

  const rejeitarComprovacao = async () => {
    setSalvando(true); setErroAcao('');
    try {
      await api.post(`/fretes/${freteId}/epod/rejeitar`, { motivo_rejeicao: motivoComprov });
      setRejeitandoComprov(false); setMotivoComprov('');
      onMudou();
    } catch (e) {
      setErroAcao(msgErro(e, 'Não foi possível rejeitar a comprovação.'));
    } finally { setSalvando(false); }
  };

  return (
    <section aria-label="Comprovante de entrega">
      <div className="flex items-center justify-between gap-2 mb-1">
        <SecTitle>Comprovante de entrega</SecTitle>
        {epod && <BadgeEpod status={epod.status} />}
      </div>

      {!epod ? (
        <div>
          {!form ? (
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs text-gray-400">Entrega ainda não comprovada.</p>
              <button onClick={() => setForm(true)} className={`inline-flex items-center gap-1 text-xs text-green-700 hover:underline font-semibold ${FOCO}`}><Plus size={12} aria-hidden="true" /> Registrar comprovação</button>
            </div>
          ) : (
            <div className="bg-gray-50 rounded-lg p-2 space-y-2">
              <input value={recebidoPor} onChange={e => setRecebidoPor(e.target.value)} placeholder="Quem recebeu (opcional)" aria-label="Quem recebeu" className="w-full text-xs border border-gray-200 rounded px-2 py-1.5" />
              <textarea value={observacao} onChange={e => setObservacao(e.target.value)} placeholder="Observação (opcional)" aria-label="Observação" rows={2} className="w-full text-xs border border-gray-200 rounded px-2 py-1.5" />
              <div className="flex items-center gap-2 flex-wrap">
                <button disabled={salvando} onClick={registrar} className={`text-xs bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white rounded px-3 py-1.5 font-semibold ${FOCO}`}>{salvando ? 'Salvando…' : 'Salvar comprovação'}</button>
                <button onClick={() => setForm(false)} className={`text-xs text-gray-500 hover:underline ${FOCO}`}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {/* Resumo compacto: metadados + contagens + última atualização */}
          <div className="bg-gray-50 rounded-lg p-2 space-y-1 text-xs text-gray-700">
            <p><span className="font-semibold">Comprovado em:</span> {fmt(epod.comprovado_em)}</p>
            {epod.recebido_por && <p><span className="font-semibold">Recebido por:</span> {epod.recebido_por}</p>}
            {epod.observacao && <p><span className="font-semibold">Observação:</span> {epod.observacao}</p>}
            {(epod.latitude != null && epod.longitude != null) && (
              <p className="inline-flex items-center gap-1"><MapPin size={12} className="text-gray-400" aria-hidden="true" /> {epod.latitude.toFixed(5)}, {epod.longitude.toFixed(5)}</p>
            )}
            {epod.status === 'rejeitado' && epod.motivo_rejeicao && (
              <p className="text-red-600"><span className="font-semibold">Motivo da rejeição:</span> {epod.motivo_rejeicao}</p>
            )}
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              <Contagem n={evidencias.length} label={evidencias.length === 1 ? 'evidência' : 'evidências'} cls="bg-gray-200 text-gray-700" />
              <Contagem n={pendentes.length} label="pendentes" cls="bg-amber-100 text-amber-700" mudo={pendentes.length === 0} />
              <Contagem n={nAprov} label="aprovadas" cls="bg-green-100 text-green-700" mudo={nAprov === 0} />
              <Contagem n={nRej} label="rejeitadas" cls="bg-red-100 text-red-700" mudo={nRej === 0} />
              {epod.updated_at && <span className="text-[10px] text-gray-400 ml-auto">Atualizado em {fmt(epod.updated_at)}</span>}
            </div>
          </div>

          {evidencias.length === 0 && (
            <p className="text-xs text-gray-400">Nenhuma evidência anexada. É necessária pelo menos uma evidência aprovada para validar.</p>
          )}

          {/* Grupo 1 — Pendentes (ação necessária): sempre visível e no topo */}
          {pendentes.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-amber-700 mb-1 inline-flex items-center gap-1">
                <Clock size={12} aria-hidden="true" /> Pendentes — ação necessária ({pendentes.length})
              </p>
              <ul className="space-y-1">
                {pendentes.map(ev => (
                  <EvidenciaItem key={ev.id} freteId={freteId} ev={ev} ehAdmin={ehAdmin} onMudou={onMudou} abrirEvidencia={abrirEvidencia} />
                ))}
              </ul>
            </div>
          )}

          {/* Grupo 2 — Histórico (aprovadas + rejeitadas), recolhível mas acessível */}
          {historico.length > 0 && (
            <div>
              <button
                onClick={() => setHistAberto(v => !v)}
                aria-expanded={histAberto}
                className={`w-full flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-gray-700 ${FOCO}`}
              >
                {histAberto ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
                Histórico ({nAprov} aprovadas · {nRej} rejeitadas)
              </button>
              {histAberto && (
                <ul className="space-y-1 mt-1">
                  {historico.map(ev => (
                    <EvidenciaItem key={ev.id} freteId={freteId} ev={ev} ehAdmin={ehAdmin} onMudou={onMudou} abrirEvidencia={abrirEvidencia} />
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Anexar evidência (backend é a autoridade do limite; aqui só um aviso) */}
          <div>
            {noLimite ? (
              <p className="text-[11px] text-gray-400">Limite de {MAX_EVIDENCIAS_UI} evidências atingido.</p>
            ) : (
              <label className={`inline-flex items-center gap-1 text-xs text-blue-600 hover:underline font-semibold cursor-pointer ${salvando ? 'opacity-60 pointer-events-none' : ''}`}>
                <Upload size={12} aria-hidden="true" /> Anexar evidência
                <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" disabled={salvando} aria-label="Anexar evidência" onChange={e => anexar(e.target.files?.[0] || null)} />
              </label>
            )}
          </div>

          {/* Ações gerais do admin — região separada das ações por evidência */}
          {ehAdmin && evidencias.length > 0 && (
            <div className="pt-2 border-t border-gray-200">
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Ações da comprovação</p>

              {/* Aprovar todas as pendentes: só com 2+ pendentes, com confirmação e contagem */}
              {pendentes.length >= 2 && !confirmandoAprovar && (
                <button disabled={salvando} onClick={() => setConfirmandoAprovar(true)} className={`text-xs bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white rounded px-3 py-1.5 font-semibold ${FOCO}`}>
                  Aprovar todas as {pendentes.length} pendentes
                </button>
              )}
              {confirmandoAprovar && (
                <div className="bg-green-50 border border-green-200 rounded p-2 space-y-2">
                  <p className="text-xs text-green-800">Aprovar de uma vez as <span className="font-semibold">{pendentes.length}</span> evidências pendentes?</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button disabled={salvando} onClick={aprovarPendentes} className={`text-xs bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white rounded px-3 py-1.5 font-semibold ${FOCO}`}>{salvando ? 'Aprovando…' : `Confirmar (${pendentes.length})`}</button>
                    <button onClick={() => setConfirmandoAprovar(false)} className={`text-xs text-gray-500 hover:underline ${FOCO}`}>Cancelar</button>
                  </div>
                </div>
              )}

              {/* Rejeitar comprovação: ação EXCEPCIONAL/destrutiva, com explicação do efeito */}
              {epod.status !== 'rejeitado' && (
                <div className="mt-2">
                  {!rejeitandoComprov ? (
                    <button disabled={salvando} onClick={() => setRejeitandoComprov(true)} className={`inline-flex items-center gap-1 text-xs text-red-700 hover:bg-red-50 border border-red-200 rounded px-3 py-1.5 font-semibold ${FOCO}`}>
                      <ShieldAlert size={13} aria-hidden="true" /> Rejeitar comprovação inteira
                    </button>
                  ) : (
                    <div className="bg-red-50 border border-red-200 rounded p-2 space-y-2">
                      <p className="text-xs text-red-800 inline-flex items-start gap-1">
                        <ShieldAlert size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                        <span>Ação excepcional: <span className="font-semibold">marca TODAS as evidências como rejeitadas</span> e reprova a entrega. Informe o motivo.</span>
                      </p>
                      <input value={motivoComprov} onChange={e => setMotivoComprov(e.target.value)} placeholder="Motivo da rejeição da comprovação" aria-label="Motivo da rejeição da comprovação" className="w-full text-xs border border-red-200 rounded px-2 py-1.5" />
                      <div className="flex items-center gap-2 flex-wrap">
                        <button disabled={salvando || !motivoComprov.trim()} onClick={rejeitarComprovacao} className={`text-xs bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded px-3 py-1.5 font-semibold ${FOCO}`}>{salvando ? 'Rejeitando…' : 'Rejeitar comprovação'}</button>
                        <button onClick={() => { setRejeitandoComprov(false); setMotivoComprov(''); }} className={`text-xs text-gray-500 hover:underline ${FOCO}`}>Cancelar</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <ErroAcao msg={erroAcao} />
    </section>
  );
};

const EvidenciaItem: React.FC<{
  freteId: string; ev: Evidencia; ehAdmin: boolean; onMudou: () => void; abrirEvidencia: (url: string) => void;
}> = ({ freteId, ev, ehAdmin, onMudou, abrirEvidencia }) => {
  const [salvando, setSalvando] = useState(false);
  const [rejeitando, setRejeitando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [erroAcao, setErroAcao] = useState('');
  const nome = ev.nome_arquivo || 'Evidência';
  // Data de auditoria por status: aprovada→validado_em, rejeitada→rejeitado_em, senão created_at.
  const quando = ev.status === 'aprovada' ? ev.validado_em : ev.status === 'rejeitada' ? ev.rejeitado_em : ev.created_at;

  const validar = async (status: StatusEvidencia, motivoTxt?: string) => {
    setSalvando(true); setErroAcao('');
    try {
      await api.post(`/fretes/${freteId}/epod/evidencias/${ev.id}/validacao`, { status, motivo_rejeicao: motivoTxt || undefined });
      setRejeitando(false); setMotivo('');
      onMudou();
    } catch (e) {
      setErroAcao(msgErro(e, 'Não foi possível validar a evidência.'));
    } finally { setSalvando(false); }
  };

  return (
    <li className="bg-white border border-gray-100 rounded px-2 py-1.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 inline-flex items-center gap-1.5">
          <BadgeEvidencia status={ev.status} />
          <span className="truncate text-gray-700" title={nome}>{nome}</span>
        </span>
        <button
          onClick={() => abrirEvidencia(`/fretes/${freteId}/epod/evidencias/${ev.id}/url`)}
          aria-label={`Ver evidência ${nome}`}
          className={`inline-flex items-center gap-1 text-blue-600 hover:underline font-semibold whitespace-nowrap ${FOCO}`}
        >
          <Eye size={12} aria-hidden="true" /> Ver
        </button>
      </div>
      <p className="text-gray-400 mt-0.5">{fmt(quando)}</p>
      {ev.status === 'rejeitada' && ev.motivo_rejeicao && (
        <p className="text-red-600 mt-0.5"><span className="font-semibold">Motivo:</span> {ev.motivo_rejeicao}</p>
      )}
      {ehAdmin && (
        <div className="flex items-center gap-3 mt-1">
          {ev.status !== 'aprovada' && (
            <button disabled={salvando} onClick={() => validar('aprovada')} className={`text-green-700 hover:underline font-semibold ${FOCO}`}>Aprovar</button>
          )}
          {ev.status !== 'rejeitada' && !rejeitando && (
            <button disabled={salvando} onClick={() => setRejeitando(true)} className={`text-red-700 hover:underline font-semibold ${FOCO}`}>Rejeitar</button>
          )}
        </div>
      )}
      {rejeitando && (
        <div className="mt-1 space-y-1">
          <p className="text-red-800">Rejeitar <span className="font-semibold">{nome}</span>? Informe o motivo:</p>
          <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Motivo da rejeição" aria-label={`Motivo da rejeição de ${nome}`} className="w-full text-xs border border-gray-200 rounded px-2 py-1.5" />
          <div className="flex items-center gap-2 flex-wrap">
            <button disabled={salvando || !motivo.trim()} onClick={() => validar('rejeitada', motivo)} className={`text-xs bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded px-3 py-1.5 font-semibold ${FOCO}`}>{salvando ? 'Rejeitando…' : 'Confirmar rejeição'}</button>
            <button onClick={() => { setRejeitando(false); setMotivo(''); }} className={`text-xs text-gray-500 hover:underline ${FOCO}`}>Cancelar</button>
          </div>
        </div>
      )}
      <ErroAcao msg={erroAcao} />
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
    } catch (e) {
      setErroAcao(msgErro(e, 'Não foi possível registrar a ocorrência.'));
    } finally { setSalvando(false); }
  };

  const lista = filtro === 'todas' ? ocorrencias : ocorrencias.filter(o => o.status === filtro);

  return (
    <section aria-label="Ocorrências" className="border-t border-gray-100 pt-2">
      <div className="flex items-center justify-between gap-2 mb-1">
        <SecTitle>Ocorrências {ocorrencias.length > 0 && <span className="text-gray-400 normal-case font-normal">({ocorrencias.length})</span>}</SecTitle>
        <button onClick={() => setForm(v => !v)} aria-expanded={form} className={`inline-flex items-center gap-1 text-xs text-green-700 hover:underline font-semibold ${FOCO}`}><Plus size={12} aria-hidden="true" /> Registrar ocorrência</button>
      </div>

      {form && (
        <div className="bg-gray-50 rounded-lg p-2 space-y-2 mb-2">
          <select value={tipo} onChange={e => setTipo(e.target.value)} aria-label="Tipo da ocorrência" className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 bg-white">
            {TIPOS_OCORRENCIA.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
          <textarea value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Descrição da ocorrência" aria-label="Descrição da ocorrência" rows={2} className="w-full text-xs border border-gray-200 rounded px-2 py-1.5" />
          <input value={impacto} onChange={e => setImpacto(e.target.value)} placeholder="Impacto na entrega (opcional)" aria-label="Impacto na entrega" className="w-full text-xs border border-gray-200 rounded px-2 py-1.5" />
          <div className="flex items-center gap-2 flex-wrap">
            <button disabled={salvando} onClick={criar} className={`text-xs bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white rounded px-3 py-1.5 font-semibold ${FOCO}`}>{salvando ? 'Salvando…' : 'Salvar ocorrência'}</button>
            <button onClick={() => setForm(false)} className={`text-xs text-gray-500 hover:underline ${FOCO}`}>Cancelar</button>
          </div>
        </div>
      )}

      {ocorrencias.length === 0 ? (
        <p className="text-xs text-gray-400">Nenhuma ocorrência registrada.</p>
      ) : (
        <>
          <div className="flex items-center gap-1 mb-1 flex-wrap">
            {(['todas', 'aberta', 'em_analise', 'resolvida'] as const).map(f => (
              <button key={f} onClick={() => setFiltro(f)} aria-pressed={filtro === f} className={`text-[11px] rounded-full px-2 py-0.5 font-semibold ${FOCO} ${filtro === f ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
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
      <ErroAcao msg={erroAcao} />
    </section>
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
    } catch (e) {
      setErroAcao(msgErro(e, 'Não foi possível atualizar a ocorrência.'));
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
    } catch (e) {
      setErroAcao(msgErro(e, 'Não foi possível anexar a evidência.'));
    } finally { setSalvando(false); }
  };

  return (
    <li className="bg-gray-50 rounded-lg px-2 py-1.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-gray-700 inline-flex items-center gap-1"><AlertTriangle size={12} className="text-amber-500" aria-hidden="true" /> {rotuloTipo(o.tipo)}</span>
        <BadgeOcorrencia status={o.status} />
      </div>
      <p className="text-gray-700 mt-0.5 break-words">{o.descricao}</p>
      <p className="text-gray-400 mt-0.5">{fmt(o.ocorrido_em)}{o.impacto ? ` · Impacto: ${o.impacto}` : ''}</p>
      {o.status === 'resolvida' && o.resolucao && <p className="text-green-700 mt-0.5"><span className="font-semibold">Resolução:</span> {o.resolucao}</p>}

      <div className="flex items-center gap-3 mt-1 flex-wrap">
        <label className={`inline-flex items-center gap-1 text-blue-600 hover:underline font-semibold cursor-pointer ${salvando ? 'opacity-60 pointer-events-none' : ''}`}>
          <Upload size={12} aria-hidden="true" /> Anexar
          <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" disabled={salvando} aria-label="Anexar evidência da ocorrência" onChange={e => anexar(e.target.files?.[0] || null)} />
        </label>
        {ehAdmin && o.status === 'aberta' && (
          <button disabled={salvando} onClick={() => mudarStatus('em_analise')} className={`text-blue-700 hover:underline font-semibold ${FOCO}`}>Marcar em análise</button>
        )}
        {ehAdmin && o.status !== 'resolvida' && (
          <button disabled={salvando} onClick={() => setResolvendo(v => !v)} aria-expanded={resolvendo} className={`text-green-700 hover:underline font-semibold ${FOCO}`}>Resolver</button>
        )}
      </div>

      {resolvendo && (
        <div className="mt-1 space-y-1">
          <input value={resolucao} onChange={e => setResolucao(e.target.value)} placeholder="Como foi resolvida?" aria-label="Como foi resolvida" className="w-full text-xs border border-gray-200 rounded px-2 py-1.5" />
          <div className="flex items-center gap-2 flex-wrap">
            <button disabled={salvando || !resolucao.trim()} onClick={() => mudarStatus('resolvida', resolucao)} className={`text-xs bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white rounded px-3 py-1.5 font-semibold ${FOCO}`}>{salvando ? 'Salvando…' : 'Confirmar'}</button>
            <button onClick={() => { setResolvendo(false); setResolucao(''); }} className={`text-xs text-gray-500 hover:underline ${FOCO}`}>Cancelar</button>
          </div>
        </div>
      )}
      <ErroAcao msg={erroAcao} />
    </li>
  );
};

export default FreteEpodOcorrencias;
