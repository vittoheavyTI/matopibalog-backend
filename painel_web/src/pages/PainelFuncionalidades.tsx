import React, { useEffect, useState, useCallback } from 'react';
import { Boxes, Check, Grid3x3, History, Users, X, Plus, Pencil, Archive, Search, AlertTriangle, RefreshCw } from 'lucide-react';
import api from '../api';

type Func = {
  id: string; codigo: string; nome: string; descricao_publica?: string; categoria?: string; modulo?: string;
  status_ciclo_vida: string; modelo_cobranca: string; preco_padrao_centavos?: number | null;
  ativo: boolean; visivel_publicamente: boolean; ordem_exibicao: number;
};
type Plano = { id: string; nome: string; matriz_funcionalidades_versao?: number };
type MatrizItem = { plano_id: string; funcionalidade_id: string; disponibilidade: string; exibir_no_card: boolean; texto_publico?: string | null; ordem_exibicao?: number };

const CICLOS = ['disponivel', 'em_breve', 'em_desenvolvimento', 'planejada', 'descontinuada'];
const COBRANCAS = ['incluso', 'adicional', 'sob_negociacao'];
const DISPONIBILIDADES = ['incluida', 'opcional_paga', 'indisponivel', 'em_breve', 'sob_negociacao'];

const cicloBadge: Record<string, string> = {
  disponivel: 'bg-green-50 text-green-700', em_breve: 'bg-amber-50 text-amber-700',
  em_desenvolvimento: 'bg-blue-50 text-blue-700', planejada: 'bg-gray-100 text-gray-500', descontinuada: 'bg-red-50 text-red-700',
};

const ABAS = [
  { id: 'catalogo', label: 'Catálogo', icon: Boxes },
  { id: 'matriz', label: 'Matriz por plano', icon: Grid3x3 },
  { id: 'clientes', label: 'Clientes', icon: Users },
  { id: 'auditoria', label: 'Auditoria', icon: History },
] as const;

export const PainelFuncionalidades: React.FC = () => {
  const [aba, setAba] = useState<'catalogo' | 'matriz' | 'clientes' | 'auditoria'>('catalogo');
  const [toast, setToast] = useState<{ msg: string; tipo: 'ok' | 'erro' } | null>(null);
  const notificar = (msg: string, tipo: 'ok' | 'erro') => { setToast({ msg, tipo }); setTimeout(() => setToast(null), 3500); };

  return (
    <div className="space-y-4 animate-fade-in">
      {toast && (
        <div className={`fixed top-6 right-6 z-[100] px-5 py-3 rounded-xl shadow-2xl text-sm font-bold text-white ${toast.tipo === 'ok' ? 'bg-green-600' : 'bg-red-600'}`} role="status">{toast.msg}</div>
      )}
      <div className="flex items-center gap-2.5">
        <div className="bg-gray-800 p-1.5 rounded-lg text-white"><Boxes size={18} /></div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800 leading-tight">Funcionalidades e Add-ons</h1>
          <p className="text-sm text-gray-500">Catálogo, matriz por plano e direitos por cliente</p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {ABAS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setAba(id)} className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px ${aba === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <Icon size={16} />{label}
          </button>
        ))}
      </div>

      {aba === 'catalogo' && <AbaCatalogo notificar={notificar} />}
      {aba === 'matriz' && <AbaMatriz notificar={notificar} />}
      {aba === 'clientes' && <AbaClientes />}
      {aba === 'auditoria' && <AbaAuditoria />}
    </div>
  );
};

// ── Catálogo ─────────────────────────────────────────────────────────────────
const FORM_VAZIO = { codigo: '', nome: '', descricao_publica: '', categoria: '', modulo: '', status_ciclo_vida: 'disponivel', modelo_cobranca: 'incluso', preco_padrao_centavos: '', ativo: true, visivel_publicamente: false, ordem_exibicao: '0' };

const AbaCatalogo: React.FC<{ notificar: (m: string, t: 'ok' | 'erro') => void }> = ({ notificar }) => {
  const [lista, setLista] = useState<Func[]>([]);
  const [busca, setBusca] = useState('');
  const [filtroCiclo, setFiltroCiclo] = useState('');
  const [modal, setModal] = useState(false);
  const [editando, setEditando] = useState<Func | null>(null);
  const [form, setForm] = useState<any>(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const params: any = {};
    if (busca) params.busca = busca;
    if (filtroCiclo) params.status_ciclo_vida = filtroCiclo;
    const { data } = await api.get('/painel-admin/funcionalidades', { params });
    setLista(data.funcionalidades || []);
  }, [busca, filtroCiclo]);
  useEffect(() => { carregar(); }, [carregar]);

  function abrirNovo() { setEditando(null); setForm({ ...FORM_VAZIO }); setModal(true); }
  function abrirEdicao(f: Func) {
    setEditando(f);
    setForm({ ...FORM_VAZIO, ...f, preco_padrao_centavos: f.preco_padrao_centavos != null ? String(f.preco_padrao_centavos) : '', ordem_exibicao: String(f.ordem_exibicao ?? 0) });
    setModal(true);
  }
  async function salvar() {
    setSalvando(true);
    try {
      const payload: any = { ...form, preco_padrao_centavos: form.preco_padrao_centavos === '' ? null : Number(form.preco_padrao_centavos), ordem_exibicao: Number(form.ordem_exibicao) || 0 };
      if (editando) await api.put(`/painel-admin/funcionalidades/${editando.id}`, payload);
      else await api.post('/painel-admin/funcionalidades', payload);
      notificar('Funcionalidade salva!', 'ok'); setModal(false); carregar();
    } catch (e: any) {
      notificar(e?.response?.data?.erros?.join('; ') || e?.response?.data?.message || 'Erro ao salvar', 'erro');
    } finally { setSalvando(false); }
  }
  async function arquivar(f: Func) {
    try { await api.post(`/painel-admin/funcionalidades/${f.id}/arquivar`, { arquivar: f.ativo }); notificar(f.ativo ? 'Arquivada' : 'Reativada', 'ok'); carregar(); }
    catch { notificar('Erro ao arquivar', 'erro'); }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome ou código" className="w-full pl-9 pr-3 py-2 border-2 border-gray-100 rounded-xl bg-gray-50/50 text-sm outline-none focus:border-blue-500" />
        </div>
        <select value={filtroCiclo} onChange={(e) => setFiltroCiclo(e.target.value)} className="py-2 px-3 border-2 border-gray-100 rounded-xl bg-gray-50/50 text-sm">
          <option value="">Todos os estados</option>
          {CICLOS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={abrirNovo} className="flex items-center px-4 py-2 bg-green-700 text-white rounded-xl font-medium text-sm hover:bg-green-800"><Plus size={16} className="mr-1" />Nova funcionalidade</button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-gray-100">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr><th className="text-left p-3">Nome</th><th className="text-left p-3">Código</th><th className="text-left p-3">Estado</th><th className="text-left p-3">Cobrança</th><th className="text-left p-3">Visível</th><th className="p-3"></th></tr>
          </thead>
          <tbody>
            {lista.map((f) => (
              <tr key={f.id} className={`border-t border-gray-100 ${!f.ativo ? 'opacity-50' : ''}`}>
                <td className="p-3 font-semibold text-gray-800">{f.nome}</td>
                <td className="p-3 font-mono text-xs text-gray-500">{f.codigo}</td>
                <td className="p-3"><span className={`px-2 py-0.5 rounded text-xs font-bold ${cicloBadge[f.status_ciclo_vida] || ''}`}>{f.status_ciclo_vida}</span></td>
                <td className="p-3 text-gray-600">{f.modelo_cobranca}</td>
                <td className="p-3">{f.visivel_publicamente ? <Check size={16} className="text-green-600" /> : <span className="text-gray-300">—</span>}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  <button onClick={() => abrirEdicao(f)} className="text-blue-600 hover:bg-blue-50 p-1.5 rounded-lg" title="Editar"><Pencil size={15} /></button>
                  <button onClick={() => arquivar(f)} className="text-gray-500 hover:bg-gray-100 p-1.5 rounded-lg" title={f.ativo ? 'Arquivar' : 'Reativar'}><Archive size={15} /></button>
                </td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-gray-400">Nenhuma funcionalidade</td></tr>}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b flex justify-between items-center sticky top-0 bg-gray-50">
              <h3 className="text-lg font-bold text-gray-800">{editando ? 'Editar' : 'Nova'} funcionalidade</h3>
              <button onClick={() => setModal(false)} className="p-2 hover:bg-gray-200 rounded-full"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-3">
              <Campo label="Nome"><input className={inp} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></Campo>
              <Campo label={`Código${editando ? ' (imutável se usada)' : ''}`}><input className={`${inp} font-mono`} value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} placeholder="ex: erp_api" /></Campo>
              <Campo label="Descrição pública"><input className={inp} value={form.descricao_publica} onChange={(e) => setForm({ ...form, descricao_publica: e.target.value })} /></Campo>
              <div className="grid grid-cols-2 gap-3">
                <Campo label="Categoria"><input className={inp} value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} /></Campo>
                <Campo label="Módulo"><input className={inp} value={form.modulo} onChange={(e) => setForm({ ...form, modulo: e.target.value })} /></Campo>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Campo label="Estado técnico"><select className={inp} value={form.status_ciclo_vida} onChange={(e) => setForm({ ...form, status_ciclo_vida: e.target.value })}>{CICLOS.map((c) => <option key={c}>{c}</option>)}</select></Campo>
                <Campo label="Modelo de cobrança"><select className={inp} value={form.modelo_cobranca} onChange={(e) => setForm({ ...form, modelo_cobranca: e.target.value })}>{COBRANCAS.map((c) => <option key={c}>{c}</option>)}</select></Campo>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Campo label="Preço padrão (centavos)"><input type="number" min="0" className={inp} value={form.preco_padrao_centavos} onChange={(e) => setForm({ ...form, preco_padrao_centavos: e.target.value })} /></Campo>
                <Campo label="Ordem"><input type="number" className={inp} value={form.ordem_exibicao} onChange={(e) => setForm({ ...form, ordem_exibicao: e.target.value })} /></Campo>
              </div>
              <label className="flex items-center justify-between rounded-xl border p-3"><span className="text-sm font-semibold">Ativo</span><input type="checkbox" className="w-5 h-5" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} /></label>
              <label className="flex items-center justify-between rounded-xl border p-3"><span className="text-sm font-semibold">Visível publicamente</span><input type="checkbox" className="w-5 h-5" checked={form.visivel_publicamente} onChange={(e) => setForm({ ...form, visivel_publicamente: e.target.checked })} /></label>
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end gap-3 sticky bottom-0">
              <button onClick={() => setModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg text-sm">Cancelar</button>
              <button onClick={salvar} disabled={salvando} className="px-5 py-2 bg-green-700 text-white rounded-lg text-sm font-medium disabled:opacity-40"><Check size={15} className="inline mr-1" />Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Matriz por plano ─────────────────────────────────────────────────────────
type Conflito = { plano_id?: string | null; plano_nome?: string; versao_esperada?: number | null; versao_atual?: number | null };
const AbaMatriz: React.FC<{ notificar: (m: string, t: 'ok' | 'erro') => void }> = ({ notificar }) => {
  const [funcs, setFuncs] = useState<Func[]>([]);
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [matriz, setMatriz] = useState<Record<string, string>>({}); // `${plano}:${func}` -> disponibilidade
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [conflito, setConflito] = useState<Conflito | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [f, p, m] = await Promise.all([
        api.get('/painel-admin/funcionalidades', { params: { ativo: 'true' } }),
        api.get('/painel-admin/planos'),
        api.get('/painel-admin/funcionalidades-matriz'),
      ]);
      setFuncs(f.data.funcionalidades || []);
      setPlanos((p.data.planos || p.data || []).map((x: any) => ({ id: x.id, nome: x.nome, matriz_funcionalidades_versao: x.matriz_funcionalidades_versao })));
      const mm: Record<string, string> = {};
      for (const it of (m.data.matriz || []) as MatrizItem[]) mm[`${it.plano_id}:${it.funcionalidade_id}`] = it.disponibilidade;
      setMatriz(mm);
      setConflito(null); setSujo(false);
    } catch { notificar('Erro ao carregar matriz', 'erro'); } finally { setCarregando(false); }
  }, [notificar]);

  useEffect(() => { carregar(); }, [carregar]);

  function setCelula(planoId: string, funcId: string, val: string) {
    setMatriz((m) => ({ ...m, [`${planoId}:${funcId}`]: val })); setSujo(true);
    if (conflito) setConflito(null); // usuário editou após conflito; libera nova tentativa (após recarregar)
  }
  async function salvar() {
    setSalvando(true);
    try {
      const itens = Object.entries(matriz).map(([k, disponibilidade]) => { const [plano_id, funcionalidade_id] = k.split(':'); return { plano_id, funcionalidade_id, disponibilidade, exibir_no_card: true }; });
      // versão esperada por plano (concorrência otimista): backend exige de todos.
      const versoes_esperadas: Record<string, number> = {};
      for (const p of planos) versoes_esperadas[p.id] = p.matriz_funcionalidades_versao ?? 1;
      await api.put('/painel-admin/funcionalidades-matriz', { itens, versoes_esperadas });
      notificar('Matriz publicada!', 'ok');
      await carregar(); // traz as versões novas; nada de merge silencioso
    } catch (e: any) {
      if (e?.response?.status === 409) {
        const d = e.response.data || {};
        const plano_nome = planos.find((p) => p.id === d.plano_id)?.nome;
        setConflito({ plano_id: d.plano_id, plano_nome, versao_esperada: d.versao_esperada, versao_atual: d.versao_atual });
      } else { notificar('Erro ao salvar matriz', 'erro'); }
    } finally { setSalvando(false); }
  }

  const bloqueado = salvando || !!conflito; // 409 impede novo envio com versão obsoleta até recarregar
  return (
    <div className="space-y-3">
      {conflito && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold">A matriz foi alterada por outro administrador{conflito.plano_nome ? ` (plano ${conflito.plano_nome})` : ''}.</p>
              <p className="text-xs mt-0.5">Versão esperada <strong>{conflito.versao_esperada ?? '—'}</strong> · versão atual <strong>{conflito.versao_atual ?? '—'}</strong>. Suas alterações locais foram <strong>preservadas</strong> — nada foi sobrescrito. Recarregar traz a versão atual (descarta o rascunho).</p>
              <button onClick={carregar} className="mt-2 inline-flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold"><RefreshCw size={13} />Recarregar matriz atual</button>
            </div>
          </div>
        </div>
      )}
      {sujo && !conflito && <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 flex items-center justify-between"><span>Há alterações não salvas na matriz.</span><button onClick={salvar} disabled={bloqueado} className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-bold disabled:opacity-40">Publicar nova versão</button></div>}
      <div className="overflow-x-auto rounded-2xl border border-gray-100">
        <table className="text-xs">
          <thead className="bg-gray-50 text-gray-500 uppercase"><tr><th className="text-left p-2 sticky left-0 bg-gray-50 min-w-40 z-10">Funcionalidade</th>{planos.map((p) => <th key={p.id} className="p-2 whitespace-nowrap">{p.nome}<span className="block normal-case font-normal text-[10px] text-gray-400">v{p.matriz_funcionalidades_versao ?? 1}</span></th>)}</tr></thead>
          <tbody>
            {funcs.map((f) => (
              <tr key={f.id} className="border-t border-gray-100">
                <td className="p-2 sticky left-0 bg-white font-semibold text-gray-700 z-10" title={f.nome}>{f.nome}<span className="block font-mono text-[10px] text-gray-400">{f.codigo}</span></td>
                {planos.map((p) => (
                  <td key={p.id} className="p-1">
                    <select value={matriz[`${p.id}:${f.id}`] || 'indisponivel'} onChange={(e) => setCelula(p.id, f.id, e.target.value)} className="border border-gray-200 rounded-lg p-1 text-xs bg-white">
                      {DISPONIBILIDADES.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </td>
                ))}
              </tr>
            ))}
            {!carregando && funcs.length === 0 && <tr><td colSpan={planos.length + 1} className="p-8 text-center text-gray-400">Nenhuma funcionalidade ativa</td></tr>}
          </tbody>
        </table>
      </div>
      <button onClick={salvar} disabled={!sujo || bloqueado} className="px-5 py-2 bg-green-700 text-white rounded-lg text-sm font-medium disabled:opacity-40"><Check size={15} className="inline mr-1" />Publicar matriz</button>
    </div>
  );
};

// ── Clientes (busca + leitura) ───────────────────────────────────────────────
type EmpresaBusca = { id: string; nome: string; documento?: string | null; email?: string | null; status?: string | null; arquivada?: boolean; plano_nome?: string | null };
const AbaClientes: React.FC = () => {
  const [termo, setTermo] = useState('');
  const [resultados, setResultados] = useState<EmpresaBusca[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [buscando, setBuscando] = useState(false);
  const [erroBusca, setErroBusca] = useState('');
  const [sel, setSel] = useState<EmpresaBusca | null>(null);
  const [dados, setDados] = useState<any>(null);
  const [erro, setErro] = useState('');
  const LIMITE = 10;

  // Busca com debounce (350ms); termo mínimo 2 → não consulta e limpa resultados.
  useEffect(() => {
    const t = termo.trim();
    if (t.length < 2) { setResultados([]); setTotal(0); setErroBusca(''); return; }
    let vivo = true;
    const timer = setTimeout(async () => {
      setBuscando(true); setErroBusca('');
      try {
        const { data } = await api.get('/painel-admin/empresas/buscar', { params: { q: t, page, limite: LIMITE } });
        if (!vivo) return;
        setResultados(data.empresas || []); setTotal(data.total || 0);
      } catch { if (vivo) setErroBusca('Erro na busca de clientes.'); }
      finally { if (vivo) setBuscando(false); }
    }, 350);
    return () => { vivo = false; clearTimeout(timer); };
  }, [termo, page]);

  useEffect(() => { setPage(1); }, [termo]);

  async function selecionar(e: EmpresaBusca) {
    setSel(e); setErro(''); setDados(null);
    try { const { data } = await api.get(`/painel-admin/empresas/${e.id}/entitlements`); setDados(data); }
    catch (err: any) { setErro(err?.response?.data?.message || 'Erro ao consultar direitos'); }
  }

  const totalPaginas = Math.max(1, Math.ceil(total / LIMITE));
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Buscar por nome, CNPJ ou e-mail…" className={`${inp} pl-9`} aria-label="Buscar cliente" />
      </div>
      <p className="text-xs text-gray-400">Digite ao menos 2 caracteres. Ações de concessão/adicional chegam no PR 3A (esta aba é somente leitura).</p>
      {erroBusca && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{erroBusca}</div>}
      {termo.trim().length >= 2 && (
        <div className="rounded-2xl border border-gray-100 divide-y divide-gray-100">
          {buscando && <div className="p-3 text-sm text-gray-400">Buscando…</div>}
          {!buscando && resultados.length === 0 && <div className="p-4 text-sm text-gray-400">Nenhuma empresa encontrada.</div>}
          {resultados.map((e) => (
            <button key={e.id} onClick={() => selecionar(e)} className={`w-full text-left p-3 hover:bg-gray-50 flex items-center justify-between ${sel?.id === e.id ? 'bg-blue-50' : ''}`}>
              <span>
                <span className="font-semibold text-gray-800">{e.nome}</span>
                {e.arquivada && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 uppercase">arquivada</span>}
                <span className="block text-xs text-gray-400">{e.documento || 's/ documento'} · {e.email || 's/ e-mail'}</span>
              </span>
              <span className="text-xs text-gray-500 text-right shrink-0">{e.plano_nome || '—'}<span className="block text-gray-400">{e.status || ''}</span></span>
            </button>
          ))}
          {total > LIMITE && (
            <div className="p-2 flex items-center justify-between text-xs text-gray-500">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-2 py-1 rounded disabled:opacity-30">‹ Anterior</button>
              <span>Página {page} de {totalPaginas} · {total} resultado(s)</span>
              <button onClick={() => setPage((p) => Math.min(totalPaginas, p + 1))} disabled={page >= totalPaginas} className="px-2 py-1 rounded disabled:opacity-30">Próxima ›</button>
            </div>
          )}
        </div>
      )}
      {erro && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>}
      {dados && (
        <div className="space-y-3">
          <div className="rounded-xl border border-gray-100 p-3 text-sm"><strong>{dados.empresa?.nome}</strong> <span className="text-gray-400">({dados.empresa?.commercial_flow_version || 'legado'})</span></div>
          <div>
            <h4 className="text-xs font-bold uppercase text-gray-500 mb-1">Incluídas pelo plano</h4>
            <ul className="text-sm space-y-1">{(dados.plano_funcionalidades || []).map((pf: any) => <li key={pf.id} className="flex items-center gap-2"><Check size={14} className="text-green-500" />{pf.funcionalidades?.nome} <span className="text-gray-400">— {pf.disponibilidade}</span></li>)}{(dados.plano_funcionalidades || []).length === 0 && <li className="text-gray-400">—</li>}</ul>
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase text-gray-500 mb-1">Concessões (overrides)</h4>
            <ul className="text-sm space-y-1">{(dados.overrides || []).map((o: any) => <li key={o.id}>{o.funcionalidades?.nome} — {o.origem} / {o.status}</li>)}{(dados.overrides || []).length === 0 && <li className="text-gray-400">Nenhuma</li>}</ul>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Auditoria ────────────────────────────────────────────────────────────────
const AbaAuditoria: React.FC = () => {
  const [itens, setItens] = useState<any[]>([]);
  useEffect(() => { api.get('/painel-admin/funcionalidades-auditoria').then((r) => setItens(r.data.auditoria || [])).catch(() => {}); }, []);
  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-100">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-xs uppercase"><tr><th className="text-left p-3">Quando</th><th className="text-left p-3">Entidade</th><th className="text-left p-3">Ação</th><th className="text-left p-3">Detalhe</th></tr></thead>
        <tbody>
          {itens.map((a) => (
            <tr key={a.id} className="border-t border-gray-100">
              <td className="p-3 text-gray-500 whitespace-nowrap">{new Date(a.criado_em).toLocaleString('pt-BR')}</td>
              <td className="p-3">{a.entidade}</td>
              <td className="p-3 font-semibold">{a.acao}</td>
              <td className="p-3 text-xs text-gray-500 font-mono truncate max-w-xs">{JSON.stringify(a.detalhe)}</td>
            </tr>
          ))}
          {itens.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-gray-400">Sem eventos ainda</td></tr>}
        </tbody>
      </table>
    </div>
  );
};

const inp = 'w-full border-2 border-gray-100 rounded-xl p-2.5 outline-none focus:border-blue-500 bg-gray-50/50 text-sm';
const Campo: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">{label}</label>{children}</div>
);
