import React, { useState, useEffect } from 'react';
import { Shield, Search, Plus, X, Check, AlertTriangle, Eye, Trash2 } from 'lucide-react';
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

  useEffect(() => {
    async function init() {
      const [usersRes, empsRes] = await Promise.all([
        api.get('/painel-admin/usuarios'),
        api.get('/painel-admin/empresas'),
      ]);
      const users = usersRes.data;
      const emps = (empsRes.data || []).map((e: any) => ({ id: e.id, nome: e.nome }));
      setUsuarios(users || []);
      setEmpresas(emps || []);
    }
    init();
  }, []);

  async function handleSalvar() {
    if (!form.nome.trim() || !form.email.trim()) { setToast({ message: 'Nome e email obrigatórios', tipo: 'erro' }); return; }
    const payload = { nome: form.nome, email: form.email, empresa_id: form.empresa_id || null, tipo: form.tipo };
    if (editing) {
      try { await api.put('/admin/usuarios/' + editing.id, payload); } catch { setToast({ message: 'Erro ao atualizar', tipo: 'erro' }); return; }
      setToast({ message: 'Usuário atualizado!', tipo: 'sucesso' });
    } else {
      try { await api.post('/admin/usuarios', payload); } catch { setToast({ message: 'Erro ao criar', tipo: 'erro' }); return; }
      setToast({ message: 'Usuário criado!', tipo: 'sucesso' });
    }
    setShowModal(false); setEditing(null);
    const res = await api.get('/painel-admin/usuarios');
    setUsuarios(res.data || []);
  }

  async function excluir() {
    if (!deleteTarget) return;
    try { await api.delete('/admin/usuarios/' + deleteTarget.id); } catch { setToast({ message: 'Erro ao excluir', tipo: 'erro' }); return; }
    setToast({ message: 'Usuário excluído!', tipo: 'sucesso' });
    setDeleteTarget(null);
    const res = await api.get('/painel-admin/usuarios');
    setUsuarios(res.data || []);
  }

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
          <p className="text-sm text-gray-500">Gerenciar usuários do sistema</p>
        </div>
      </div>

      <div className="flex flex-wrap justify-between items-center gap-4">
        <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex items-center flex-1 max-w-md">
          <Search size={18} className="text-gray-400 mr-2 flex-shrink-0" />
          <input type="text" placeholder="Buscar..." className="flex-1 outline-none text-gray-700 text-sm" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>
        <button onClick={() => { setEditing(null); setForm({ nome: '', email: '', empresa_id: '', tipo: 'admin' }); setShowModal(true); }} className="flex items-center px-4 py-2.5 bg-blue-600 text-white rounded-xl font-medium text-sm hover:bg-blue-700"><Plus size={18} className="mr-1.5" /> Novo Usuário</button>
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
                <td className="p-4 text-sm text-gray-600">{u.empresas?.nome || '-'}</td>
                <td className="p-4"><span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase ${u.tipo === 'admin' ? 'bg-purple-50 text-purple-700' : u.tipo === 'master' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>{u.tipo}</span></td>
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
                  {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
              </div>
              <div><label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Tipo</label>
                <select className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
                  <option value="admin">Admin</option>
                  <option value="master">Master</option>
                  <option value="user">Usuário</option>
                </select>
              </div>
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg text-sm font-medium">Cancelar</button>
              <button onClick={handleSalvar} className="flex items-center px-5 py-2 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700"><Check size={16} className="mr-1.5" /> Salvar</button>
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
    </div>
  );
};
