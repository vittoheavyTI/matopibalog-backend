import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import {
  TrendingUp, TrendingDown, RotateCcw, AlertTriangle, ChevronDown, ChevronRight, Filter, Info,
} from 'lucide-react';
import { formatCurrency } from '../utils';
import api from '../api';

// Rentabilidade OPERACIONAL DIRETA por viagem. O BACKEND é a autoridade do
// cálculo (regra B de receita + comissão canônica); esta tela apenas APRESENTA
// os valores retornados por GET /relatorios/rentabilidade. Não recalcula regra.

type Custos = { combustivel: number; pedagio: number; outras_despesas: number; comissao: number; total: number };
type Item = {
  frete_id: string; status: string; realizada: boolean;
  receita_realizada: number; custos: Custos;
  resultado_operacional: number | null; margem_percentual: number | null;
  dados_completos: boolean; alertas: string[];
  data: string | null; origem: string | null; destino: string | null;
  motorista_id: string | null; motorista_nome: string | null;
};
type Resumo = {
  receita_realizada: number; custo_direto: number; resultado_operacional: number;
  margem_percentual: number | null; viagens_finalizadas: number;
  viagens_em_andamento: number; viagens_dados_incompletos: number;
};

const fmtPct = (v: number | null) => (v === null || v === undefined ? '—' : `${v.toFixed(1).replace('.', ',')}%`);
const fmtData = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? '—' : format(d, 'dd/MM/yyyy');
};
const rotuloStatus = (s: string) =>
  s === 'finalizado' ? 'Finalizado' : s === 'ativo' ? 'Em andamento' : s === 'pendente' ? 'Pendente' : s || '—';
const rotuloAlerta = (a: string) => ({
  em_andamento: 'Em andamento (não realizada)',
  lancamentos_pendentes: 'Há lançamentos pendentes',
  receita_zero: 'Receita zero',
  custo_sem_receita: 'Custo sem receita',
}[a] || a);

const Card: React.FC<{ label: string; valor: string; cor?: string; sub?: string }> = ({ label, valor, cor, sub }) => (
  <div className="bg-white rounded-xl border border-gray-100 p-3">
    <p className="text-[11px] text-gray-500 font-medium">{label}</p>
    <p className={`text-lg font-bold ${cor || 'text-gray-800'}`}>{valor}</p>
    {sub && <p className="text-[11px] text-gray-400">{sub}</p>}
  </div>
);

const Rentabilidade: React.FC = () => {
  const hoje = new Date();
  const [inicio, setInicio] = useState(format(startOfMonth(hoje), 'yyyy-MM-dd'));
  const [fim, setFim] = useState(format(endOfMonth(hoje), 'yyyy-MM-dd'));
  const [status, setStatus] = useState('');
  const [resultado, setResultado] = useState('');
  const [motoristaId, setMotoristaId] = useState('');

  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [motoristas, setMotoristas] = useState<{ id: string; nome: string }[]>([]);
  const [expandido, setExpandido] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('');
    try {
      const { data } = await api.get('/relatorios/rentabilidade', {
        params: {
          inicio: inicio || undefined, fim: fim || undefined,
          status: status || undefined, resultado: resultado || undefined,
          motorista_id: motoristaId || undefined,
        },
      });
      setResumo(data?.resumo ?? null);
      setItens(Array.isArray(data?.itens) ? data.itens : []);
      // Popula o filtro de motorista a partir do resultado quando "todos".
      if (!motoristaId) {
        const mapa = new Map<string, string>();
        (data?.itens || []).forEach((i: Item) => { if (i.motorista_id) mapa.set(i.motorista_id, i.motorista_nome || 'Motorista'); });
        setMotoristas(Array.from(mapa, ([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome)));
      }
    } catch (e) {
      const err = e as { response?: { status?: number; data?: { message?: string } } };
      const st = err?.response?.status;
      setErro(st === 429
        ? 'Muitas solicitações agora. Aguarde alguns segundos e tente novamente.'
        : (err?.response?.data?.message || 'Não foi possível carregar a rentabilidade.'));
    } finally { setCarregando(false); }
  }, [inicio, fim, status, resultado, motoristaId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- busca ao montar / ao mudar filtros
  useEffect(() => { carregar(); }, [carregar]);

  const limpar = () => {
    setInicio(format(startOfMonth(hoje), 'yyyy-MM-dd'));
    setFim(format(endOfMonth(hoje), 'yyyy-MM-dd'));
    setStatus(''); setResultado(''); setMotoristaId('');
  };

  const resultadoCor = (v: number | null) => (v === null ? 'text-gray-400' : v > 0 ? 'text-green-700' : v < 0 ? 'text-red-600' : 'text-gray-700');

  const cards = useMemo(() => {
    if (!resumo) return null;
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        <Card label="Receita realizada" valor={formatCurrency(resumo.receita_realizada)} />
        <Card label="Custo direto" valor={formatCurrency(resumo.custo_direto)} cor="text-gray-800" />
        <Card label="Resultado operacional" valor={formatCurrency(resumo.resultado_operacional)} cor={resultadoCor(resumo.resultado_operacional)} />
        <Card label="Margem" valor={fmtPct(resumo.margem_percentual)} cor={resultadoCor(resumo.resultado_operacional)}
          sub={`${resumo.viagens_finalizadas} finalizadas · ${resumo.viagens_em_andamento} em andamento`} />
      </div>
    );
  }, [resumo]);

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <TrendingUp className="text-green-700" size={20} aria-hidden="true" />
        <h1 className="text-xl font-bold text-gray-800">Rentabilidade por viagem</h1>
      </div>
      <p className="text-xs text-gray-500 mb-3 inline-flex items-start gap-1">
        <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>Resultado operacional: considera a receita realizada (viagens finalizadas) e os custos diretos vinculados à viagem (combustível, pedágio, outras despesas e comissão). Não inclui custos fixos nem contabilidade completa.</span>
      </p>

      {/* Filtros */}
      <div className="bg-white rounded-xl border border-gray-100 p-3 mb-3">
        <div className="flex items-center gap-1 text-[11px] font-bold text-gray-500 uppercase mb-2"><Filter size={12} aria-hidden="true" /> Filtros</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
          <label className="text-xs text-gray-600">Início
            <input type="date" value={inicio} onChange={e => setInicio(e.target.value)} className="w-full mt-0.5 text-xs border border-gray-200 rounded px-2 py-1.5" />
          </label>
          <label className="text-xs text-gray-600">Fim
            <input type="date" value={fim} onChange={e => setFim(e.target.value)} className="w-full mt-0.5 text-xs border border-gray-200 rounded px-2 py-1.5" />
          </label>
          <label className="text-xs text-gray-600">Motorista
            <select value={motoristaId} onChange={e => setMotoristaId(e.target.value)} className="w-full mt-0.5 text-xs border border-gray-200 rounded px-2 py-1.5 bg-white">
              <option value="">Todos</option>
              {motoristas.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-600">Situação
            <select value={status} onChange={e => setStatus(e.target.value)} className="w-full mt-0.5 text-xs border border-gray-200 rounded px-2 py-1.5 bg-white">
              <option value="">Todas</option>
              <option value="finalizado">Finalizado</option>
              <option value="ativo">Em andamento</option>
            </select>
          </label>
          <label className="text-xs text-gray-600">Resultado
            <select value={resultado} onChange={e => setResultado(e.target.value)} className="w-full mt-0.5 text-xs border border-gray-200 rounded px-2 py-1.5 bg-white">
              <option value="">Todos</option>
              <option value="rentavel">Rentável</option>
              <option value="prejuizo">Prejuízo</option>
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button onClick={limpar} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:underline"><RotateCcw size={12} aria-hidden="true" /> Limpar filtros</button>
        </div>
      </div>

      {carregando ? (
        <p className="text-sm text-gray-400 py-8 text-center">Carregando rentabilidade…</p>
      ) : erro ? (
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <p role="alert" className="text-sm text-red-600 mb-2">{erro}</p>
          <button onClick={carregar} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline font-semibold"><RotateCcw size={12} aria-hidden="true" /> Tentar novamente</button>
        </div>
      ) : (
        <>
          {cards}
          {resumo && resumo.viagens_dados_incompletos > 0 && (
            <p className="text-[11px] text-amber-700 inline-flex items-center gap-1 mb-2"><AlertTriangle size={12} aria-hidden="true" /> {resumo.viagens_dados_incompletos} viagem(ns) com dados incompletos (lançamentos pendentes).</p>
          )}

          {itens.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
              <p className="text-sm text-gray-400">Nenhuma viagem no período/filtros selecionados.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-100">
                    <th className="px-2 py-2 font-semibold">Viagem</th>
                    <th className="px-2 py-2 font-semibold">Motorista</th>
                    <th className="px-2 py-2 font-semibold text-right">Receita</th>
                    <th className="px-2 py-2 font-semibold text-right">Custo</th>
                    <th className="px-2 py-2 font-semibold text-right">Resultado</th>
                    <th className="px-2 py-2 font-semibold text-right">Margem</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map(it => (
                    <React.Fragment key={it.frete_id}>
                      <tr className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-2 py-2">
                          <div className="text-gray-700">{fmtData(it.data)}</div>
                          <div className="text-gray-400">{(it.origem || '—')} → {(it.destino || '—')}</div>
                          <div className="mt-0.5">
                            <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${it.realizada ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{rotuloStatus(it.status)}</span>
                            {!it.dados_completos && it.realizada && <span className="ml-1 inline-flex items-center gap-0.5 text-amber-600 text-[10px]"><AlertTriangle size={10} aria-hidden="true" /> incompleto</span>}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-gray-700">{it.motorista_nome || '—'}</td>
                        <td className="px-2 py-2 text-right text-gray-700">{it.realizada ? formatCurrency(it.receita_realizada) : '—'}</td>
                        <td className="px-2 py-2 text-right text-gray-700">{formatCurrency(it.custos.total)}</td>
                        <td className={`px-2 py-2 text-right font-semibold ${resultadoCor(it.resultado_operacional)}`}>
                          {it.resultado_operacional === null ? '—' : (
                            <span className="inline-flex items-center gap-0.5 justify-end">
                              {it.resultado_operacional > 0 ? <TrendingUp size={11} aria-hidden="true" /> : it.resultado_operacional < 0 ? <TrendingDown size={11} aria-hidden="true" /> : null}
                              {formatCurrency(it.resultado_operacional)}
                            </span>
                          )}
                        </td>
                        <td className={`px-2 py-2 text-right ${resultadoCor(it.resultado_operacional)}`}>{fmtPct(it.margem_percentual)}</td>
                        <td className="px-2 py-2 text-right">
                          <button onClick={() => setExpandido(expandido === it.frete_id ? null : it.frete_id)} aria-expanded={expandido === it.frete_id} aria-label="Ver composição" className="text-gray-400 hover:text-gray-700">
                            {expandido === it.frete_id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        </td>
                      </tr>
                      {expandido === it.frete_id && (
                        <tr className="bg-gray-50">
                          <td colSpan={7} className="px-3 py-2">
                            <p className="text-[11px] font-bold text-gray-500 uppercase mb-1">Composição do custo</p>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-gray-700">
                              <div><span className="text-gray-400">Combustível:</span> {formatCurrency(it.custos.combustivel)}</div>
                              <div><span className="text-gray-400">Pedágio:</span> {formatCurrency(it.custos.pedagio)}</div>
                              <div><span className="text-gray-400">Outras despesas:</span> {formatCurrency(it.custos.outras_despesas)}</div>
                              <div><span className="text-gray-400">Comissão:</span> {formatCurrency(it.custos.comissao)}</div>
                            </div>
                            {it.alertas.length > 0 && (
                              <p className="text-[11px] text-amber-700 mt-1 inline-flex items-center gap-1"><AlertTriangle size={11} aria-hidden="true" /> {it.alertas.map(rotuloAlerta).join(' · ')}</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Rentabilidade;
