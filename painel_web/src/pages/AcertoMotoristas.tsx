import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { AlertTriangle, ChevronDown, ChevronRight, Filter, Info, Receipt, RotateCcw } from 'lucide-react';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency } from '../utils';

type Resumo = {
  total_creditos: number;
  total_debitos: number;
  total_informativo: number;
  saldo_acerto: number;
  motoristas: number;
  viagens_consideradas: number;
  itens_incompletos: number;
  situacao: string;
};

type Item = {
  data: string | null;
  frete_id: string | null;
  rota: string | null;
  natureza: string;
  descricao: string;
  origem: string;
  origem_id: string | null;
  quem_pagou: string | null;
  status: string | null;
  valor: number;
  classificacao: 'credito' | 'debito' | 'informativo' | 'incompleto';
  sinal: string;
  alerta: string | null;
};

type MotoristaAcerto = {
  motorista_id: string;
  motorista_nome: string;
  empresa_nome: string | null;
  empresa_tipo: string | null;
  resumo: Resumo;
  itens: Item[];
};
type EmpresaApi = { id: string; nome?: string | null; tipo?: string | null };
type MotoristaApi = { id: string; usuarios?: { nome?: string | null } | null };
type ApiError = { response?: { status?: number; data?: { message?: string } } };

const fmtData = (iso: string | null) => {
  if (!iso) return '-';
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? '-' : format(d, 'dd/MM/yyyy');
};

const classeSaldo = (v: number) => (v > 0 ? 'text-green-700' : v < 0 ? 'text-amber-700' : 'text-gray-700');
const rotuloQuemPagou = (v: string | null) => (
  v === 'proprietario' ? 'Empresa' : v === 'motorista' ? 'Motorista' : v === 'empresa' ? 'Empresa' : 'Nao informado'
);
const rotuloClassificacao = (v: Item['classificacao']) => ({
  credito: 'Credito',
  debito: 'Debito',
  informativo: 'Informativo - nao altera o acerto',
  incompleto: 'Dados incompletos',
}[v]);
const badgeClass = (v: Item['classificacao']) => ({
  credito: 'bg-green-50 text-green-700 border-green-100',
  debito: 'bg-rose-50 text-rose-700 border-rose-100',
  informativo: 'bg-gray-50 text-gray-600 border-gray-100',
  incompleto: 'bg-amber-50 text-amber-700 border-amber-100',
}[v]);

const Card: React.FC<{ label: string; valor: string; sub?: string; cor?: string }> = ({ label, valor, sub, cor }) => (
  <div className="bg-white rounded-lg border border-gray-100 p-3">
    <p className="text-[11px] text-gray-500 font-medium">{label}</p>
    <p className={`text-xl font-bold ${cor || 'text-gray-800'}`}>{valor}</p>
    {sub && <p className="text-[11px] text-gray-400">{sub}</p>}
  </div>
);

export const AcertoMotoristas: React.FC = () => {
  const { user } = useAuth();
  const isSuperAdmin = user?.is_super_admin === true;
  const hoje = new Date();
  const [inicio, setInicio] = useState(format(startOfMonth(hoje), 'yyyy-MM-dd'));
  const [fim, setFim] = useState(format(endOfMonth(hoje), 'yyyy-MM-dd'));
  const [motoristaId, setMotoristaId] = useState('');
  const [situacao, setSituacao] = useState('');
  const [empresas, setEmpresas] = useState<{ id: string; nome: string; tipo?: string }[]>([]);
  const [empresaId, setEmpresaId] = useState('');
  const [motoristasFiltro, setMotoristasFiltro] = useState<{ id: string; nome: string }[]>([]);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [motoristas, setMotoristas] = useState<MotoristaAcerto[]>([]);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!isSuperAdmin) return;
    let vivo = true;
    api.get('/painel-admin/empresas')
      .then((res) => {
        if (!vivo) return;
        const lista = ((res.data || []) as EmpresaApi[])
          .map((e) => ({ id: e.id, nome: e.nome || 'Conta sem nome', tipo: e.tipo || undefined }))
          .sort((a, b) => a.nome.localeCompare(b.nome));
        setEmpresas(lista);
        if (!empresaId && lista.length > 0) setEmpresaId(lista[0].id);
      })
      .catch(() => setEmpresas([]));
    return () => { vivo = false; };
  }, [isSuperAdmin, empresaId]);

  useEffect(() => {
    let vivo = true;
    const params = isSuperAdmin && empresaId ? { empresa_id: empresaId } : undefined;
    if (isSuperAdmin && !empresaId) {
      queueMicrotask(() => {
        if (vivo) setMotoristasFiltro([]);
      });
      return () => { vivo = false; };
    }
    api.get('/admin/motoristas', { params })
      .then((res) => {
        if (!vivo) return;
        setMotoristasFiltro(((res.data || []) as MotoristaApi[])
          .map((m) => ({ id: m.id, nome: m.usuarios?.nome || 'Motorista' }))
          .sort((a, b) => a.nome.localeCompare(b.nome)));
      })
      .catch(() => setMotoristasFiltro([]));
    return () => { vivo = false; };
  }, [isSuperAdmin, empresaId]);

  const carregar = useCallback(async () => {
    if (isSuperAdmin && !empresaId) return;
    setCarregando(true);
    setErro('');
    try {
      const { data } = await api.get('/relatorios/acerto-motoristas', {
        params: {
          inicio: inicio || undefined,
          fim: fim || undefined,
          motorista_id: motoristaId || undefined,
          empresa_id: isSuperAdmin ? empresaId : undefined,
        },
      });
      const lista = Array.isArray(data?.motoristas) ? data.motoristas : [];
      setResumo(data?.resumo || null);
      setMotoristas(lista);
      if (!motoristaId) {
        setMotoristasFiltro((prev) => {
          if (prev.length) return prev;
          return lista.map((m: MotoristaAcerto) => ({ id: m.motorista_id, nome: m.motorista_nome }));
        });
      }
    } catch (e) {
      const err = e as ApiError;
      setErro(err?.response?.status === 429
        ? 'Muitas solicitacoes agora. Aguarde alguns segundos e tente novamente.'
        : (err?.response?.data?.message || 'Nao foi possivel carregar o acerto de motoristas.'));
    } finally {
      setCarregando(false);
    }
  }, [empresaId, fim, inicio, isSuperAdmin, motoristaId]);

  useEffect(() => {
    queueMicrotask(() => { void carregar(); });
  }, [carregar]);

  const limpar = () => {
    setInicio(format(startOfMonth(hoje), 'yyyy-MM-dd'));
    setFim(format(endOfMonth(hoje), 'yyyy-MM-dd'));
    setMotoristaId('');
    setSituacao('');
  };

  const motoristasFiltrados = useMemo(() => (
    situacao ? motoristas.filter((m) => m.resumo.situacao === situacao) : motoristas
  ), [motoristas, situacao]);

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <Receipt className="text-blue-700" size={21} aria-hidden="true" />
        <h1 className="text-xl font-bold text-gray-800">Acerto de motoristas</h1>
      </div>
      <p className="text-xs text-gray-500 mb-3 inline-flex items-start gap-1">
        <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>Acerto do motorista consolida comissoes, reembolsos, vales, adiantamentos e demais ajustes atribuídos ao motorista no periodo. Nao representa a rentabilidade da empresa nem confirma que o valor foi pago.</span>
      </p>

      <div className="bg-white rounded-lg border border-gray-100 p-3 mb-3">
        <div className="flex items-center gap-1 text-[11px] font-bold text-gray-500 uppercase mb-2">
          <Filter size={12} aria-hidden="true" /> Filtros
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
          {isSuperAdmin && (
            <label className="text-xs text-gray-600">Empresa
              <select value={empresaId} onChange={(e) => { setEmpresaId(e.target.value); setMotoristaId(''); }} className="w-full mt-0.5 text-xs border border-gray-200 rounded px-2 py-1.5 bg-white">
                {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </select>
            </label>
          )}
          <label className="text-xs text-gray-600">Inicio
            <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="w-full mt-0.5 text-xs border border-gray-200 rounded px-2 py-1.5" />
          </label>
          <label className="text-xs text-gray-600">Fim
            <input type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="w-full mt-0.5 text-xs border border-gray-200 rounded px-2 py-1.5" />
          </label>
          <label className="text-xs text-gray-600">Motorista
            <select value={motoristaId} onChange={(e) => setMotoristaId(e.target.value)} className="w-full mt-0.5 text-xs border border-gray-200 rounded px-2 py-1.5 bg-white">
              <option value="">Todos</option>
              {motoristasFiltro.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-600">Situacao
            <select value={situacao} onChange={(e) => setSituacao(e.target.value)} className="w-full mt-0.5 text-xs border border-gray-200 rounded px-2 py-1.5 bg-white">
              <option value="">Todas</option>
              <option value="A pagar ao motorista">A pagar ao motorista</option>
              <option value="Sem saldo">Sem saldo</option>
              <option value="Saldo a compensar">Saldo a compensar</option>
            </select>
          </label>
        </div>
        <div className="flex items-center gap-3 mt-2">
          <button onClick={limpar} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:underline">
            <RotateCcw size={12} aria-hidden="true" /> Limpar filtros
          </button>
          <button onClick={carregar} className="text-xs text-blue-700 hover:underline font-semibold">Atualizar</button>
        </div>
      </div>

      {carregando ? (
        <p className="text-sm text-gray-400 py-8 text-center">Carregando acerto...</p>
      ) : erro ? (
        <div className="bg-white rounded-lg border border-gray-100 p-4 text-center">
          <p role="alert" className="text-sm text-red-600 mb-2">{erro}</p>
          <button onClick={carregar} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline font-semibold">
            <RotateCcw size={12} aria-hidden="true" /> Tentar novamente
          </button>
        </div>
      ) : (
        <>
          {resumo && (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3">
              <Card label="Creditos" valor={formatCurrency(resumo.total_creditos)} cor="text-green-700" />
              <Card label="Debitos" valor={formatCurrency(resumo.total_debitos)} cor="text-rose-700" />
              <Card label="Saldo do acerto" valor={formatCurrency(resumo.saldo_acerto)} cor={classeSaldo(resumo.saldo_acerto)} sub={resumo.situacao} />
              <Card label="Motoristas" valor={String(resumo.motoristas)} />
              <Card label="Viagens" valor={String(resumo.viagens_consideradas)} />
              <Card label="Incompletos" valor={String(resumo.itens_incompletos)} cor={resumo.itens_incompletos > 0 ? 'text-amber-700' : 'text-gray-800'} />
            </div>
          )}

          {resumo && resumo.total_informativo > 0 && (
            <p className="text-[11px] text-gray-500 mb-2">Informativo - nao altera o acerto: {formatCurrency(resumo.total_informativo)}.</p>
          )}

          {motoristasFiltrados.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-100 p-8 text-center">
              <p className="text-sm text-gray-400">Nenhum acerto encontrado para os filtros selecionados.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {motoristasFiltrados.map((m) => (
                <div key={m.motorista_id} className="bg-white rounded-lg border border-gray-100 overflow-hidden">
                  <button
                    onClick={() => setExpandido(expandido === m.motorista_id ? null : m.motorista_id)}
                    className="w-full text-left px-3 py-3 hover:bg-gray-50"
                    aria-expanded={expandido === m.motorista_id}
                  >
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                      <div>
                        <p className="font-bold text-gray-800">{m.motorista_nome}</p>
                        <p className="text-[11px] text-gray-400">{m.empresa_nome || 'Empresa'} · {m.resumo.viagens_consideradas} viagem(ns)</p>
                      </div>
                      <div className="grid grid-cols-3 md:grid-cols-5 gap-2 text-right text-xs">
                        <div><p className="text-gray-400">Creditos</p><p className="font-semibold text-green-700">{formatCurrency(m.resumo.total_creditos)}</p></div>
                        <div><p className="text-gray-400">Debitos</p><p className="font-semibold text-rose-700">{formatCurrency(m.resumo.total_debitos)}</p></div>
                        <div><p className="text-gray-400">Saldo</p><p className={`font-bold ${classeSaldo(m.resumo.saldo_acerto)}`}>{formatCurrency(m.resumo.saldo_acerto)}</p></div>
                        <div className="hidden md:block"><p className="text-gray-400">Situacao</p><p className="font-semibold text-gray-700">{m.resumo.situacao}</p></div>
                        <div className="flex justify-end items-center text-gray-400">{expandido === m.motorista_id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</div>
                      </div>
                    </div>
                  </button>
                  {expandido === m.motorista_id && (
                    <div className="border-t border-gray-100 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 text-gray-500">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold">Data</th>
                            <th className="px-3 py-2 text-left font-semibold">Viagem / rota</th>
                            <th className="px-3 py-2 text-left font-semibold">Natureza</th>
                            <th className="px-3 py-2 text-left font-semibold">Responsavel</th>
                            <th className="px-3 py-2 text-left font-semibold">Classificacao</th>
                            <th className="px-3 py-2 text-right font-semibold">Valor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {m.itens.map((it, idx) => (
                            <tr key={`${it.origem}-${it.origem_id || idx}`} className="border-t border-gray-50">
                              <td className="px-3 py-2 text-gray-600">{fmtData(it.data)}</td>
                              <td className="px-3 py-2">
                                <p className="text-gray-700">{it.rota || '-'}</p>
                                <p className="text-[10px] text-gray-400">{it.frete_id ? `Origem: ${it.origem}` : 'Sem viagem vinculada'}</p>
                              </td>
                              <td className="px-3 py-2">
                                <p className="text-gray-700">{it.natureza}</p>
                                <p className="text-[10px] text-gray-400">{it.descricao}</p>
                                {it.alerta && <p className="text-[10px] text-amber-700 inline-flex items-center gap-1"><AlertTriangle size={10} aria-hidden="true" /> {it.alerta}</p>}
                              </td>
                              <td className="px-3 py-2 text-gray-600">{rotuloQuemPagou(it.quem_pagou)}</td>
                              <td className="px-3 py-2">
                                <span className={`inline-block border rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeClass(it.classificacao)}`}>
                                  {rotuloClassificacao(it.classificacao)}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right font-semibold text-gray-800">{formatCurrency(it.valor)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
