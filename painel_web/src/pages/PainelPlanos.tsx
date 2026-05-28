import React, { useState, useEffect } from 'react';
import { Shield, Plus, X, Check, AlertTriangle, Eye, Trash2 } from 'lucide-react';
import api from '../api';

export const PainelPlanos: React.FC = () => {
  const [planos, setPlanos] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ nome: '', preco_mensal: '', descricao: '', recursos: '' });
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [toast, setToast] = useState<{ message: string; tipo: 'sucesso' | 'erro' } | null>(null);

  useEffect(() => { carregar(); }, []);

  async function carregar() {
    try {
      const response = await api.get('/painel-admin/planos');
      setPlanos(response.data || []);
    } catch {
      setToast({ message: 'Erro ao carregar planos', tipo: 'erro' });
    }
  }

  async function handleSalvar() {
    if (!form.nome.trim()) { setToast({ message: 'Nome obrigatório', tipo: 'erro' }); return; }
    const payload = { nome: form.nome, preco_mensal: parseFloat(form.preco_mensal) || 0, descricao: form.descricao, recursos: form.recursos };
    if (editing) {
      try { await api.put('/painel-admin/planos/' + editing.id, payload); } catch { setToast({ message: 'Erro ao atualizar', tipo: 'erro' }); return; }
      setToast({ message: 'Plano atualizado!', tipo: 'sucesso' });
    } else {
      try { await api.post('/painel-admin/planos', payload); } catch { setToast({ message: 'Erro ao criar', tipo: 'erro' }); return; }
      setToast({ message: 'Plano criado!', tipo: 'sucesso' });
    }
    setShowModal(false); setEditing(null); carregar();
  }

  async function excluir() {
    if (!deleteTarget) return;
    try { await api.delete('/painel-admin/planos/' + deleteTarget.id); } catch { setToast({ message: 'Erro ao excluir', tipo: 'erro' }); return; }
    setToast({ message: 'Plano excluído!', tipo: 'sucesso' });
    setDeleteTarget(null); carregar();
  }

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
          <h1 className="text-2xl font-bold text-gray-800">Planos</h1>
          <p className="text-sm text-gray-500">Gerenciar planos de assinatura</p>
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={() => { setEditing(null); setForm({ nome: '', preco_mensal: '', descricao: '', recursos: '' }); setShowModal(true); }} className="flex items-center px-4 py-2.5 bg-blue-600 text-white rounded-xl font-medium text-sm hover:bg-blue-700"><Plus size={18} className="mr-1.5" /> Novo Plano</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {planos.map(p => (
          <div key={p.id} className="bg-white rounded-2xl border border-gray-100 p-6 hover:shadow-md transition-all">
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-lg font-bold text-gray-800">{p.nome}</h3>
              <span className="text-xl font-black text-blue-600">R$ {parseFloat(p.preco_mensal || '0').toFixed(2)}</span>
            </div>
            <p className="text-sm text-gray-500 mb-4">{p.descricao || 'Sem descrição'}</p>
            {p.recursos && <p className="text-xs text-gray-400 bg-gray-50 p-3 rounded-xl break-words">{p.recursos}</p>}
            <div className="flex gap-2 mt-4 pt-3 border-t">
              <button onClick={() => { setEditing(p); setForm({ nome: p.nome, preco_mensal: String(p.preco_mensal || ''), descricao: p.descricao || '', recursos: p.recursos || '' }); setShowModal(true); }} className="flex-1 py-2 text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl"><Eye size={14} className="inline mr-1" />Editar</button>
              <button onClick={() => setDeleteTarget(p)} className="py-2 px-3 text-xs font-bold text-red-500 bg-red-50 hover:bg-red-100 rounded-xl"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
        {planos.length === 0 && <div className="col-span-full p-8 text-center text-gray-400">Nenhum plano cadastrado</div>}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b flex justify-between items-center bg-gray-50">
              <h3 className="text-xl font-bold text-gray-800">{editing ? 'Editar Plano' : 'Novo Plano'}</h3>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-200 rounded-full"><X size={24} /></button>
            </div>
            <div className="p-6 space-y-4">
              {[
                { label: 'Nome', key: 'nome', placeholder: 'Ex: Premium' },
                { label: 'Preço Mensal', key: 'preco_mensal', placeholder: 'Ex: 99.90' },
                { label: 'Descrição', key: 'descricao', placeholder: 'Descrição do plano' },
                { label: 'Recursos', key: 'recursos', placeholder: 'Lista de recursos separados por vírgula' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">{f.label}</label>
                  <input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={(form as any)[f.key] || ''} onChange={e => setForm({ ...form, [f.key]: e.target.value })} placeholder={f.placeholder} />
                </div>
              ))}
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
              <h3 className="text-xl font-bold text-gray-800">Excluir Plano</h3>
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
