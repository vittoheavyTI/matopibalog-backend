import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { AlertTriangle, CheckCircle2, Filter, Info, RotateCcw, ShieldAlert, TowerControl } from 'lucide-react';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency } from '../utils';

type Nivel = 'critico' | 'atencao' | 'ok' | 'informativo';
type Resumo = {
  fretes_total: number;
  criticos: number;
  atencao: number;
  ok: number;
  informativos: number;
  em_andamento: number;
  finalizados: number;
  cancelados: number;
  ocorrencias_abertas: number;
  epods_pendentes: number;
  dados_incompletos: number;
};
type Item = {
  frete_id: string;
  motorista_id: string | null;
  motorista_nome: string | null;
  data: string | null;
  origem: string | null;
  destino: string | null;
  placa: string | null;
  status: string | null;
  valor_frete: number | null;
  nivel: Nivel;
  situacao: string;
  motivo: string;
  dados_incompletos: string[];
  ocorrencias: { total: number; abertas: number; atraso_aberto: boolean; tipos_abertos: string[] };
  epod: {
    status: string;
    evidencias_total: number;
    evidencias_pendentes: number;
    evidencias_aprovadas: number;
    evidencias_rejeitadas: number;
  };
};
type EmpresaApi = { id: string; nome?: string | null; tipo?: string | null };
type MotoristaApi = { id: string; usuarios?: { nome?: string | null } | null };
type ApiError = { response?: { status?: number; data?: { message?: string } } };

const fmtData = (iso: string | null) => {
  if (!iso) return '-';
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? '-' : format(d, 'dd/MM/yyyy');
};

const nivelRotulo: Record<Nivel, string> = {
  critico: 'Critico',
  atencao: 'Atencao',
  ok: 'OK',
  informativo: 'Informativo',
};

const nivelClasse: Record<Nivel, string> = {
  critico: 'bg-red-50 text-red-700 border-red-100',
  atencao: 'bg-amber-50 text-amber-700 border-amber-100',
  ok: 'bg-green-50 text-green-700 border-green-100',
  informativo: 'bg-gray-50 text-gray-600 border-gray-100',
};

const statusRotulo = (status: string | null) => ({
  ativo: 'Em andamento',
  pendente: 'Pendente',
  finalizado: 'Finalizado',
  cancelado: 'Cancelado',
}[status || ''] || status || '-');

const epodRotulo = (status: string) => ({
  sem_epod: 'Sem comprovacao',
  registrado: 'Registrado',
  parcial: 'Parcial',
  validado: 'Validado',
  rejeitado: 'Rejeitado',
}[status] || status || '-');

const Card: React.FC<{ label: string; valor: string; sub?: string; cor?: string }> = ({ label, valor, sub, cor }) => (
  <div className="bg-white rounded-lg border border-gray-100 p-3">
    <p className="text-[11px] text-gray-500 font-medium">{label}</p>
    <p className={`text-xl font-bold ${cor || 'text-gray-800'}`}>{valor}</p>
    {sub && <p className="text-[11px] text-gray-400">{sub}</p>}
  </div>
);

const LinhaItem: React.FC<{ item: Item }> = ({ item }) => (
  <div className="grid gap-2 border-b border-gray-100 px-3 py-3 text-xs md:grid-cols-[minmax(190px,1.4fr)_minmax(150px,1fr)_minmax(130px,0.8fr)_minmax(180px,1.2fr)] md:items-center">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${nivelClasse[item.nivel]}`}>{nivelRotulo[item.nivel]}</span>
        <span className="font-semibold text-gray-800">{item.situacao}</span>
      </div>
      <p className="mt-1 truncate text-gray-500">{fmtData(item.data)} - {item.origem || '-'} para {item.destino || '-'}</p>
    </div>
    <div className="min-w-0 text-gray-700">
      <p className="truncate font-medium">{item.motorista_nome || 'Motorista nao informado'}</p>
      <p className="text-gray-400">{item.placa || 'Placa nao informada'}</p>
    </div>
    <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold text-gray-600 md:block md:space-y-1">
      <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5">{statusRotulo(item.status)}</span>
      <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5">{item.valor_frete === null ? '-' : formatCurrency(item.valor_frete)}</span>
    </div>
    <div className="min-w-0 text-gray-600">
      <p>{item.motivo}</p>
      <p className="mt-1 text-[11px] text-gray-400">
        Ocorrencias abertas: {item.ocorrencias.abertas} - ePOD: {epodRotulo(item.epod.status)}
        {item.epod.evidencias_total > 0 ? ` (${item.epod.evidencias_aprovadas} aprov., ${item.epod.evidencias_pendentes} pend.)` : ''}
      </p>
      {item.dados_incompletos.length > 0 && (
        <p className="mt-1 text-[11px] text-amber-700">Dados incompletos: {item.dados_incompletos.join(', ')}</p>
      )}
    </div>
  </div>
);

export const TorreControle: React.FC = () => {
  const { user } = useAuth();
  const isSuperAdmin = user?.is_super_admin === true;
  const hoje = new Date();
  const [inicio, setInicio] = useState(format(startOfMonth(hoje), 'yyyy-MM-dd'));
  const [fim, setFim] = useState(format(endOfMonth(hoje), 'yyyy-MM-dd'));
  const [empresaId, setEmpresaId] = useState('');
  const [motoristaId, setMotoristaId] = useState('');
  const [status, setStatus] = useState('');
  const [nivel, setNivel] = useState('');
  const [empresas, setEmpresas] = useState<{ id: string; nome: string }[]>([]);
  const [motoristas, setMotoristas] = useState<{ id: string; nome: string }[]>([]);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!isSuperAdmin) return;
    let vivo = true;
    api.get('/painel-admin/empresas')
      .then((res) => {
        if (!vivo) return;
        const lista = ((res.data || []) as EmpresaApi[])
          .map((e) => ({ id: e.id, nome: e.nome || 'Conta sem nome' }))
          .sort((a, b) => a.nome.localeCompare(b.nome));
        setEmpresas(lista);
        if (!empresaId && lista.length) setEmpresaId(lista[0].id);
      })
      .catch(() => setEmpresas([]));
    return () => { vivo = false; };
  }, [empresaId, isSuperAdmin]);

  useEffect(() => {
    let vivo = true;
    if (isSuperAdmin && !empresaId) {
      queueMicrotask(() => { if (vivo) setMotoristas([]); });
      return () => { vivo = false; };
    }
    const params = isSuperAdmin ? { empresa_id: empresaId } : undefined;
    api.get('/admin/motoristas', { params })
      .then((res) => {
        if (!vivo) return;
        setMotoristas(((res.data || []) as MotoristaApi[])
          .map((m) => ({ id: m.id, nome: m.usuarios?.nome || 'Motorista' }))
          .sort((a, b) => a.nome.localeCompare(b.nome)));
      })
      .catch(() => setMotoristas([]));
    return () => { vivo = false; };
  }, [empresaId, isSuperAdmin]);

  const carregar = useCallback(async () => {
    if (isSuperAdmin && !empresaId) return;
    setCarregando(true);
    setErro('');
    try {
      const { data } = await api.get('/relatorios/torre-controle', {
        params: {
          inicio: inicio || undefined,
          fim: fim || undefined,
          empresa_id: isSuperAdmin ? empresaId : undefined,
          motorista_id: motoristaId || undefined,
          status: status || undefined,
          nivel: nivel || undefined,
        },
      });
      setResumo(data?.resumo || null);
      setItens(Array.isArray(data?.itens) ? data.itens : []);
    } catch (e) {
      const err = e as ApiError;
      setErro(err?.response?.status === 429
        ? 'Muitas solicitacoes agora. Aguarde alguns segundos e tente novamente.'
        : (err?.response?.data?.message || 'Nao foi possivel carregar a torre de controle.'));
    } finally {
      setCarregando(false);
    }
  }, [empresaId, fim, inicio, isSuperAdmin, motoristaId, nivel, status]);

  useEffect(() => {
    queueMicrotask(() => { void carregar(); });
  }, [carregar]);

  const limpar = () => {
    setInicio(format(startOfMonth(hoje), 'yyyy-MM-dd'));
    setFim(format(endOfMonth(hoje), 'yyyy-MM-dd'));
    setMotoristaId('');
    setStatus('');
    setNivel('');
  };

  const cards = useMemo(() => {
    if (!resumo) return null;
    return (
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        <Card label="Criticos" valor={String(resumo.criticos)} cor={resumo.criticos > 0 ? 'text-red-700' : 'text-gray-800'} />
        <Card label="Atencao" valor={String(resumo.atencao)} cor={resumo.atencao > 0 ? 'text-amber-700' : 'text-gray-800'} />
        <Card label="OK" valor={String(resumo.ok)} cor="text-green-700" />
        <Card label="Ocorrencias abertas" valor={String(resumo.ocorrencias_abertas)} />
        <Card label="ePOD pendente" valor={String(resumo.epods_pendentes)} />
        <Card label="Fretes" valor={String(resumo.fretes_total)} sub={`${resumo.em_andamento} andamento - ${resumo.finalizados} finalizados`} />
      </div>
    );
  }, [resumo]);

  return (
    <div className="mx-auto max-w-6xl p-4">
      <div className="mb-1 flex items-center gap-2">
        <TowerControl className="text-green-700" size={21} aria-hidden="true" />
        <h1 className="text-xl font-bold text-gray-800">Torre de controle</h1>
      </div>
      <p className="mb-3 inline-flex items-start gap-1 text-xs text-gray-500">
        <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>Visao operacional por viagem com prioridades calculadas pelo backend a partir de fretes, ocorrencias e ePOD.</span>
      </p>

      <div className="mb-3 rounded-lg border border-gray-100 bg-white p-3">
        <div className="mb-2 flex items-center gap-1 text-[11px] font-bold uppercase text-gray-500">
          <Filter size={12} aria-hidden="true" /> Filtros
        </div>
        <div className="grid grid-cols-2 items-end gap-2 md:grid-cols-6">
          {isSuperAdmin && (
            <label className="text-xs text-gray-600">Empresa
              <select value={empresaId} onChange={(e) => { setEmpresaId(e.target.value); setMotoristaId(''); }} className="mt-0.5 w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-xs">
                {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </select>
            </label>
          )}
          <label className="text-xs text-gray-600">Inicio
            <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
          <label className="text-xs text-gray-600">Fim
            <input type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
          <label className="text-xs text-gray-600">Motorista
            <select value={motoristaId} onChange={(e) => setMotoristaId(e.target.value)} className="mt-0.5 w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-xs">
              <option value="">Todos</option>
              {motoristas.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-600">Status
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-0.5 w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-xs">
              <option value="">Todos</option>
              <option value="ativo">Em andamento</option>
              <option value="pendente">Pendente</option>
              <option value="finalizado">Finalizado</option>
              <option value="cancelado">Cancelado</option>
            </select>
          </label>
          <label className="text-xs text-gray-600">Prioridade
            <select value={nivel} onChange={(e) => setNivel(e.target.value)} className="mt-0.5 w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-xs">
              <option value="">Todas</option>
              <option value="critico">Critico</option>
              <option value="atencao">Atencao</option>
              <option value="ok">OK</option>
              <option value="informativo">Informativo</option>
            </select>
          </label>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <button onClick={limpar} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:underline">
            <RotateCcw size={12} aria-hidden="true" /> Limpar filtros
          </button>
          <button onClick={carregar} className="text-xs font-semibold text-blue-700 hover:underline">Atualizar</button>
        </div>
      </div>

      {carregando ? (
        <p className="py-8 text-center text-sm text-gray-400">Carregando torre de controle...</p>
      ) : erro ? (
        <div className="rounded-lg border border-gray-100 bg-white p-4 text-center">
          <p role="alert" className="mb-2 text-sm text-red-600">{erro}</p>
          <button onClick={carregar} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline">
            <RotateCcw size={12} aria-hidden="true" /> Tentar novamente
          </button>
        </div>
      ) : (
        <>
          {cards}
          <div className="mt-3 rounded-lg border border-gray-100 bg-white">
            <div className="hidden border-b border-gray-100 px-3 py-2 text-[11px] font-bold uppercase text-gray-500 md:grid md:grid-cols-[minmax(190px,1.4fr)_minmax(150px,1fr)_minmax(130px,0.8fr)_minmax(180px,1.2fr)]">
              <span>Viagem</span><span>Motorista</span><span>Status</span><span>Detalhe</span>
            </div>
            {itens.length === 0 ? (
              <div className="p-8 text-center">
                <CheckCircle2 className="mx-auto mb-2 text-green-600" size={22} aria-hidden="true" />
                <p className="text-sm text-gray-400">Nenhuma viagem encontrada para os filtros selecionados.</p>
              </div>
            ) : (
              itens.map((item) => <LinhaItem key={item.frete_id} item={item} />)
            )}
          </div>
          {resumo && (resumo.criticos > 0 || resumo.atencao > 0) && (
            <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-amber-700">
              {resumo.criticos > 0 ? <ShieldAlert size={12} aria-hidden="true" /> : <AlertTriangle size={12} aria-hidden="true" />}
              Pendencias exibidas sao derivadas de dados existentes; a tela nao cria nem altera registros.
            </p>
          )}
        </>
      )}
    </div>
  );
};
