import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Search, Plus, X, Check, AlertTriangle, Eye, Ban, Unlock, Trash2, KeyRound, CalendarClock, UserPlus } from 'lucide-react';
import api from '../api';

// Formata ISO → DD/MM/AAAA (pt-BR). Retorna '-' se inválido.
function formatData(iso?: string) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('pt-BR');
}

// Trial vencido = data no passado.
function trialVencido(iso?: string) {
  if (!iso) return false;
  const d = new Date(iso);
  return !isNaN(d.getTime()) && d < new Date();
}

export const PainelEmpresas: React.FC = () => {
  const navigate = useNavigate();
  const [empresas, setEmpresas] = useState<any[]>([]);
  const [planos, setPlanos] = useState<any[]>([]);
  // Contagem de administradores por conta, derivada de UMA chamada a /admin/usuarios
  // (agrupada em memória). null = ainda não carregada / falhou → NÃO classificar como
  // "Sem administrador" (mostra skeleton ou aviso neutro).
  const [adminCounts, setAdminCounts] = useState<Record<string, number> | null>(null);
  const [adminCountsLoading, setAdminCountsLoading] = useState(true);
  const [adminCountsErro, setAdminCountsErro] = useState(false);
  // Modal de sucesso pós-criação (conta recém-criada, ainda sem administrador).
  const [successConta, setSuccessConta] = useState<{ id: string; nome: string } | null>(null);
  const [planosLoading, setPlanosLoading] = useState(false);
  const [planosErro, setPlanosErro] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState('todos');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [formDados, setFormDados] = useState({ nome: '', cnpj: '', email: '', telefone: '', plano_id: '', tipo: 'transportadora' });
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [trialTarget, setTrialTarget] = useState<any>(null);
  const [customDate, setCustomDate] = useState('');
  const [confirmAtivo, setConfirmAtivo] = useState(false);
  const [toast, setToast] = useState<{ message: string; tipo: 'sucesso' | 'erro' } | null>(null);

  useEffect(() => { carregar(); carregarPlanos(); carregarAdmins(); }, []);

  // Auto-dismiss do toast: some sozinho após 3,5s. Cada novo toast reinicia o
  // timer (o cleanup limpa o anterior) e o unmount também limpa — evita a
  // notificação ficar fixa indefinidamente. Fechar manual: botão X no toast.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  async function carregar() {
    const response = await api.get('/painel-admin/empresas');
    setEmpresas(response.data || []);
  }

  // Uma única consulta de usuários (super-admin recebe todos, com empresa_id + tipo).
  // Conta apenas tipo === 'admin' por empresa_id, em memória → sem N+1, sem backend.
  // Falha → adminCounts=null + erro=true (a UI mostra aviso neutro, nunca "Sem administrador").
  async function carregarAdmins() {
    setAdminCountsLoading(true);
    setAdminCountsErro(false);
    try {
      const response = await api.get('/admin/usuarios');
      const counts: Record<string, number> = {};
      (response.data || []).forEach((u: any) => {
        if (u.tipo === 'admin' && u.empresa_id) {
          counts[u.empresa_id] = (counts[u.empresa_id] || 0) + 1;
        }
      });
      setAdminCounts(counts);
    } catch {
      setAdminCounts(null);
      setAdminCountsErro(true);
    } finally {
      setAdminCountsLoading(false);
    }
  }

  // Carrega o catálogo de planos para o <select> do formulário (mesmo endpoint de PainelPlanos).
  async function carregarPlanos() {
    setPlanosLoading(true);
    setPlanosErro(false);
    try {
      const response = await api.get('/painel-admin/planos');
      setPlanos(response.data || []);
    } catch {
      setPlanosErro(true);
    } finally {
      setPlanosLoading(false);
    }
  }

  async function handleSalvar() {
    if (!formDados.nome.trim()) { setToast({ message: 'Nome é obrigatório', tipo: 'erro' }); return; }
    const emailTrim = formDados.email.trim();
    if (emailTrim && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) { setToast({ message: 'E-mail inválido', tipo: 'erro' }); return; }
    const payload = { nome: formDados.nome, cnpj: formDados.cnpj, email: formDados.email, telefone: formDados.telefone, plano_id: formDados.plano_id || null };
    if (editing) {
      try { await api.put('/painel-admin/empresas/' + editing.id, payload); }
      catch (err: any) { setToast({ message: err?.response?.data?.message || 'Não foi possível salvar a conta.', tipo: 'erro' }); return; }
      setToast({ message: 'Empresa atualizada!', tipo: 'sucesso' });
      setShowModal(false); setEditing(null); carregar();
    } else {
      let novaEmpresa: any = null;
      try {
        const resp = await api.post('/painel-admin/empresas', { ...payload, tipo: formDados.tipo, status: 'trial' });
        novaEmpresa = resp.data;
      }
      catch (err: any) { setToast({ message: err?.response?.data?.message || 'Não foi possível salvar a conta.', tipo: 'erro' }); return; }
      setShowModal(false);
      carregar();
      carregarAdmins();
      // Conta nasce sem administrador → oferece criar o primeiro admin agora ou depois.
      // Fallback (sem id no retorno): mantém o toast de criação simples.
      if (novaEmpresa?.id) {
        setSuccessConta({ id: novaEmpresa.id, nome: novaEmpresa.nome || formDados.nome });
      } else {
        setToast({ message: 'Empresa criada!', tipo: 'sucesso' });
      }
    }
  }

  async function suspender(id: string) {
    const e = empresas.find(emp => emp.id === id);
    if (!e) return;
    try { await api.put('/painel-admin/empresas/' + id, { status: e.status === 'suspenso' ? 'ativo' : 'suspenso' }); } catch { setToast({ message: 'Erro ao alterar status', tipo: 'erro' }); return; }
    setToast({ message: 'Status alterado!', tipo: 'sucesso' });
    carregar();
  }

  async function resetSenhaAdmin(empresaId: string, nomeEmpresa: string) {
    const nova = prompt(`Nova senha para o admin de "${nomeEmpresa}" (mín. 6 caracteres):`);
    if (!nova || nova.length < 6) return;
    try {
      // Busca o admin da empresa e reseta a senha
      const resp = await api.get(`/admin/usuarios?empresa_id=${empresaId}`);
      const admins = (resp.data || []).filter((u: any) => u.tipo === 'admin');
      if (admins.length === 0) { alert('Nenhum admin encontrado para esta empresa.'); return; }
      // Reseta a senha do primeiro admin
      await api.post(`/admin/usuarios/${admins[0].id}/reset-senha`, { nova_senha: nova });
      setToast({ message: `Senha do admin de "${nomeEmpresa}" resetada!`, tipo: 'sucesso' });
    } catch {
      setToast({ message: 'Erro ao resetar senha.', tipo: 'erro' });
    }
  }

  async function excluir() {
    if (!deleteTarget) return;
    try { await api.delete('/painel-admin/empresas/' + deleteTarget.id); } catch { setToast({ message: 'Erro ao excluir', tipo: 'erro' }); return; }
    setToast({ message: 'Empresa excluída!', tipo: 'sucesso' });
    setDeleteTarget(null); carregar(); carregarAdmins();
  }

  // Prorroga/libera trial via endpoint dedicado. body = { dias: 7|15 } ou { trial_ends_at: 'YYYY-MM-DD' }.
  async function aplicarTrial(body: { dias?: number; trial_ends_at?: string }) {
    if (!trialTarget) return;
    try {
      const resp = await api.patch('/painel-admin/empresas/' + trialTarget.id + '/trial', body);
      setToast({ message: 'Trial atualizado até ' + formatData(resp.data?.trial_ends_at) + '!', tipo: 'sucesso' });
      setTrialTarget(null); setCustomDate(''); setConfirmAtivo(false); carregar();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Erro ao atualizar trial';
      setToast({ message: msg, tipo: 'erro' });
    }
  }

  const filtered = empresas.filter(e => {
    const porBusca = (e.nome || '').toLowerCase().includes(searchTerm.toLowerCase()) || (e.cnpj || '').includes(searchTerm);
    // 'autonomos' → só tipo autonomo; 'empresas' → todo o resto (transportadora, fazenda etc).
    const porTipo = tipoFiltro === 'todos' || (tipoFiltro === 'autonomos' ? e.tipo === 'autonomo' : e.tipo !== 'autonomo');
    return porBusca && porTipo;
  });

  // Opções do <select> de plano: apenas planos ativos. Ao editar, se o plano
  // atual estiver inativo (ou sumido do catálogo), injeta a opção corrente
  // marcada como "(inativo)" para aparecer selecionada e não zerar ao salvar.
  const planosAtivos = planos.filter((p: any) => p.ativo !== false);
  let opcoesPlano: any[] = planosAtivos;
  const planoAtualId = formDados.plano_id;
  if (planoAtualId && !planosAtivos.some((p: any) => p.id === planoAtualId)) {
    const doCatalogo = planos.find((p: any) => p.id === planoAtualId);
    const atual = doCatalogo
      ? { ...doCatalogo, ativo: false }
      : { id: planoAtualId, nome: editing?.planos?.nome || 'Plano atual', preco_mensal: editing?.planos?.preco_mensal || 0, ativo: false };
    opcoesPlano = [atual, ...planosAtivos];
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {toast && (
        <div className={`fixed top-6 right-6 z-[100] flex items-center space-x-2 px-5 py-3 rounded-xl shadow-2xl text-sm font-bold ${toast.tipo === 'sucesso' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.tipo === 'sucesso' ? <Check size={18} /> : <AlertTriangle size={18} />}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} title="Fechar" aria-label="Fechar notificação" className="ml-1 p-0.5 rounded-full hover:bg-white/20"><X size={16} /></button>
        </div>
      )}

      <div className="flex items-center space-x-3 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="bg-gray-800 p-2 rounded-lg text-white"><Shield size={24} /></div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Empresas e Autônomos</h1>
          <p className="text-sm text-gray-500">Contas da plataforma. Pessoas com acesso são geridas separadamente em Usuários.</p>
        </div>
      </div>

      <div className="flex flex-wrap justify-between items-center gap-4">
        <div className="flex items-center gap-2 flex-1 flex-wrap">
          <div className="bg-white p-2.5 rounded-xl shadow-sm border border-gray-100 flex items-center flex-1 min-w-[180px] max-w-md">
            <Search size={18} className="text-gray-400 mr-2 flex-shrink-0" />
            <input type="text" placeholder="Buscar por nome ou CNPJ..." className="flex-1 outline-none text-gray-700 text-sm" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
          <select value={tipoFiltro} onChange={e => setTipoFiltro(e.target.value)} className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 shadow-sm">
            <option value="todos">Todos os tipos</option>
            <option value="empresas">Empresas</option>
            <option value="autonomos">Autônomos</option>
          </select>
        </div>
        <button onClick={() => { setEditing(null); setFormDados({ nome: '', cnpj: '', email: '', telefone: '', plano_id: '', tipo: 'transportadora' }); setShowModal(true); }} className="flex items-center px-4 py-2.5 bg-green-700 text-white rounded-xl font-medium text-sm hover:bg-green-800 active:scale-95"><Plus size={18} className="mr-1.5" /> Nova Conta</button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-gray-50 text-gray-600 text-xs font-bold uppercase tracking-wider">
              <th className="px-4 py-2.5 border-b">Conta</th><th className="px-4 py-2.5 border-b">CNPJ</th><th className="px-4 py-2.5 border-b">Plano</th><th className="px-4 py-2.5 border-b">Status</th><th className="px-4 py-2.5 border-b text-center">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map(e => (
              <tr key={e.id} className="hover:bg-gray-50/50">
                <td className="px-4 py-2.5">
                  <p className="font-bold text-gray-800">{e.nome}</p>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400">{e.tipo === 'autonomo' ? 'Autônomo' : 'Empresa'}</p>
                  <div className="mt-1">
                    {adminCountsErro ? (
                      // Consulta falhou → aviso neutro; NUNCA marcar como "Sem administrador".
                      <span className="text-[10px] font-semibold text-gray-300">Administradores indisponível</span>
                    ) : (adminCountsLoading || adminCounts === null) ? (
                      // Skeleton enquanto a contagem não termina.
                      <span className="inline-block h-3 w-24 rounded bg-gray-100 animate-pulse align-middle" />
                    ) : ((adminCounts[e.id] || 0) === 0) ? (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-red-500">Sem administrador</span>
                    ) : (
                      <span className="text-[10px] font-semibold text-gray-500">
                        {adminCounts[e.id]} {adminCounts[e.id] === 1 ? 'administrador' : 'administradores'}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-sm text-gray-600">{e.cnpj || '—'}</td>
                <td className="px-4 py-2.5"><span className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-blue-50 text-blue-700">{e.planos?.nome || e.plano_id || '-'}</span></td>
                <td className="px-4 py-2.5">
                  <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest ${e.status === 'ativo' ? 'bg-green-50 text-green-700' : e.status === 'trial' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>{e.status}</span>
                  <div className="mt-1 text-[10px] font-semibold">
                    {e.trial_ends_at
                      ? (trialVencido(e.trial_ends_at)
                          ? <span className="text-red-500">Trial vencido</span>
                          : <span className="text-amber-600">Trial até {formatData(e.trial_ends_at)}</span>)
                      : <span className="text-gray-300">Sem trial definido</span>}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={() => { setEditing(e); setFormDados({ nome: e.nome || '', cnpj: e.cnpj || '', email: e.email_contato || '', telefone: e.telefone_contato || '', plano_id: e.plano_id || '', tipo: e.tipo || 'transportadora' }); setShowModal(true); }} title="Editar empresa" aria-label="Editar empresa" className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"><Eye size={16} /></button>
                    <button onClick={() => suspender(e.id)} title={e.status === 'suspenso' ? 'Reativar empresa' : 'Suspender empresa'} aria-label={e.status === 'suspenso' ? 'Reativar empresa' : 'Suspender empresa'} className="p-1.5 text-orange-500 hover:bg-orange-50 rounded-lg">{e.status === 'suspenso' ? <Unlock size={16} /> : <Ban size={16} />}</button>
                    <button onClick={() => { setTrialTarget(e); setCustomDate(''); setConfirmAtivo(false); }} title="Gerenciar trial" aria-label="Gerenciar trial da empresa" className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg"><CalendarClock size={16} /></button>
                    <button onClick={() => resetSenhaAdmin(e.id, e.nome)} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg" title="Resetar senha do admin" aria-label="Resetar senha do admin"><KeyRound size={16} /></button>
                    <button onClick={() => setDeleteTarget(e)} title="Excluir empresa" aria-label="Excluir empresa" className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-gray-400">Nenhuma empresa</td></tr>}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b flex justify-between items-center bg-gray-50 flex-shrink-0">
              <h3 className="text-xl font-bold text-gray-800">{editing ? 'Editar Conta' : 'Nova Conta'}</h3>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-200 rounded-full"><X size={24} /></button>
            </div>
            <div className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-4">
              {[{ label: 'Nome da conta', key: 'nome' }, { label: 'CNPJ', key: 'cnpj' }, { label: 'E-mail de contato da conta', key: 'email' }, { label: 'Telefone de contato da conta', key: 'telefone' }].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">{f.label}</label>
                  <input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={(formDados as any)[f.key] || ''} onChange={e => setFormDados({ ...formDados, [f.key]: e.target.value })} />
                </div>
              ))}
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Tipo de conta</label>
                <select disabled={!!editing} className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50 disabled:text-gray-400" value={formDados.tipo} onChange={e => setFormDados({ ...formDados, tipo: e.target.value })}>
                  <option value="transportadora">Empresa / Transportadora</option>
                  <option value="autonomo">Autônomo</option>
                </select>
                {!editing && formDados.tipo === 'autonomo' && <p className="text-xs text-emerald-700 mt-1">Depois de criar a conta, adicione a pessoa responsável em Usuários.</p>}
                {editing && <p className="text-xs text-gray-400 mt-1">O tipo da conta não pode ser alterado após a criação neste momento.</p>}
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Plano</label>
                {planosLoading ? (
                  <div className="w-full border-2 border-gray-50 rounded-xl p-3 bg-gray-50/50 text-sm text-gray-400">Carregando planos…</div>
                ) : planosErro ? (
                  <div className="w-full border-2 border-red-100 rounded-xl p-3 bg-red-50/50 text-sm text-red-600">
                    Não foi possível carregar os planos.{' '}
                    <button type="button" onClick={carregarPlanos} className="underline font-semibold">Tentar novamente</button>
                  </div>
                ) : (
                  <>
                    <select className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={formDados.plano_id} onChange={e => setFormDados({ ...formDados, plano_id: e.target.value })}>
                      <option value="">Sem plano</option>
                      {opcoesPlano.map((p: any) => (
                        <option key={p.id} value={p.id}>{p.nome} — R$ {Number(p.preco_mensal || 0).toFixed(2)}{p.ativo === false ? ' (inativo)' : ''}</option>
                      ))}
                    </select>
                    {planos.length === 0 && <p className="text-xs text-amber-600 mt-1">Nenhum plano cadastrado. A conta ficará sem plano.</p>}
                  </>
                )}
              </div>
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end gap-3 flex-shrink-0">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg text-sm font-medium">Cancelar</button>
              <button onClick={handleSalvar} className="flex items-center px-5 py-2 bg-green-700 text-white rounded-lg font-medium text-sm hover:bg-green-800"><Check size={16} className="mr-1.5" /> Salvar</button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center"><AlertTriangle size={32} className="text-red-600" /></div>
              <h3 className="text-xl font-bold text-gray-800">Excluir Empresa</h3>
              <p className="text-gray-500">Remover <strong className="text-gray-800">{deleteTarget.nome}</strong>?</p>
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end gap-3">
              <button onClick={() => setDeleteTarget(null)} className="px-5 py-2.5 font-bold text-gray-500 hover:bg-gray-200 rounded-xl">Cancelar</button>
              <button onClick={excluir} className="flex items-center px-6 py-2.5 bg-red-600 text-white font-bold rounded-xl shadow hover:bg-red-700"><Trash2 size={18} className="mr-2" /> Excluir</button>
            </div>
          </div>
        </div>
      )}

      {successConta && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 flex flex-col items-center text-center space-y-3">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center"><Check size={32} className="text-green-600" /></div>
              <h3 className="text-xl font-bold text-gray-800">Conta criada com sucesso.</h3>
              <p className="text-gray-500">Esta conta ainda não possui administrador. Deseja criar o primeiro administrador agora?</p>
              <p className="text-sm font-semibold text-gray-700">{successConta.nome}</p>
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end gap-3">
              <button onClick={() => setSuccessConta(null)} className="px-5 py-2.5 font-bold text-gray-500 hover:bg-gray-200 rounded-xl">Criar depois</button>
              <button
                onClick={() => {
                  const conta = successConta;
                  setSuccessConta(null);
                  navigate(`/painel-administrativo/usuarios?empresa_id=${encodeURIComponent(conta.id)}&openCreate=true&source=empresa-created`);
                }}
                className="flex items-center px-6 py-2.5 bg-green-700 text-white font-bold rounded-xl shadow hover:bg-green-800"
              >
                <UserPlus size={18} className="mr-2" /> Criar administrador agora
              </button>
            </div>
          </div>
        </div>
      )}

      {trialTarget && (() => {
        const hojeStr = new Date().toISOString().slice(0, 10);
        const max90Str = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const bloqueado = trialTarget.status === 'ativo' && !confirmAtivo;
        return (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
              <div className="p-6 border-b flex justify-between items-center bg-gray-50">
                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><CalendarClock size={20} className="text-amber-600" /> Trial · {trialTarget.nome}</h3>
                <button onClick={() => setTrialTarget(null)} title="Fechar" aria-label="Fechar" className="p-2 hover:bg-gray-200 rounded-full"><X size={22} /></button>
              </div>
              <div className="p-6 space-y-4">
                <div className="text-sm text-gray-600">
                  Status atual: <span className="font-bold">{trialTarget.status}</span><br />
                  {trialTarget.trial_ends_at
                    ? (trialVencido(trialTarget.trial_ends_at)
                        ? <>Trial <span className="font-bold text-red-600">vencido</span> em {formatData(trialTarget.trial_ends_at)}</>
                        : <>Trial até <span className="font-bold text-amber-600">{formatData(trialTarget.trial_ends_at)}</span></>)
                    : <span className="text-gray-400">Sem trial definido</span>}
                </div>

                {trialTarget.status === 'ativo' && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                      <span>Esta empresa está <strong>ATIVA</strong>. Liberar trial vai alterar o status para <strong>trial</strong>.</span>
                    </div>
                    <label className="flex items-center gap-2 mt-2 cursor-pointer font-semibold">
                      <input type="checkbox" checked={confirmAtivo} onChange={ev => setConfirmAtivo(ev.target.checked)} />
                      <span>Confirmo liberar trial para esta empresa ativa</span>
                    </label>
                  </div>
                )}

                <div className="flex gap-2">
                  <button disabled={bloqueado} onClick={() => aplicarTrial({ dias: 7 })} title="Prorrogar trial por 7 dias" aria-label="Prorrogar trial por 7 dias" className="flex-1 px-3 py-2.5 bg-green-700 text-white rounded-xl font-medium text-sm hover:bg-green-800 disabled:opacity-40 disabled:cursor-not-allowed">+7 dias</button>
                  <button disabled={bloqueado} onClick={() => aplicarTrial({ dias: 15 })} title="Prorrogar trial por 15 dias" aria-label="Prorrogar trial por 15 dias" className="flex-1 px-3 py-2.5 bg-green-700 text-white rounded-xl font-medium text-sm hover:bg-green-800 disabled:opacity-40 disabled:cursor-not-allowed">+15 dias</button>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Data personalizada (máx. 90 dias)</label>
                  <div className="flex gap-2">
                    <input type="date" min={hojeStr} max={max90Str} value={customDate} onChange={ev => setCustomDate(ev.target.value)} className="flex-1 border-2 border-gray-50 rounded-xl p-2.5 outline-none focus:border-blue-500 bg-gray-50/50 text-sm" />
                    <button disabled={!customDate || bloqueado} onClick={() => aplicarTrial({ trial_ends_at: customDate })} title="Aplicar data personalizada de trial" aria-label="Aplicar data personalizada de trial" className="px-4 py-2.5 bg-blue-600 text-white rounded-xl font-medium text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">Aplicar</button>
                  </div>
                </div>
              </div>
              <div className="p-4 bg-gray-50 border-t flex justify-end">
                <button onClick={() => setTrialTarget(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg text-sm font-medium">Fechar</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
