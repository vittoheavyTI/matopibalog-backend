import React, { useState, useEffect } from 'react';
import api from '../api';
import { CreditCard, Download, Search, Plus, RefreshCw, X, ExternalLink, Copy } from 'lucide-react';
import { civilDateToDayNumber, extractCivilDate, formatCivilDate, todayInBahia } from '../utils';

interface Fatura {
  id: string;
  empresa_id: string;
  asaas_id: string;
  valor: number;
  tipo_pagamento: 'PIX' | 'BOLETO' | 'CARTAO';
  status: 'pendente' | 'pago' | 'vencido' | 'cancelado' | 'estornado';
  invoice_url: string;
  pix_qr_code: string;
  due_date: string;
  pago_em: string;
  created_at: string;
  client_request_id?: string;
  idempotente?: boolean;
  empresas?: {
    nome: string;
    tipo: string;
    status: string;
    plano_id: string | null;
    planos?: { nome: string } | null;
  };
}

interface EmpresaOpcao {
  id: string;
  nome: string;
  tipo: string;
  cnpj?: string | null;
  email_contato?: string | null;
  telefone_contato?: string | null;
  asaas_customer_id?: string | null;
  planos?: { nome: string; preco_mensal: number } | null;
}

const statusMap: Record<string, { label: string; color: string }> = {
  pendente: { label: 'Pendente', color: 'bg-yellow-100 text-yellow-800' },
  pago: { label: 'Pago', color: 'bg-green-100 text-green-800' },
  vencido: { label: 'Vencido', color: 'bg-red-100 text-red-800' },
  cancelado: { label: 'Cancelado', color: 'bg-gray-100 text-gray-800' },
  estornado: { label: 'Estornado', color: 'bg-purple-100 text-purple-800' },
};

// Gera um id de requisição para idempotência (mesmo id ⇒ não duplica cobrança).
function novoClientRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const soDigitos = (v?: string | null) => (v || '').replace(/\D+/g, '');
const emailOk = (v?: string | null) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v || '').trim());

// Avalia se a conta tem cadastro suficiente para virar cliente Asaas.
// Retorna TODOS os campos obrigatórios faltantes (nome + CPF/CNPJ + e-mail) para
// exibir como checklist. Telefone é opcional no backend, então não entra aqui.
function avaliarConta(e: EmpresaOpcao): { ok: boolean; faltantes: string[] } {
  const faltantes: string[] = [];
  if (!(e.nome || '').trim()) faltantes.push('Nome da conta');
  const doc = soDigitos(e.cnpj);
  if (doc.length !== 11 && doc.length !== 14) faltantes.push('CPF ou CNPJ válido');
  if (!emailOk(e.email_contato)) faltantes.push('E-mail de contato válido');
  return { ok: faltantes.length === 0, faltantes };
}

// Estado do cadastro Asaas para exibir como badge (sem expor IDs internos do Asaas).
function estadoAsaas(e: EmpresaOpcao): { label: string; color: string } {
  if (e.asaas_customer_id) return { label: 'Cliente Asaas', color: 'bg-green-100 text-green-700' };
  return avaliarConta(e).ok
    ? { label: 'Sem cliente', color: 'bg-amber-100 text-amber-700' }
    : { label: 'Cadastro incompleto', color: 'bg-red-100 text-red-700' };
}

export const Faturas: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const [faturas, setFaturas] = useState<Fatura[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState('todos');
  const [statusFiltro, setStatusFiltro] = useState('todos');
  const [vencimentoFiltro, setVencimentoFiltro] = useState('todos');
  const [planoFiltro, setPlanoFiltro] = useState('todos');

  // Criação de cobrança sandbox (super-admin).
  const [empresas, setEmpresas] = useState<EmpresaOpcao[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ empresa_id: '', valor: '', tipo: 'PIX' as 'PIX' | 'BOLETO' | 'CARTAO', due_date: '' });
  const [clientRequestId, setClientRequestId] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erroModal, setErroModal] = useState('');
  const [precisaCliente, setPrecisaCliente] = useState(false);
  const [resultado, setResultado] = useState<Fatura | null>(null);
  const [conciliandoId, setConciliandoId] = useState('');
  // Combobox pesquisável de Conta.
  const [contaBusca, setContaBusca] = useState('');
  const [contaTipo, setContaTipo] = useState<'todas' | 'vinculados' | 'autonomos'>('todas');

  useEffect(() => {
    carregarFaturas();
    carregarEmpresas();
  }, []);

  const carregarFaturas = async () => {
    try {
      const response = await api.get('/pagamentos/cobrancas/all');
      setFaturas(response.data || []);
    } catch (err) {
      console.error('Erro ao carregar faturas:', err);
    } finally {
      setLoading(false);
    }
  };

  const carregarEmpresas = async () => {
    try {
      const response = await api.get('/painel-admin/empresas');
      setEmpresas(response.data || []);
    } catch (err) {
      console.error('Erro ao carregar empresas:', err);
    }
  };

  const abrirModal = () => {
    setForm({ empresa_id: '', valor: '', tipo: 'PIX', due_date: '' });
    setClientRequestId(novoClientRequestId());
    setErroModal('');
    setPrecisaCliente(false);
    setResultado(null);
    setContaBusca('');
    setContaTipo('todas');
    setShowModal(true);
  };

  const empresaSelecionada = empresas.find((e) => e.id === form.empresa_id);
  const contaIncompleta = empresaSelecionada ? !avaliarConta(empresaSelecionada).ok : false;
  // Preempção: o front já sabe se a conta tem cliente Asaas (asaas_customer_id).
  // Se estiver completa e sem cliente, mostramos direto o botão de criar cliente,
  // sem exigir um POST em /cobrancas que falharia primeiro. O catch de criarCobranca
  // mantém precisaCliente como fallback de segurança.
  const semCliente = !!empresaSelecionada && !empresaSelecionada.asaas_customer_id;
  const mostrarCriarCliente = precisaCliente || (semCliente && !contaIncompleta);
  const contasFiltradas = empresas.filter((e) => {
    const porTipo = contaTipo === 'todas'
      || (contaTipo === 'autonomos' ? e.tipo === 'autonomo' : e.tipo !== 'autonomo');
    const porBusca = e.nome.toLowerCase().includes(contaBusca.trim().toLowerCase());
    return porTipo && porBusca;
  });

  const criarCobranca = async () => {
    setErroModal('');
    setPrecisaCliente(false);
    const valorNum = Number(form.valor);
    if (!form.empresa_id) { setErroModal('Selecione uma conta.'); return; }
    if (!Number.isFinite(valorNum) || valorNum <= 0) { setErroModal('Informe um valor válido.'); return; }

    setEnviando(true);
    try {
      const { data } = await api.post('/pagamentos/cobrancas', {
        empresa_id: form.empresa_id,
        valor: valorNum,
        tipo: form.tipo,
        due_date: form.due_date || undefined,
        client_request_id: clientRequestId,
      });
      setResultado(data);
      if (data?.idempotente) {
        setErroModal('Cobrança já existente para esta solicitação.');
      }
      // Reflete na lista sem recarregar tudo (dedupe por id).
      setFaturas((prev) => {
        const semAtual = prev.filter((f) => f.id !== data.id);
        const comEmpresa: Fatura = { ...data, empresas: empresaSelecionada ? { nome: empresaSelecionada.nome, tipo: empresaSelecionada.tipo, status: '', plano_id: null, planos: empresaSelecionada.planos ? { nome: empresaSelecionada.planos.nome } : null } : data.empresas };
        return [comEmpresa, ...semAtual];
      });
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Erro ao criar cobrança.';
      setErroModal(msg);
      if (/sem cliente asaas/i.test(msg)) setPrecisaCliente(true);
    } finally {
      setEnviando(false);
    }
  };

  const criarClienteEReenviar = async () => {
    if (!empresaSelecionada) return;
    // Com a preempção, este botão pode aparecer antes de um POST em /cobrancas.
    // Garante um valor válido no front ANTES de criar o cliente (não muda payload
    // nem endpoint; só evita criar cliente e falhar em seguida por valor).
    const valorNum = Number(form.valor);
    if (!Number.isFinite(valorNum) || valorNum <= 0) { setErroModal('Informe um valor válido.'); return; }
    setEnviando(true);
    setErroModal('');
    try {
      await api.post('/pagamentos/clientes', {
        empresa_id: empresaSelecionada.id,
        nome: empresaSelecionada.nome,
        cpfCnpj: empresaSelecionada.cnpj || undefined,
        email: empresaSelecionada.email_contato || undefined,
        telefone: empresaSelecionada.telefone_contato || undefined,
      });
      setPrecisaCliente(false);
      await criarCobranca(); // mesmo client_request_id ⇒ idempotente
    } catch (err: any) {
      setErroModal(err?.response?.data?.message || 'Erro ao criar cliente Asaas.');
    } finally {
      setEnviando(false);
    }
  };

  const conciliar = async (id: string) => {
    setConciliandoId(id);
    try {
      const { data } = await api.post(`/pagamentos/cobrancas/${id}/conciliar`);
      setFaturas((prev) => prev.map((f) => (f.id === id ? { ...f, ...data } : f)));
    } catch (err) {
      console.error('Erro ao conciliar:', err);
    } finally {
      setConciliandoId('');
    }
  };

  const planos = Array.from(new Set(faturas.map(f => f.empresas?.planos?.nome).filter(Boolean) as string[])).sort();
  const hojeCivil = todayInBahia();
  const hojeDia = civilDateToDayNumber(hojeCivil) ?? 0;
  const filtered = faturas.filter(f => {
    const busca = search.toLowerCase();
    const porBusca = f.empresas?.nome?.toLowerCase().includes(busca) || f.asaas_id?.toLowerCase().includes(busca);
    const porTipo = tipoFiltro === 'todos'
      || (tipoFiltro === 'autonomos' ? f.empresas?.tipo === 'autonomo' : f.empresas?.tipo !== 'autonomo');
    const porStatus = statusFiltro === 'todos' || f.status === statusFiltro;
    const porPlano = planoFiltro === 'todos' || f.empresas?.planos?.nome === planoFiltro;
    const vencimentoDia = civilDateToDayNumber(f.due_date);
    const diasAteVencer = vencimentoDia === null ? null : vencimentoDia - hojeDia;
    const porVencimento = vencimentoFiltro === 'todos'
      || (vencimentoFiltro === 'vencidas' && diasAteVencer !== null && diasAteVencer < 0)
      || (vencimentoFiltro === 'proximos7' && diasAteVencer !== null && diasAteVencer >= 0 && diasAteVencer <= 7)
      || (vencimentoFiltro === 'sem_data' && vencimentoDia === null);
    return Boolean(porBusca && porTipo && porStatus && porPlano && porVencimento);
  });

  const totalAReceber = faturas
    .filter(f => f.status === 'pendente' || f.status === 'vencido')
    .reduce((s, f) => s + Number(f.valor), 0);
  const mesAtual = hojeCivil.slice(0, 7);
  const totalPagoNoMes = faturas
    .filter(f => f.status === 'pago' && extractCivilDate(f.pago_em)?.startsWith(mesAtual))
    .reduce((s, f) => s + Number(f.valor), 0);

  return (
    <div className="space-y-4 animate-fade-in">
      {!embedded && <div className="flex items-center space-x-3 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="bg-gray-800 p-2 rounded-lg text-white"><CreditCard size={24} /></div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Faturas</h1>
          <p className="text-sm text-gray-500">Faturas de todas as contas — cobrança em ambiente sandbox</p>
        </div>
      </div>}

      {/* Ação: criar cobrança sandbox (super-admin) */}
      <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
        <p className="text-xs text-amber-800">Ambiente <strong>sandbox</strong> — cobranças de teste, sem valor real.</p>
        <button onClick={abrirModal} className="inline-flex items-center gap-2 bg-green-700 hover:bg-green-800 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
          <Plus size={16} /> Criar cobrança sandbox
        </button>
      </div>

      {/* Cards resumo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="text-sm text-gray-500">A receber</div>
          <div className="text-2xl font-bold text-yellow-600">R$ {totalAReceber.toFixed(2)}</div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="text-sm text-gray-500">Recebido no mês</div>
          <div className="text-2xl font-bold text-green-600">R$ {totalPagoNoMes.toFixed(2)}</div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="text-sm text-gray-500">Total Faturas</div>
          <div className="text-2xl font-bold text-blue-600">{faturas.length}</div>
        </div>
      </div>

      {/* Filtros globais */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 bg-white p-4 rounded-xl border border-gray-100">
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Empresa ou ID" value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-10 pr-3 py-2.5 border border-gray-200 rounded-xl outline-none text-sm" />
        </div>
        <select value={tipoFiltro} onChange={e => setTipoFiltro(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm">
          <option value="todos">Empresas e autônomos</option><option value="autonomos">Autônomos</option><option value="vinculados">Empresas</option>
        </select>
        <select value={statusFiltro} onChange={e => setStatusFiltro(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm">
          <option value="todos">Todos os status</option>{Object.entries(statusMap).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
        </select>
        <select value={vencimentoFiltro} onChange={e => setVencimentoFiltro(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm">
          <option value="todos">Todos os vencimentos</option><option value="vencidas">Vencidas</option><option value="proximos7">Próximos 7 dias</option><option value="sem_data">Sem vencimento</option>
        </select>
        <select value={planoFiltro} onChange={e => setPlanoFiltro(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm">
          <option value="todos">Todos os planos</option>{planos.map(plano => <option key={plano} value={plano}>{plano}</option>)}
        </select>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-500">Nenhuma fatura encontrada para os filtros selecionados.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Empresa</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Valor</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Tipo</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Vencimento</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Pagamento</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((f) => {
                  const st = statusMap[f.status] || { label: f.status, color: 'bg-gray-100 text-gray-800' };
                  return (
                    <tr key={f.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-medium text-gray-900">
                        <p>{f.empresas?.nome || '—'}</p>
                        <p className="text-[10px] uppercase text-gray-400">{f.empresas?.tipo === 'autonomo' ? 'Autônomo' : 'Empresa'} · {f.empresas?.status || 'sem status'} · {f.empresas?.planos?.nome || 'sem plano'}</p>
                      </td>
                      <td className="px-4 py-2.5 text-gray-700">R$ {Number(f.valor).toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-gray-500">{f.tipo_pagamento || '—'}</td>
                      <td className="px-4 py-2.5"><span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span></td>
                      <td className="px-4 py-2.5 text-gray-500">{formatCivilDate(f.due_date)}</td>
                      <td className="px-4 py-2.5 text-gray-500">{formatCivilDate(f.pago_em)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1">
                          {f.invoice_url && (
                            <a href={f.invoice_url} target="_blank" rel="noopener noreferrer" title="Abrir link de pagamento" className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-blue-600">
                              <Download size={16} />
                            </a>
                          )}
                          <button onClick={() => conciliar(f.id)} disabled={conciliandoId === f.id} title="Consultar status no Asaas" className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-green-700 disabled:opacity-40">
                            <RefreshCw size={16} className={conciliandoId === f.id ? 'animate-spin' : ''} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal criar cobrança sandbox */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !enviando && setShowModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-bold text-gray-800">Criar cobrança sandbox</h3>
              <button onClick={() => !enviando && setShowModal(false)} className="p-1 text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
                Ambiente Asaas <strong>sandbox</strong> (piloto de homologação): cobrança de teste, <strong>sem valor real</strong>. Este não é o fluxo comercial final.
              </p>
              {!resultado && <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Conta</label>
                  {/* Filtro por tipo */}
                  <div className="flex gap-1 mb-2">
                    {([['todas', 'Todas'], ['vinculados', 'Empresas'], ['autonomos', 'Autônomos']] as const).map(([v, l]) => (
                      <button key={v} type="button" onClick={() => setContaTipo(v)}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${contaTipo === v ? 'bg-green-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{l}</button>
                    ))}
                  </div>
                  {/* Busca por nome */}
                  <div className="relative mb-1">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="text" value={contaBusca} onChange={(e) => setContaBusca(e.target.value)} placeholder="Buscar conta pelo nome…" className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm outline-none" />
                  </div>
                  {/* Lista pesquisável (sem expor IDs internos do Asaas) */}
                  <div className="max-h-44 overflow-y-auto border border-gray-100 rounded-xl divide-y divide-gray-50">
                    {contasFiltradas.length === 0 && <p className="px-3 py-3 text-sm text-gray-400">Nenhuma conta encontrada.</p>}
                    {contasFiltradas.map((e) => {
                      const est = estadoAsaas(e);
                      const sel = form.empresa_id === e.id;
                      return (
                        <button key={e.id} type="button" onClick={() => setForm({ ...form, empresa_id: e.id })}
                          className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 hover:bg-gray-50 ${sel ? 'bg-green-50' : ''}`}>
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-gray-800 truncate">{e.nome}</span>
                            <span className="block text-[11px] text-gray-400">{e.tipo === 'autonomo' ? 'Autônomo' : 'Empresa'}{e.planos?.nome ? ` · ${e.planos.nome}` : ''}</span>
                          </span>
                          <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold ${est.color}`}>{est.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {empresaSelecionada && contaIncompleta && (
                  <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                    <p>Complete o cadastro da conta antes de criar o cliente Asaas sandbox:</p>
                    <ul className="list-disc list-inside mt-1 space-y-0.5">
                      {avaliarConta(empresaSelecionada).faltantes.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                    <p className="mt-1">Edite em <strong>Empresas e Autônomos</strong>.</p>
                  </div>
                )}

                {empresaSelecionada && !contaIncompleta && semCliente && !precisaCliente && (
                  <div className="text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
                    Esta conta ainda não tem cliente Asaas — ele será criado agora, antes da cobrança.
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Valor (R$)</label>
                    <input type="number" min="0" step="0.01" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })}
                      placeholder={empresaSelecionada?.planos?.preco_mensal ? String(empresaSelecionada.planos.preco_mensal) : '0,00'}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Forma</label>
                    <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as any })} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm">
                      <option value="PIX">PIX</option>
                      <option value="BOLETO">Boleto</option>
                      <option value="CARTAO">Cartão</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vencimento <span className="text-gray-400 font-normal">(opcional — padrão +7 dias)</span></label>
                  <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
                </div>

                {erroModal && (
                  <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{erroModal}</div>
                )}

                {mostrarCriarCliente ? (
                  <button onClick={criarClienteEReenviar} disabled={enviando || contaIncompleta} className="w-full inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2.5 rounded-xl disabled:opacity-50">
                    {enviando ? 'Processando…' : 'Criar cliente Asaas sandbox e continuar'}
                  </button>
                ) : (
                  <button onClick={criarCobranca} disabled={enviando || contaIncompleta} className="w-full inline-flex items-center justify-center gap-2 bg-green-700 hover:bg-green-800 text-white font-semibold px-4 py-2.5 rounded-xl disabled:opacity-50">
                    {enviando ? 'Criando…' : 'Criar cobrança sandbox'}
                  </button>
                )}
              </>}

              {resultado && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${(statusMap[resultado.status] || { color: 'bg-gray-100 text-gray-800' }).color}`}>
                      {(statusMap[resultado.status] || { label: resultado.status }).label}
                    </span>
                    <span className="text-sm text-gray-600">{empresaSelecionada?.nome}</span>
                  </div>
                  <div className="text-sm text-gray-700">Valor: <strong>R$ {Number(resultado.valor).toFixed(2)}</strong> · Vencimento: {formatCivilDate(resultado.due_date)}</div>
                  {resultado.invoice_url && (
                    <a href={resultado.invoice_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-blue-700 hover:underline">
                      <ExternalLink size={15} /> Abrir link de pagamento
                    </a>
                  )}
                  {resultado.pix_qr_code && (
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">PIX copia-e-cola</label>
                      <div className="flex items-center gap-2">
                        <input readOnly value={resultado.pix_qr_code} className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-600 bg-gray-50" />
                        <button onClick={() => navigator.clipboard?.writeText(resultado.pix_qr_code)} title="Copiar" className="p-1.5 text-gray-500 hover:text-green-700"><Copy size={15} /></button>
                      </div>
                    </div>
                  )}
                  <button onClick={() => setShowModal(false)} className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold px-4 py-2.5 rounded-xl">Fechar</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
