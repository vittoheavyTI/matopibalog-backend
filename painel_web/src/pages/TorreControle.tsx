import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { AlertTriangle, CheckCircle2, ChevronDown, Filter, Info, RotateCcw, Search, ShieldAlert, TowerControl } from 'lucide-react';
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
  sem_comprovacao: number;
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
    pendente_real?: boolean;
    sem_comprovacao?: boolean;
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
  critico: 'Crítico',
  atencao: 'Atenção',
  ok: 'Sem alertas',
  informativo: 'Somente consulta',
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
  sem_epod: 'sem comprovante de entrega registrado',
  registrado: 'aguardando análise',
  parcial: 'comprovação parcial',
  validado: 'aprovado',
  rejeitado: 'recusado',
}[status] || status || '-');

const plural = (qtd: number, singular: string, pluralizado: string) => (qtd === 1 ? singular : pluralizado);
const termoTecnicoComprovante = ['e', 'POD'].join('');
const legadoSemComprovante = ['Sem', 'comprovacao'].join(' ');
const legadoDadosIncompletos = ['Dados', 'incompletos'].join(' ');

const situacaoAmigavel = (item: Item) => ({
  [legadoSemComprovante]: 'Sem comprovante',
  'Sem comprovação': 'Sem comprovante',
  [legadoDadosIncompletos]: 'Informações incompletas',
  'Ocorrencia critica': 'Ocorrência crítica',
  'Ocorrência critica': 'Ocorrência crítica',
  Concluido: 'Concluído',
}[item.situacao] || item.situacao.replaceAll(termoTecnicoComprovante, 'Comprovante de entrega'));

const motivoAmigavel = (item: Item) => {
  if (item.status === 'cancelado') return 'Viagem cancelada: exibida somente para consulta.';
  if (item.status === 'ativo' && item.nivel === 'ok') return 'Viagem em andamento, sem alertas.';
  if (item.status === 'finalizado' && item.epod.status === 'sem_epod') return 'Viagem finalizada sem comprovante de entrega registrado.';
  if (item.status === 'finalizado' && item.epod.status === 'validado') return 'Viagem finalizada com comprovante de entrega aprovado.';
  return item.motivo
    .replaceAll(termoTecnicoComprovante, 'comprovante de entrega')
    .replaceAll('Frete', 'Viagem')
    .replaceAll('frete', 'viagem')
    .replaceAll(legadoDadosIncompletos, 'Informações incompletas');
};

const comprovanteDetalhe = (item: Item) => {
  const partes = [`Comprovante de entrega: ${epodRotulo(item.epod.status)}`];
  if (item.epod.evidencias_total > 0) {
    const aprovadas = `${item.epod.evidencias_aprovadas} ${plural(item.epod.evidencias_aprovadas, 'arquivo aprovado', 'arquivos aprovados')}`;
    const pendentes = `${item.epod.evidencias_pendentes} ${plural(item.epod.evidencias_pendentes, 'arquivo aguardando análise', 'arquivos aguardando análise')}`;
    partes.push(`${aprovadas}; ${pendentes}`);
  }
  return partes.join(' - ');
};

const normalizarBusca = (valor: string) => valor
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const empresaLabel = (empresas: { id: string; nome: string }[], id: string) => (
  empresas.find((empresa) => empresa.id === id)?.nome || ''
);

const EmpresaCombobox: React.FC<{
  empresas: { id: string; nome: string }[];
  value: string;
  onChange: (id: string) => void;
}> = ({ empresas, value, onChange }) => {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [ativo, setAtivo] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);
  const selecionada = empresaLabel(empresas, value);
  const filtradas = useMemo(() => {
    const termo = normalizarBusca(busca);
    if (!termo) return empresas;
    return empresas.filter((empresa) => normalizarBusca(empresa.nome).includes(termo));
  }, [busca, empresas]);

  useEffect(() => {
    if (!aberto) return undefined;
    const fecharFora = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', fecharFora);
    return () => document.removeEventListener('mousedown', fecharFora);
  }, [aberto]);

  const selecionar = (id: string) => {
    if (!empresas.some((empresa) => empresa.id === id)) return;
    onChange(id);
    setBusca('');
    setAtivo(0);
    setAberto(false);
  };

  return (
    <div ref={ref} className="relative text-xs text-gray-600">
      <label htmlFor="empresa-torre-combobox">Empresa</label>
      <div className="relative mt-0.5">
        <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" size={13} aria-hidden="true" />
        <input
          id="empresa-torre-combobox"
          type="text"
          role="combobox"
          aria-expanded={aberto}
          aria-controls="empresa-torre-listbox"
          aria-autocomplete="list"
          aria-activedescendant={aberto && filtradas[ativo] ? `empresa-torre-opcao-${filtradas[ativo].id}` : undefined}
          value={aberto ? busca : selecionada}
          onFocus={() => { setAberto(true); setBusca(''); setAtivo(0); }}
          onChange={(event) => { setBusca(event.target.value); setAberto(true); setAtivo(0); }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setAberto(false);
              setBusca('');
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setAberto(true);
              setAtivo((atual) => Math.min(atual + 1, Math.max(filtradas.length - 1, 0)));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setAtivo((atual) => Math.max(atual - 1, 0));
            }
            if (event.key === 'Enter' && aberto && filtradas[ativo]) {
              event.preventDefault();
              selecionar(filtradas[ativo].id);
            }
          }}
          className="w-full rounded border border-gray-200 bg-white py-1.5 pl-7 pr-7 text-xs text-gray-700 outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
        />
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400" size={13} aria-hidden="true" />
      </div>
      {aberto && (
        <div
          id="empresa-torre-listbox"
          role="listbox"
          className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded border border-gray-200 bg-white py-1 shadow-lg"
        >
          {filtradas.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">Nenhuma empresa encontrada</div>
          ) : filtradas.map((empresa, index) => (
            <button
              id={`empresa-torre-opcao-${empresa.id}`}
              key={empresa.id}
              type="button"
              role="option"
              aria-selected={empresa.id === value}
              onMouseDown={(event) => { event.preventDefault(); selecionar(empresa.id); }}
              className={`block w-full px-3 py-2 text-left text-xs ${index === ativo ? 'bg-green-50 text-green-800' : 'text-gray-700 hover:bg-gray-50'}`}
            >
              {empresa.nome}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

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
        <span className="font-semibold text-gray-800">{situacaoAmigavel(item)}</span>
      </div>
      <p className="mt-1 truncate text-gray-500">{fmtData(item.data)} - {item.origem || '-'} para {item.destino || '-'}</p>
    </div>
    <div className="min-w-0 text-gray-700">
      <p className="truncate font-medium">{item.motorista_nome || 'Motorista não informado'}</p>
      <p className="text-gray-400">{item.placa || 'Placa não informada'}</p>
    </div>
    <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold text-gray-600 md:block md:space-y-1">
      <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5">{statusRotulo(item.status)}</span>
      <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5">{item.valor_frete === null ? '-' : formatCurrency(item.valor_frete)}</span>
    </div>
    <div className="min-w-0 text-gray-600">
      <p>{motivoAmigavel(item)}</p>
      <p className="mt-1 text-[11px] text-gray-400">
        Ocorrências abertas: {item.ocorrencias.abertas} - {comprovanteDetalhe(item)}
      </p>
      {item.dados_incompletos.length > 0 && (
        <p className="mt-1 text-[11px] text-amber-700">Informações incompletas: {item.dados_incompletos.join(', ')}</p>
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
  const requisicaoAtual = useRef(0);

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
        setEmpresaId((atual) => (atual && lista.some((empresa) => empresa.id === atual) ? atual : (lista[0]?.id || '')));
      })
      .catch(() => setEmpresas([]));
    return () => { vivo = false; };
  }, [isSuperAdmin]);

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

  const trocarEmpresa = (id: string) => {
    if (!empresas.some((empresa) => empresa.id === id)) return;
    setEmpresaId(id);
    setMotoristaId('');
    setErro('');
    setResumo(null);
    setItens([]);
  };

  const carregar = useCallback(async () => {
    if (isSuperAdmin && !empresaId) return;
    const requisicao = requisicaoAtual.current + 1;
    requisicaoAtual.current = requisicao;
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
      if (requisicaoAtual.current !== requisicao) return;
      setResumo(data?.resumo || null);
      setItens(Array.isArray(data?.itens) ? data.itens : []);
    } catch (e) {
      if (requisicaoAtual.current !== requisicao) return;
      const err = e as ApiError;
      setErro(err?.response?.status === 429
        ? 'Muitas solicitações agora. Aguarde alguns segundos e tente novamente.'
        : (err?.response?.data?.message || 'Não foi possível carregar a Torre de Controle.'));
    } finally {
      if (requisicaoAtual.current === requisicao) setCarregando(false);
    }
  }, [empresaId, fim, inicio, isSuperAdmin, motoristaId, nivel, setCarregando, setErro, setItens, setResumo, status]);

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
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        <Card label="Alertas críticos" valor={String(resumo.criticos)} cor={resumo.criticos > 0 ? 'text-red-700' : 'text-gray-800'} />
        <Card label="Precisam de atenção" valor={String(resumo.atencao)} cor={resumo.atencao > 0 ? 'text-amber-700' : 'text-gray-800'} />
        <Card label="Sem alertas" valor={String(resumo.ok)} cor="text-green-700" />
        <Card label="Ocorrências abertas" valor={String(resumo.ocorrencias_abertas)} />
        <Card label="Comprovações pendentes" valor={String(resumo.epods_pendentes)} />
        <Card label="Sem comprovante" valor={String(resumo.sem_comprovacao || 0)} />
        <Card label="Total de viagens" valor={String(resumo.fretes_total)} sub={`${resumo.em_andamento} em andamento - ${resumo.finalizados} finalizadas`} />
      </div>
    );
  }, [resumo]);

  return (
    <div className="mx-auto max-w-6xl p-4">
      <div className="mb-1 flex items-center gap-2">
        <TowerControl className="text-green-700" size={21} aria-hidden="true" />
        <h1 className="text-xl font-bold text-gray-800">Torre de Controle</h1>
      </div>
      <p className="mb-3 inline-flex items-start gap-1 text-xs text-gray-500">
        <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>Acompanhe suas viagens e veja rapidamente quais precisam de atenção.</span>
      </p>

      <div className="mb-3 rounded-lg border border-gray-100 bg-white p-3">
        <div className="mb-2 flex items-center gap-1 text-[11px] font-bold uppercase text-gray-500">
          <Filter size={12} aria-hidden="true" /> Filtros
        </div>
        <div className="grid grid-cols-2 items-end gap-2 md:grid-cols-6">
          {isSuperAdmin && (
            <div className="col-span-2 md:col-span-2">
              <EmpresaCombobox empresas={empresas} value={empresaId} onChange={trocarEmpresa} />
            </div>
          )}
          <label className="text-xs text-gray-600">Início
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
              <option value="critico">Crítico</option>
              <option value="atencao">Atenção</option>
              <option value="ok">Sem alertas</option>
              <option value="informativo">Somente consulta</option>
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
        <p className="py-8 text-center text-sm text-gray-400">Carregando Torre de Controle...</p>
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
              Pendências exibidas são calculadas a partir dos dados existentes; esta tela não cria nem altera registros.
            </p>
          )}
        </>
      )}
    </div>
  );
};
