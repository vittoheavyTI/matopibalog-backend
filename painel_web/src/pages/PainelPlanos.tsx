import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Eye, Plus, Shield, X } from 'lucide-react';
import api from '../api';

type FormPlano = {
  nome: string;
  preco_mensal: string;
  descricao: string;
  limite_motoristas: string;
  dias_trial: string;
  ativo: boolean;
  recursos: string;
};

const FORM_VAZIO: FormPlano = {
  nome: '',
  preco_mensal: '',
  descricao: '',
  limite_motoristas: '5',
  dias_trial: '7',
  ativo: true,
  recursos: '',
};

function labelRecurso(chave: string): string {
  const texto = chave.replace(/[_-]+/g, ' ').trim();
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : '';
}

function normalizarRecursosParaLista(recursos: unknown): string[] {
  let itens: string[] = [];

  if (typeof recursos === 'string') {
    itens = recursos.split(/[,\n]/).map((item) => item.trim());
  } else if (Array.isArray(recursos)) {
    itens = recursos.flatMap((item) => normalizarRecursosParaLista(item));
  } else if (recursos && typeof recursos === 'object') {
    itens = Object.entries(recursos).flatMap(([chave, valor]) => {
      if (valor === false || valor === null || valor === undefined || valor === '') return [];
      const label = labelRecurso(chave);
      if (valor === true) return label ? [label] : [];
      if (Array.isArray(valor)) {
        const detalhes = normalizarRecursosParaLista(valor).join(', ');
        return detalhes ? [`${label}: ${detalhes}`] : [];
      }
      if (typeof valor === 'object') return normalizarRecursosParaLista(valor);
      return label ? [`${label}: ${String(valor)}`] : [String(valor)];
    });
  }

  const vistos = new Set<string>();
  return itens.filter((item) => {
    const limpo = item.trim();
    const chave = limpo.toLocaleLowerCase('pt-BR');
    if (!limpo || vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

function recursosParaTexto(recursos: unknown): string {
  return normalizarRecursosParaLista(recursos).join('\n');
}

function textoParaRecursos(texto: string): string[] {
  return normalizarRecursosParaLista(texto);
}

export const PainelPlanos: React.FC = () => {
  const [planos, setPlanos] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<FormPlano>(FORM_VAZIO);
  const [toast, setToast] = useState<{ message: string; tipo: 'sucesso' | 'erro' } | null>(null);

  useEffect(() => { carregar(); }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function carregar() {
    try {
      const response = await api.get('/painel-admin/planos');
      setPlanos(response.data || []);
    } catch {
      setToast({ message: 'Erro ao carregar planos', tipo: 'erro' });
    }
  }

  function abrirNovoPlano() {
    setEditing(null);
    setForm({ ...FORM_VAZIO });
    setShowModal(true);
  }

  function abrirEdicao(plano: any) {
    setEditing(plano);
    setForm({
      nome: plano.nome || '',
      preco_mensal: String(plano.preco_mensal ?? ''),
      descricao: plano.descricao || '',
      limite_motoristas: String(plano.limite_motoristas ?? 5),
      dias_trial: String(plano.dias_trial ?? 7),
      ativo: plano.ativo !== false,
      recursos: recursosParaTexto(plano.recursos),
    });
    setShowModal(true);
  }

  async function handleSalvar() {
    const preco = Number(form.preco_mensal);
    const limite = Number(form.limite_motoristas);
    const diasTrial = Number(form.dias_trial);

    if (!form.nome.trim()) { setToast({ message: 'Nome é obrigatório', tipo: 'erro' }); return; }
    if (!Number.isFinite(preco) || preco < 0) { setToast({ message: 'Preço deve ser igual ou maior que zero', tipo: 'erro' }); return; }
    if (!Number.isInteger(limite) || limite < 0) { setToast({ message: 'Limite de motoristas deve ser um inteiro igual ou maior que zero', tipo: 'erro' }); return; }
    if (!Number.isInteger(diasTrial) || diasTrial < 0) { setToast({ message: 'Dias de trial deve ser um inteiro igual ou maior que zero', tipo: 'erro' }); return; }

    const payload = {
      nome: form.nome.trim(),
      preco_mensal: preco,
      descricao: form.descricao.trim(),
      limite_motoristas: limite,
      dias_trial: diasTrial,
      ativo: form.ativo,
      recursos: textoParaRecursos(form.recursos),
    };

    try {
      if (editing) {
        await api.put('/painel-admin/planos/' + editing.id, payload);
        setToast({ message: 'Plano atualizado!', tipo: 'sucesso' });
      } else {
        await api.post('/painel-admin/planos', payload);
        setToast({ message: 'Plano criado!', tipo: 'sucesso' });
      }
      setShowModal(false);
      setEditing(null);
      carregar();
    } catch {
      setToast({ message: editing ? 'Erro ao atualizar' : 'Erro ao criar', tipo: 'erro' });
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && (
        <div className={`fixed top-6 right-6 z-[100] flex items-center space-x-2 px-5 py-3 rounded-xl shadow-2xl text-sm font-bold ${toast.tipo === 'sucesso' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`} role="status">
          {toast.tipo === 'sucesso' ? <Check size={18} /> : <AlertTriangle size={18} />}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} title="Fechar" aria-label="Fechar notificação" className="ml-1 p-0.5 rounded-full hover:bg-white/20"><X size={16} /></button>
        </div>
      )}

      <div className="flex items-center gap-2.5">
        <div className="bg-gray-800 p-1.5 rounded-lg text-white"><Shield size={18} /></div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800 leading-tight">Planos</h1>
          <p className="text-sm text-gray-500">Gerenciar planos de assinatura</p>
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={abrirNovoPlano} title="Criar novo plano" aria-label="Criar novo plano" className="flex items-center px-4 py-2.5 bg-green-700 text-white rounded-xl font-medium text-sm hover:bg-green-800 active:scale-95"><Plus size={18} className="mr-1.5" /> Novo Plano</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {planos.map((plano) => {
          const recursos = normalizarRecursosParaLista(plano.recursos);
          return (
            <div key={plano.id} className="bg-white rounded-2xl border border-gray-100 p-6 hover:shadow-md transition-all">
              <div className="flex justify-between items-start gap-3 mb-3">
                <h3 className="text-lg font-bold text-gray-800">{plano.nome}</h3>
                <span className="text-xl font-black text-blue-600 whitespace-nowrap">R$ {Number(plano.preco_mensal || 0).toFixed(2)}</span>
              </div>
              <p className="text-sm text-gray-500 mb-4">{plano.descricao || 'Sem descrição'}</p>
              <div className="flex flex-wrap gap-2 mb-4 text-xs font-semibold">
                <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700">Até {Number(plano.limite_motoristas ?? 0)} motoristas</span>
                <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700">Trial: {Number(plano.dias_trial ?? 0)} dias</span>
                <span className={`px-2.5 py-1 rounded-lg ${plano.ativo !== false ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{plano.ativo !== false ? 'Ativo' : 'Inativo'}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 min-h-7">
                {recursos.length > 0 ? recursos.map((recurso) => (
                  <span key={recurso} className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-medium">{recurso}</span>
                )) : <span className="text-xs text-gray-400">Nenhum recurso informado</span>}
              </div>
              <div className="flex gap-2 mt-4 pt-3 border-t">
                <button onClick={() => abrirEdicao(plano)} title={`Editar plano ${plano.nome}`} aria-label={`Editar plano ${plano.nome}`} className="flex-1 py-2 text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl"><Eye size={14} className="inline mr-1" />Editar</button>
              </div>
            </div>
          );
        })}
        {planos.length === 0 && <div className="col-span-full p-8 text-center text-gray-400">Nenhum plano cadastrado</div>}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b flex justify-between items-center bg-gray-50 sticky top-0 z-10">
              <h3 className="text-xl font-bold text-gray-800">{editing ? 'Editar Plano' : 'Novo Plano'}</h3>
              <button onClick={() => setShowModal(false)} title="Fechar formulário" aria-label="Fechar formulário" className="p-2 hover:bg-gray-200 rounded-full"><X size={24} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label htmlFor="plano-nome" className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Nome</label>
                <input id="plano-nome" type="text" required className="w-full border-2 border-gray-100 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex: Premium" />
              </div>
              <div>
                <label htmlFor="plano-descricao" className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Descrição</label>
                <input id="plano-descricao" type="text" className="w-full border-2 border-gray-100 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Descrição do plano" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="plano-preco" className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Preço mensal</label>
                  <input id="plano-preco" type="number" min="0" step="0.01" className="w-full border-2 border-gray-100 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={form.preco_mensal} onChange={(e) => setForm({ ...form, preco_mensal: e.target.value })} placeholder="99,90" />
                </div>
                <div>
                  <label htmlFor="plano-limite" className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Motoristas</label>
                  <input id="plano-limite" type="number" min="0" step="1" className="w-full border-2 border-gray-100 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={form.limite_motoristas} onChange={(e) => setForm({ ...form, limite_motoristas: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="plano-trial" className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Dias de trial</label>
                  <input id="plano-trial" type="number" min="0" step="1" className="w-full border-2 border-gray-100 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={form.dias_trial} onChange={(e) => setForm({ ...form, dias_trial: e.target.value })} />
                </div>
              </div>
              <div>
                <label htmlFor="plano-recursos" className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Recursos</label>
                <textarea id="plano-recursos" rows={4} className="w-full border-2 border-gray-100 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50 resize-y" value={form.recursos} onChange={(e) => setForm({ ...form, recursos: e.target.value })} placeholder={'Um recurso por linha\nou separados por vírgula'} />
                <p className="text-xs text-gray-400 mt-1.5 ml-1">Use vírgulas ou uma linha para cada recurso. Não é necessário escrever JSON.</p>
              </div>
              <label className="flex items-center justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50/50 p-3 cursor-pointer">
                <span>
                  <span className="block text-sm font-semibold text-gray-700">Plano ativo</span>
                  <span className="block text-xs text-gray-400">Planos inativos ficam identificados no painel.</span>
                </span>
                <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} className="h-5 w-5 accent-green-700" aria-label="Definir plano como ativo" />
              </label>
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end gap-3 sticky bottom-0">
              <button onClick={() => setShowModal(false)} title="Cancelar edição" aria-label="Cancelar edição" className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg text-sm font-medium">Cancelar</button>
              <button onClick={handleSalvar} title="Salvar plano" aria-label="Salvar plano" className="flex items-center px-5 py-2 bg-green-700 text-white rounded-lg font-medium text-sm hover:bg-green-800"><Check size={16} className="mr-1.5" /> Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
