import React, { useEffect, useState, useCallback } from 'react';
import { FileSignature, Search, RefreshCw, AlertTriangle, X, Check, ShieldCheck, Clock, FileText } from 'lucide-react';
import api from '../api';

// Super Admin › Contratos (macrofrente 3A-1, §18/§5).
// Lista agregada cross-tenant de contratos comerciais + detalhe (snapshot imutável,
// signatários, timeline de eventos). Read-only: consome GET /painel-admin/contratos
// e /painel-admin/contratos/:id. NÃO cria cobrança nem toca no contrato.

type ContratoItem = {
  contrato_id: string;
  empresa_id: string;
  cliente: string | null;
  empresa_tipo: string | null;
  plano_nome: string | null;
  valor_mensal: number | null;
  valor_implantacao: number | null;
  status: string;
  obrigatorio: boolean;
  assinado: boolean;
  versao: string | null;
  hash: string | null;
  hash_curto: string | null;
  criado_em: string | null;
  assinado_em: string | null;
};

type Resumo = { total: number; assinados: number; pendentes: number; cancelados: number; obrigatorios_pendentes: number };

type Signatario = { id: string; papel: string | null; nome: string | null; status: string | null; assinado: boolean; assinado_em: string | null; metodo_assinatura: string | null; email_mascarado: string | null };
type Evento = { id: string; tipo: string | null; detalhe: unknown; actor_papel: string | null; criado_em: string | null };
type Detalhe = ContratoItem & {
  tipo: string; proposta_id: string | null; atualizado_em: string | null;
  hash_documento_original: string | null; hash_assinado: string | null;
  trial_dias: number | null; capacidade_inclusa: number | null; preco_motorista_extra: number | null;
  snapshot: Record<string, unknown>; documentos: { contrato_assinado_disponivel: boolean; certificado_disponivel: boolean };
  signatarios: Signatario[]; eventos: Evento[];
};

const STATUS_OPCOES = [
  { v: '', label: 'Todos os status' },
  { v: 'assinado', label: 'Assinados' },
  { v: 'pendente', label: 'Pendentes' },
  { v: 'aguardando_assinatura_cliente', label: 'Aguardando cliente' },
  { v: 'aguardando_assinatura_matopiba', label: 'Aguardando Matopiba' },
  { v: 'cancelado', label: 'Cancelados' },
];

function fmtData(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
function fmtMoeda(v: number | null): string {
  if (v == null) return '—';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function statusBadge(c: { assinado: boolean; status: string }): string {
  if (c.assinado) return 'bg-green-50 text-green-700';
  if (c.status === 'cancelado') return 'bg-red-50 text-red-700';
  return 'bg-amber-50 text-amber-700';
}

export const PainelContratos: React.FC = () => {
  const [lista, setLista] = useState<ContratoItem[]>([]);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [migracaoPendente, setMigracaoPendente] = useState(false);

  const [cliente, setCliente] = useState('');
  const [status, setStatus] = useState('');
  const [plano, setPlano] = useState('');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');

  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  const [carregandoDetalhe, setCarregandoDetalhe] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(false);
    try {
      const params: Record<string, string> = {};
      if (cliente) params.cliente = cliente;
      if (status) params.status = status;
      if (plano) params.plano = plano;
      if (de) params.de = de;
      if (ate) params.ate = ate;
      const { data } = await api.get('/painel-admin/contratos', { params });
      setLista(data.contratos || []);
      setResumo(data.resumo || null);
      setMigracaoPendente(data.migration_pendente === true);
    } catch {
      setErro(true);
    } finally {
      setCarregando(false);
    }
  }, [cliente, status, plano, de, ate]);

  useEffect(() => { carregar(); }, [carregar]);

  const abrirDetalhe = useCallback(async (id: string) => {
    setCarregandoDetalhe(true);
    setDetalhe(null);
    try {
      const { data } = await api.get(`/painel-admin/contratos/${id}`);
      setDetalhe(data);
    } catch {
      setDetalhe(null);
    } finally {
      setCarregandoDetalhe(false);
    }
  }, []);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-2.5">
        <div className="bg-gray-800 p-1.5 rounded-lg text-white"><FileSignature size={18} /></div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800 leading-tight">Contratos</h1>
          <p className="text-sm text-gray-500">Clientes com contrato, snapshot comercial e assinaturas</p>
        </div>
      </div>

      {/* Resumo */}
      {resumo && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ResumoCard label="Total" valor={resumo.total} icon={FileText} cor="text-gray-700" />
          <ResumoCard label="Assinados" valor={resumo.assinados} icon={ShieldCheck} cor="text-green-700" />
          <ResumoCard label="Pendentes" valor={resumo.pendentes} icon={Clock} cor="text-amber-700" />
          <ResumoCard label="Obrigatórios pendentes" valor={resumo.obrigatorios_pendentes} icon={AlertTriangle} cor="text-red-700" />
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Buscar cliente / empresa" className="w-full pl-9 pr-3 py-2 border-2 border-gray-100 rounded-xl bg-gray-50/50 text-sm outline-none focus:border-blue-500" />
        </div>
        <input value={plano} onChange={(e) => setPlano(e.target.value)} placeholder="Plano" className="py-2 px-3 border-2 border-gray-100 rounded-xl bg-gray-50/50 text-sm min-w-32" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="py-2 px-3 border-2 border-gray-100 rounded-xl bg-gray-50/50 text-sm">
          {STATUS_OPCOES.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>
        <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="py-2 px-3 border-2 border-gray-100 rounded-xl bg-gray-50/50 text-sm" aria-label="Data inicial" />
        <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="py-2 px-3 border-2 border-gray-100 rounded-xl bg-gray-50/50 text-sm" aria-label="Data final" />
        <button onClick={carregar} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 rounded-xl font-medium text-sm hover:bg-gray-200"><RefreshCw size={15} />Atualizar</button>
      </div>

      {/* Estados */}
      {carregando && <div className="text-center text-gray-500 py-16">Carregando contratos…</div>}

      {!carregando && erro && (
        <div className="text-center py-16">
          <AlertTriangle className="mx-auto text-red-400 mb-2" size={32} />
          <p className="text-gray-600 mb-3">Não foi possível carregar os contratos.</p>
          <button onClick={carregar} className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700"><RefreshCw size={15} />Tentar novamente</button>
        </div>
      )}

      {!carregando && !erro && migracaoPendente && (
        <div className="text-center py-12 text-gray-500">
          <FileText className="mx-auto text-gray-300 mb-2" size={32} />
          Estrutura comercial ainda não disponível neste ambiente.
        </div>
      )}

      {!carregando && !erro && !migracaoPendente && lista.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <FileText className="mx-auto text-gray-300 mb-2" size={32} />
          Nenhum contrato encontrado com os filtros atuais.
        </div>
      )}

      {!carregando && !erro && lista.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-gray-100">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left p-3">Cliente</th>
                <th className="text-left p-3">Plano</th>
                <th className="text-left p-3">Mensal</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Obrig.</th>
                <th className="text-left p-3">Versão</th>
                <th className="text-left p-3">Criado</th>
                <th className="text-left p-3">Hash</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.contrato_id} className="border-t border-gray-100 hover:bg-gray-50/60">
                  <td className="p-3">
                    <div className="font-semibold text-gray-800">{c.cliente || '—'}</div>
                    <div className="text-xs text-gray-400">{c.empresa_tipo || ''}</div>
                  </td>
                  <td className="p-3 text-gray-600">{c.plano_nome || '—'}</td>
                  <td className="p-3 text-gray-600">{fmtMoeda(c.valor_mensal)}</td>
                  <td className="p-3"><span className={`px-2 py-0.5 rounded text-xs font-bold ${statusBadge(c)}`}>{c.assinado ? 'Assinado' : c.status}</span></td>
                  <td className="p-3">{c.obrigatorio ? <Check size={16} className="text-gray-600" /> : <span className="text-gray-300">—</span>}</td>
                  <td className="p-3 text-gray-500">{c.versao || '—'}</td>
                  <td className="p-3 text-gray-500 whitespace-nowrap">{fmtData(c.criado_em)}</td>
                  <td className="p-3 font-mono text-xs text-gray-400" title={c.hash || ''}>{c.hash_curto || '—'}</td>
                  <td className="p-3 text-right">
                    <button onClick={() => abrirDetalhe(c.contrato_id)} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-200">Detalhes</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(detalhe || carregandoDetalhe) && (
        <ModalDetalhe detalhe={detalhe} carregando={carregandoDetalhe} onClose={() => { setDetalhe(null); }} />
      )}
    </div>
  );
};

const ResumoCard: React.FC<{ label: string; valor: number; icon: React.ComponentType<{ size?: number; className?: string }>; cor: string }> = ({ label, valor, icon: Icon, cor }) => (
  <div className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-3">
    <Icon size={20} className={cor} />
    <div>
      <div className="text-2xl font-bold text-gray-800 leading-none">{valor}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  </div>
);

const ModalDetalhe: React.FC<{ detalhe: Detalhe | null; carregando: boolean; onClose: () => void }> = ({ detalhe, carregando, onClose }) => (
  <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
    <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
      <div className="flex items-center justify-between p-4 border-b border-gray-100 sticky top-0 bg-white">
        <h2 className="text-lg font-bold text-gray-800">Contrato</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Fechar"><X size={20} /></button>
      </div>

      {carregando && <div className="p-8 text-center text-gray-500">Carregando detalhes…</div>}

      {!carregando && detalhe && (
        <div className="p-4 space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Cliente" valor={detalhe.cliente} />
            <Campo label="Tipo empresa" valor={detalhe.empresa_tipo} />
            <Campo label="Plano" valor={detalhe.plano_nome} />
            <Campo label="Status" valor={detalhe.assinado ? 'Assinado' : detalhe.status} />
            <Campo label="Contrato UUID" valor={detalhe.contrato_id} mono />
            <Campo label="Versão" valor={detalhe.versao} />
            <Campo label="Obrigatório" valor={detalhe.obrigatorio ? 'Sim' : 'Não'} />
            <Campo label="Tipo" valor={detalhe.tipo} />
            <Campo label="Criado em" valor={fmtData(detalhe.criado_em)} />
            <Campo label="Assinado em" valor={fmtData(detalhe.assinado_em)} />
            <Campo label="Mensalidade" valor={fmtMoeda(detalhe.valor_mensal)} />
            <Campo label="Implantação" valor={fmtMoeda(detalhe.valor_implantacao)} />
            <Campo label="Trial (dias)" valor={detalhe.trial_dias != null ? String(detalhe.trial_dias) : '—'} />
            <Campo label="Capacidade inclusa" valor={detalhe.capacidade_inclusa != null ? String(detalhe.capacidade_inclusa) : '—'} />
          </div>

          <div>
            <div className="text-xs uppercase text-gray-400 font-bold mb-1">Hash do documento original</div>
            <div className="font-mono text-xs text-gray-600 break-all bg-gray-50 rounded-lg p-2">{detalhe.hash_documento_original || '—'}</div>
          </div>

          <div>
            <div className="text-xs uppercase text-gray-400 font-bold mb-2">Signatários</div>
            {detalhe.signatarios.length === 0 && <div className="text-gray-400">Nenhum signatário registrado.</div>}
            {detalhe.signatarios.map((s) => (
              <div key={s.id} className="flex items-center justify-between border-t border-gray-100 py-2">
                <div>
                  <span className="font-semibold text-gray-700">{s.papel}</span>
                  {s.nome ? <span className="text-gray-500"> — {s.nome}</span> : null}
                  {s.email_mascarado ? <span className="text-gray-400 text-xs"> ({s.email_mascarado})</span> : null}
                </div>
                <div className="text-right">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${s.assinado ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>{s.status}</span>
                  <div className="text-xs text-gray-400">{fmtData(s.assinado_em)}</div>
                </div>
              </div>
            ))}
          </div>

          <div>
            <div className="text-xs uppercase text-gray-400 font-bold mb-2">Histórico</div>
            {detalhe.eventos.length === 0 && <div className="text-gray-400">Sem eventos.</div>}
            <ol className="space-y-1">
              {detalhe.eventos.map((e) => (
                <li key={e.id} className="flex items-baseline gap-2">
                  <span className="text-xs text-gray-400 whitespace-nowrap">{fmtData(e.criado_em)}</span>
                  <span className="text-gray-700">{e.tipo}{e.actor_papel ? ` · ${e.actor_papel}` : ''}</span>
                </li>
              ))}
            </ol>
          </div>

          <details className="bg-gray-50 rounded-lg p-2">
            <summary className="cursor-pointer text-xs font-bold text-gray-500 uppercase">Snapshot comercial congelado</summary>
            <pre className="text-xs text-gray-600 mt-2 overflow-x-auto">{JSON.stringify(detalhe.snapshot, null, 2)}</pre>
          </details>
        </div>
      )}

      {!carregando && !detalhe && (
        <div className="p-8 text-center text-gray-500">Não foi possível carregar o contrato.</div>
      )}
    </div>
  </div>
);

const Campo: React.FC<{ label: string; valor: string | null; mono?: boolean }> = ({ label, valor, mono }) => (
  <div>
    <div className="text-xs uppercase text-gray-400 font-bold">{label}</div>
    <div className={`text-gray-700 ${mono ? 'font-mono text-xs break-all' : ''}`}>{valor || '—'}</div>
  </div>
);
