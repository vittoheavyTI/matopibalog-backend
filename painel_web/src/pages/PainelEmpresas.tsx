import React, { useState, useEffect } from 'react';
import { Shield, Search, Plus, X, Check, AlertTriangle, Eye, Ban, Unlock, Trash2, KeyRound } from 'lucide-react';
import api from '../api';

export const PainelEmpresas: React.FC = () => {
  const [empresas, setEmpresas] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [formDados, setFormDados] = useState({ nome: '', cnpj: '', email: '', telefone: '', plano_id: '' });
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [toast, setToast] = useState<{ message: string; tipo: 'sucesso' | 'erro' } | null>(null);

  useEffect(() => { carregar(); }, []);

  async function carregar() {
    const response = await api.get('/painel-admin/empresas');
    setEmpresas(response.data || []);
  }

  async function handleSalvar() {
    if (!formDados.nome.trim()) { setToast({ message: 'Nome é obrigatório', tipo: 'erro' }); return; }
    const payload = { nome: formDados.nome, cnpj: formDados.cnpj, email_contato: formDados.email, telefone_contato: formDados.telefone, plano_id: formDados.plano_id || null };
    if (editing) {
      try { await api.put('/painel-admin/empresas/' + editing.id, payload); } catch { setToast({ message: 'Erro ao atualizar', tipo: 'erro' }); return; }
      setToast({ message: 'Empresa atualizada!', tipo: 'sucesso' });
      setShowModal(false); setEditing(null); carregar();
    } else {
      try { await api.post('/painel-admin/empresas', { ...payload, status: 'trial' }); } catch { setToast({ message: 'Erro ao criar', tipo: 'erro' }); return; }
      setToast({ message: 'Empresa criada!', tipo: 'sucesso' });
      setShowModal(false); carregar();
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
    setDeleteTarget(null); carregar();
  }

  const filtered = empresas.filter(e => (e.nome || '').toLowerCase().includes(searchTerm.toLowerCase()) || (e.cnpj || '').includes(searchTerm));

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
          <h1 className="text-2xl font-bold text-gray-800">Empresas</h1>
          <p className="text-sm text-gray-500">Gestão de empresas cadastradas</p>
        </div>
      </div>

      <div className="flex flex-wrap justify-between items-center gap-4">
        <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex items-center flex-1 max-w-md">
          <Search size={18} className="text-gray-400 mr-2 flex-shrink-0" />
          <input type="text" placeholder="Buscar..." className="flex-1 outline-none text-gray-700 text-sm" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>
        <button onClick={() => { setEditing(null); setFormDados({ nome: '', cnpj: '', email: '', telefone: '', plano_id: '' }); setShowModal(true); }} className="flex items-center px-4 py-2.5 bg-green-700 text-white rounded-xl font-medium text-sm hover:bg-green-800 active:scale-95"><Plus size={18} className="mr-1.5" /> Nova Empresa</button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-gray-50 text-gray-600 text-xs font-bold uppercase tracking-wider">
              <th className="p-4 border-b">Empresa</th><th className="p-4 border-b">CNPJ</th><th className="p-4 border-b">Plano</th><th className="p-4 border-b">Status</th><th className="p-4 border-b text-center">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map(e => (
              <tr key={e.id} className="hover:bg-gray-50/50">
                <td className="p-4 font-bold text-gray-800">{e.nome}</td>
                <td className="p-4 text-sm text-gray-600">{e.cnpj}</td>
                <td className="p-4"><span className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-blue-50 text-blue-700">{e.planos?.nome || e.plano_id || '-'}</span></td>
                <td className="p-4"><span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest ${e.status === 'ativo' ? 'bg-green-50 text-green-700' : e.status === 'trial' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>{e.status}</span></td>
                <td className="p-4">
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={() => { setEditing(e); setFormDados({ nome: e.nome || '', cnpj: e.cnpj || '', email: e.email_contato || '', telefone: e.telefone_contato || '', plano_id: e.plano_id || '' }); setShowModal(true); }} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"><Eye size={16} /></button>
                    <button onClick={() => suspender(e.id)} className="p-1.5 text-orange-500 hover:bg-orange-50 rounded-lg">{e.status === 'suspenso' ? <Unlock size={16} /> : <Ban size={16} />}</button>
                    <button onClick={() => resetSenhaAdmin(e.id, e.nome)} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg" title="Resetar senha do admin"><KeyRound size={16} /></button>
                    <button onClick={() => setDeleteTarget(e)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
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
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b flex justify-between items-center bg-gray-50">
              <h3 className="text-xl font-bold text-gray-800">{editing ? 'Editar Empresa' : 'Nova Empresa'}</h3>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-200 rounded-full"><X size={24} /></button>
            </div>
            <div className="p-6 space-y-4">
              {[{ label: 'Nome', key: 'nome' }, { label: 'CNPJ', key: 'cnpj' }, { label: 'Email', key: 'email' }, { label: 'Telefone', key: 'telefone' }].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">{f.label}</label>
                  <input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={(formDados as any)[f.key] || ''} onChange={e => setFormDados({ ...formDados, [f.key]: e.target.value })} />
                </div>
              ))}
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Plano ID</label>
                <input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={formDados.plano_id} onChange={e => setFormDados({ ...formDados, plano_id: e.target.value })} placeholder="UUID do plano" />
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
    </div>
  );
};
