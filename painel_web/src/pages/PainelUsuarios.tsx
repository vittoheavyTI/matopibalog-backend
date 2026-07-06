import React, { useState, useEffect } from 'react';
import { Shield, Search, Plus, X, Check, AlertTriangle, Eye, Trash2, Copy, KeyRound } from 'lucide-react';
import api from '../api';

export const PainelUsuarios: React.FC = () => {
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ nome: '', email: '', empresa_id: '', tipo: 'admin' });
  const [empresas, setEmpresas] = useState<any[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [toast, setToast] = useState<{ message: string; tipo: 'sucesso' | 'erro' } | null>(null);
  // Senha temporária gerada pelo backend, exibida UMA única vez. Mantida só em estado
  // efêmero (nunca localStorage/sessionStorage/log); some ao fechar o modal.
  const [senhaGerada, setSenhaGerada] = useState<string | null>(null);
  const [senhaCopiada, setSenhaCopiada] = useState(false);

  // Tenta copiar via Clipboard API (moderna); falha → fallback execCommand (legado).
  // Falha total → alerta orientando seleção manual.
  const copiarSenha = async (senha: string) => {
    if (!senha) return;
    try {
      await navigator.clipboard.writeText(senha);
      setSenhaCopiada(true);
      return;
    } catch {
      // Clipboard API indisponível — tentar fallback
    }
    const el = document.createElement('textarea');
    try {
      el.value = senha;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      if (!document.execCommand('copy')) throw new Error('execCommand copy returned false');
      setSenhaCopiada(true);
    } catch {
      setSenhaCopiada(false);
      alert('Não foi possível copiar automaticamente. Selecione a senha manualmente.');
    } finally {
      if (el.parentNode) document.body.removeChild(el);
    }
  };

  useEffect(() => {
    async function init() {
      const [usersRes, empsRes] = await Promise.all([
        // /painel-admin/usuarios não existe; /admin/usuarios já retorna todos os usuários
        // para super-admin (sem filtro de empresa).
        api.get('/admin/usuarios'),
        api.get('/painel-admin/empresas'),
      ]);
      const users = usersRes.data;
      const emps = (empsRes.data || []).map((e: any) => ({ id: e.id, nome: e.nome, tipo: e.tipo }));
      setUsuarios(users || []);
      setEmpresas(emps || []);
    }
    init();
  }, []);

  async function handleSalvar() {
    if (!form.nome.trim() || !form.email.trim()) { setToast({ message: 'Nome e email obrigatórios', tipo: 'erro' }); return; }
    if (editing) {
      try { await api.put('/admin/usuarios/' + editing.id, { nome: form.nome, email: form.email, tipo: form.tipo }); }
      catch (err: any) { setToast({ message: err.response?.data?.message || 'Erro ao atualizar usuário.', tipo: 'erro' }); return; }
      setToast({ message: 'Usuário atualizado!', tipo: 'sucesso' });
    } else {
      // O backend (B1a) exige empresa-alvo explícita para super-admin via ?empresa_id=.
      // Exigimos a seleção aqui e enviamos por query param (o body empresa_id é ignorado).
      if (!form.empresa_id) { setToast({ message: 'Selecione a empresa para criar o usuário.', tipo: 'erro' }); return; }
      let resp;
      try { resp = await api.post('/admin/usuarios', { nome: form.nome, email: form.email, tipo: form.tipo }, { params: { empresa_id: form.empresa_id } }); }
      catch (err: any) { setToast({ message: err.response?.data?.message || 'Erro ao criar usuário.', tipo: 'erro' }); return; }
      setToast({ message: 'Usuário criado!', tipo: 'sucesso' });
      // Senha gerada pelo backend → exibe one-time (admin não informou senha).
      if (resp?.data?.senha_temporaria_gerada) { setSenhaCopiada(false); setSenhaGerada(resp.data.senha_temporaria_gerada); }
    }
    setShowModal(false); setEditing(null);
    const res = await api.get('/admin/usuarios');
    setUsuarios(res.data || []);
  }

  async function excluir() {
    if (!deleteTarget) return;
    try { await api.delete('/admin/usuarios/' + deleteTarget.id); }
    catch (err: any) { setToast({ message: err.response?.data?.message || 'Erro ao excluir usuário.', tipo: 'erro' }); return; }
    setToast({ message: 'Usuário excluído!', tipo: 'sucesso' });
    setDeleteTarget(null);
    const res = await api.get('/admin/usuarios');
    setUsuarios(res.data || []);
  }

  // Nome da empresa mapeado localmente: /admin/usuarios traz empresa_id (não o nome).
  // Reaproveita a lista de empresas já carregada. Sem empresa → "-".
  const empresaNome = (id?: string) => (id && empresas.find(e => e.id === id)?.nome) || '-';
  const empresaTipo = (id?: string) => id && empresas.find(e => e.id === id)?.tipo;

  const filtered = usuarios.filter(u => (u.nome || '').toLowerCase().includes(searchTerm.toLowerCase()) || (u.email || '').includes(searchTerm));

  return (
    <div className="space-y-4 animate-fade-in">
      {toast && (
        <div className={`fixed top-6 right-6 z-[100] flex items-center space-x-2 px-5 py-3 rounded-xl shadow-2xl text-sm font-bold ${toast.tipo === 'sucesso' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.tipo === 'sucesso' ? <Check size={18} /> : <AlertTriangle size={18} />}
          <span>{toast.message}</span>
        </div>
      )}

      <div className="flex items-center space-x-3 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="bg-gray-800 p-2 rounded-lg text-white"><Shield size={24} /></div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Usuários</h1>
          <p className="text-sm text-gray-500">Administradores vinculados às empresas e contas autônomas</p>
        </div>
      </div>

      <div className="flex flex-wrap justify-between items-center gap-4">
        <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex items-center flex-1 max-w-md">
          <Search size={18} className="text-gray-400 mr-2 flex-shrink-0" />
          <input type="text" placeholder="Buscar..." className="flex-1 outline-none text-gray-700 text-sm" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>
        <button onClick={() => { setEditing(null); setForm({ nome: '', email: '', empresa_id: '', tipo: 'admin' }); setShowModal(true); }} className="flex items-center px-4 py-2.5 bg-green-700 text-white rounded-xl font-medium text-sm hover:bg-green-800"><Plus size={18} className="mr-1.5" /> Novo Usuário</button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-gray-50 text-gray-600 text-xs font-bold uppercase tracking-wider">
              <th className="p-4 border-b">Nome</th><th className="p-4 border-b">Email</th><th className="p-4 border-b">Empresa</th><th className="p-4 border-b">Tipo</th><th className="p-4 border-b text-center">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map(u => (
              <tr key={u.id} className="hover:bg-gray-50/50">
                <td className="p-4 font-bold text-gray-800">{u.nome}</td>
                <td className="p-4 text-sm text-gray-600">{u.email}</td>
                <td className="p-4 text-sm text-gray-600">{empresaNome(u.empresa_id)}</td>
                <td className="p-4"><span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase ${u.tipo === 'admin' ? 'bg-purple-50 text-purple-700' : u.tipo === 'master' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>{u.tipo === 'admin' && empresaTipo(u.empresa_id) === 'autonomo' ? 'Admin de autônomo' : u.tipo}</span></td>
                <td className="p-4 text-center">
                  <button onClick={() => { setEditing(u); setForm({ nome: u.nome, email: u.email, empresa_id: u.empresa_id || '', tipo: u.tipo }); setShowModal(true); }} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg mr-1"><Eye size={16} /></button>
                  <button onClick={() => setDeleteTarget(u)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-gray-400">Nenhum usuário</td></tr>}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b flex justify-between items-center bg-gray-50">
              <h3 className="text-xl font-bold text-gray-800">{editing ? 'Editar Usuário' : 'Novo Usuário'}</h3>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-200 rounded-full"><X size={24} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div><label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Nome</label><input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></div>
              <div><label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Email</label><input type="email" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
              <div><label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Empresa</label>
                <select className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={form.empresa_id} onChange={e => setForm({ ...form, empresa_id: e.target.value })}>
                  <option value="">Sem empresa</option>
                  {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}{e.tipo === 'autonomo' ? ' — Autônomo' : ''}</option>)}
                </select>
              </div>
              <div><label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Tipo</label>
                <select className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end gap-3">
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
              <h3 className="text-xl font-bold text-gray-800">Excluir Usuário</h3>
              <p className="text-gray-500">Remover <strong className="text-gray-800">{deleteTarget.nome}</strong>?</p>
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end gap-3">
              <button onClick={() => setDeleteTarget(null)} className="px-5 py-2.5 font-bold text-gray-500 hover:bg-gray-200 rounded-xl">Cancelar</button>
              <button onClick={excluir} className="flex items-center px-6 py-2.5 bg-red-600 text-white font-bold rounded-xl shadow hover:bg-red-700"><Trash2 size={18} className="mr-2" /> Excluir</button>
            </div>
          </div>
        </div>
      )}

      {senhaGerada && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 flex flex-col items-center text-center space-y-3">
              <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center"><KeyRound size={32} className="text-amber-600" /></div>
              <h3 className="text-xl font-bold text-gray-800">Senha temporária</h3>
              <p className="text-sm text-gray-500">Copie esta senha agora e entregue ao usuário. <strong className="text-gray-700">Ela será exibida somente uma vez.</strong></p>
              <div className="w-full flex items-center gap-2 bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl p-3">
                <code className="flex-1 text-lg font-mono font-bold text-gray-800 break-all select-all">{senhaGerada}</code>
                <button
                  onClick={() => copiarSenha(senhaGerada!)}
                  className="flex items-center px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex-shrink-0"
                >
                  {senhaCopiada ? <><Check size={16} className="mr-1.5" /> Copiado</> : <><Copy size={16} className="mr-1.5" /> Copiar</>}
                </button>
              </div>
              <p className="text-xs text-gray-400">O usuário será obrigado a trocar a senha no primeiro acesso.</p>
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end">
              <button onClick={() => { setSenhaGerada(null); setSenhaCopiada(false); }} className="px-6 py-2.5 bg-gray-800 text-white font-bold rounded-xl hover:bg-gray-900">Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
