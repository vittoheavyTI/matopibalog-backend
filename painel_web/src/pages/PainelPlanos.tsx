import React, { useEffect, useState } from 'react';
import { AlertTriangle, Archive, ArchiveRestore, Check, Eye, Plus, Shield, Trash2, X } from 'lucide-react';
import api from '../api';

type FormPlano = {
  nome: string;
  preco_mensal: string;
  descricao: string;
  limite_motoristas: string;
  dias_trial: string;
  ativo: boolean;
  categoria: string;
  recursos: string;
};

const FORM_VAZIO: FormPlano = {
  nome: '',
  preco_mensal: '',
  descricao: '',
  limite_motoristas: '5',
  dias_trial: '7',
  ativo: true,
  categoria: 'ambos',
  recursos: '',
};

// Público-alvo do plano. Dirige o que aparece no app do autônomo.
const CATEGORIAS_PLANO: { chave: string; titulo: string }[] = [
  { chave: 'empresa', titulo: 'Empresa' },
  { chave: 'autonomo', titulo: 'Autônomo' },
  { chave: 'ambos', titulo: 'Ambos' },
];

const LABELS_RECURSOS: Record<string, string> = {
  api: 'Api',
  gestao: 'Gestão',
  integracao: 'Integração',
  multiusuario: 'Multiusuário',
  personalizacao: 'Personalização',
  relatorios: 'Relatórios',
  suporte: 'Suporte',
  usuarios: 'Usuários',
};

const VALORES_RECURSOS: Record<string, string> = {
  prioritario: 'prioritário',
};

function removerAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

function labelRecurso(chave: string): string {
  const palavras = chave.replace(/[_-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  return palavras.map((palavra, indice) => {
    const normalizada = removerAcentos(palavra);
    const conhecida = LABELS_RECURSOS[normalizada];
    if (conhecida) return conhecida;
    return indice === 0 ? palavra.charAt(0).toUpperCase() + palavra.slice(1) : palavra.toLocaleLowerCase('pt-BR');
  }).join(' ');
}

function valorRecurso(valor: string): string {
  const limpo = valor.trim();
  return VALORES_RECURSOS[removerAcentos(limpo)] || limpo;
}

function formatarRecursoTexto(item: string): string {
  const limpo = item.trim().replace(/[{}\[\]"]/g, '').replace(/^'+|'+$/g, '').trim();
  if (!limpo || ['true', 'false', 'null'].includes(limpo.toLocaleLowerCase('pt-BR'))) return '';
  const separador = limpo.indexOf(':');
  if (separador < 0) return labelRecurso(limpo);

  const chave = limpo.slice(0, separador).trim().replace(/^'+|'+$/g, '');
  const valor = limpo.slice(separador + 1).trim().replace(/^'+|'+$/g, '');
  if (!chave || !valor || valor === 'false' || valor === 'null') return '';
  if (valor === 'true') return labelRecurso(chave);
  return `${labelRecurso(chave)}: ${valorRecurso(valor)}`;
}

function normalizarRecursosParaLista(recursos: unknown): string[] {
  let itens: string[] = [];

  if (typeof recursos === 'string') {
    const texto = recursos.trim();
    if (!texto) return [];

    if ((texto.startsWith('{') && texto.endsWith('}')) || (texto.startsWith('[') && texto.endsWith(']'))) {
      try {
        return normalizarRecursosParaLista(JSON.parse(texto));
      } catch {
        // JSON legado inválido segue como texto comum, sem interromper a tela.
      }
    }

    itens = texto.split(/[,\n]/).map(formatarRecursoTexto);
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
      return label ? [`${label}: ${valorRecurso(String(valor))}`] : [valorRecurso(String(valor))];
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
  // Seção "Arquivados" recolhida por padrão (não polui a visão principal).
  const [arquivadosAbertos, setArquivadosAbertos] = useState(false);
  // Plano sob confirmação forte de exclusão (modal exige digitar o nome).
  const [confirmarExcluir, setConfirmarExcluir] = useState<any>(null);
  const [excluirTexto, setExcluirTexto] = useState('');

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
      categoria: plano.categoria || 'ambos',
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
      categoria: form.categoria,
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

  // Ativar/Inativar: dimensão APP/cadastro (ativo=true/false). Separada de
  // arquivar. Nunca remove do banco (empresas/faturas podem referenciar).
  async function alternarAtivo(plano: any) {
    const reativar = plano.ativo === false;
    try {
      await api.put('/painel-admin/planos/' + plano.id, { ativo: reativar });
      setToast({ message: reativar ? 'Plano reativado!' : 'Plano inativado!', tipo: 'sucesso' });
      carregar();
    } catch {
      setToast({ message: 'Erro ao alterar status do plano', tipo: 'erro' });
    }
  }

  // Arquivar/Desarquivar: dimensão VISIBILIDADE NO PAINEL, separada de ativo.
  // Arquivar seta ativo=false no backend; desarquivar NÃO reativa (ativo segue false).
  async function alternarArquivo(plano: any, arquivarFlag: boolean) {
    try {
      await api.put('/painel-admin/planos/' + plano.id, { arquivar: arquivarFlag });
      setToast({ message: arquivarFlag ? 'Plano arquivado!' : 'Plano desarquivado!', tipo: 'sucesso' });
      carregar();
    } catch {
      setToast({ message: 'Erro ao arquivar o plano', tipo: 'erro' });
    }
  }

  // Exclusão física — só chega aqui via modal de confirmação forte, e o botão só
  // aparece quando excluivel===true. 409 do backend vira toast de erro (nunca quebra).
  async function excluir(plano: any) {
    try {
      await api.delete('/painel-admin/planos/' + plano.id);
      setToast({ message: 'Plano excluído!', tipo: 'sucesso' });
      setConfirmarExcluir(null);
      setExcluirTexto('');
      carregar();
    } catch (err: any) {
      setToast({ message: err.response?.data?.message || 'Não foi possível excluir o plano.', tipo: 'erro' });
    }
  }

  function renderCard(plano: any) {
    const recursos = normalizarRecursosParaLista(plano.recursos);
    const inativo = plano.ativo === false;
    const arquivado = Boolean(plano.arquivado_em);
    const excluivel = plano.excluivel === true;
    return (
      <div key={plano.id} className="bg-white rounded-2xl border border-gray-100 p-6 hover:shadow-md transition-all">
        <div className="flex justify-between items-start gap-3 mb-3">
          <h3 className="text-lg font-bold text-gray-800">{plano.nome}</h3>
          <span className="text-xl font-black text-blue-600 whitespace-nowrap">R$ {Number(plano.preco_mensal || 0).toFixed(2)}</span>
        </div>
        <p className="text-sm text-gray-500 mb-4">{plano.descricao || 'Sem descrição'}</p>
        <div className="flex flex-wrap gap-2 mb-4 text-xs font-semibold">
          <span className="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 capitalize">{plano.categoria || 'ambos'}</span>
          <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700">Até {Number(plano.limite_motoristas ?? 0)} motoristas</span>
          <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700">Trial: {Number(plano.dias_trial ?? 0)} dias</span>
          <span className={`px-2.5 py-1 rounded-lg ${!inativo ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{!inativo ? 'Ativo' : 'Inativo'}</span>
          {arquivado && <span className="px-2.5 py-1 rounded-lg bg-gray-200 text-gray-600">Arquivado</span>}
        </div>
        <div className="flex flex-wrap gap-1.5 min-h-7">
          {recursos.length > 0 ? recursos.map((recurso) => (
            <span key={recurso} className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-medium">{recurso}</span>
          )) : <span className="text-xs text-gray-400">Nenhum recurso informado</span>}
        </div>
        <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t">
          <button onClick={() => abrirEdicao(plano)} title={`Editar plano ${plano.nome}`} aria-label={`Editar plano ${plano.nome}`} className="flex-1 min-w-24 py-2 text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl"><Eye size={14} className="inline mr-1" />Editar</button>
          {!arquivado ? (
            <>
              <button onClick={() => alternarAtivo(plano)} title={inativo ? `Reativar plano ${plano.nome}` : `Inativar plano ${plano.nome}`} aria-label={inativo ? `Reativar plano ${plano.nome}` : `Inativar plano ${plano.nome}`} className={`flex-1 min-w-24 py-2 text-xs font-bold rounded-xl ${inativo ? 'text-green-700 bg-green-50 hover:bg-green-100' : 'text-amber-700 bg-amber-50 hover:bg-amber-100'}`}>{inativo ? 'Reativar' : 'Inativar'}</button>
              <button onClick={() => alternarArquivo(plano, true)} title={`Arquivar plano ${plano.nome}`} aria-label={`Arquivar plano ${plano.nome}`} className="flex-1 min-w-24 py-2 text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl"><Archive size={14} className="inline mr-1" />Arquivar</button>
            </>
          ) : (
            <button onClick={() => alternarArquivo(plano, false)} title={`Desarquivar plano ${plano.nome}`} aria-label={`Desarquivar plano ${plano.nome}`} className="flex-1 min-w-24 py-2 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-xl"><ArchiveRestore size={14} className="inline mr-1" />Desarquivar</button>
          )}
          {excluivel && (
            <button onClick={() => { setConfirmarExcluir(plano); setExcluirTexto(''); }} title={`Excluir plano ${plano.nome}`} aria-label={`Excluir plano ${plano.nome}`} className="flex-1 min-w-24 py-2 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 rounded-xl"><Trash2 size={14} className="inline mr-1" />Excluir</button>
          )}
        </div>
      </div>
    );
  }

  // Visão principal = não arquivados. Arquivados vão para seção recolhida.
  const naoArquivados = planos.filter((p) => !p.arquivado_em);
  const arquivados = planos.filter((p) => p.arquivado_em);
  const ativos = naoArquivados.filter((p) => p.ativo !== false);
  const inativos = naoArquivados.filter((p) => p.ativo === false);

  return (
    <div className="space-y-4 animate-fade-in">
      {toast && (
        <div className={`fixed top-6 right-6 z-[100] flex items-center space-x-2 px-5 py-3 rounded-xl shadow-2xl text-sm font-bold ${toast.tipo === 'sucesso' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`} role="status">
          {toast.tipo === 'sucesso' ? <Check size={18} /> : <AlertTriangle size={18} />}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} title="Fechar" aria-label="Fechar notificação" className="ml-1 p-0.5 rounded-full hover:bg-white/20"><X size={16} /></button>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="bg-gray-800 p-1.5 rounded-lg text-white"><Shield size={18} /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-800 leading-tight">Planos</h1>
            <p className="text-sm text-gray-500">Gerenciar planos de assinatura</p>
          </div>
        </div>
        <button onClick={abrirNovoPlano} title="Criar novo plano" aria-label="Criar novo plano" className="flex items-center shrink-0 px-4 py-2.5 bg-green-700 text-white rounded-xl font-medium text-sm hover:bg-green-800 active:scale-95"><Plus size={18} className="mr-1.5" /> Novo Plano</button>
      </div>

      {planos.length === 0 && <div className="p-8 text-center text-gray-400 bg-white rounded-2xl border border-gray-100">Nenhum plano cadastrado</div>}

      {CATEGORIAS_PLANO.map(({ chave, titulo }) => {
        const doGrupo = ativos.filter((p) => (p.categoria || 'ambos') === chave);
        if (doGrupo.length === 0) return null;
        return (
          <div key={chave} className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">{titulo}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {doGrupo.map(renderCard)}
            </div>
          </div>
        );
      })}

      {inativos.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-400">Inativos</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {inativos.map(renderCard)}
          </div>
        </div>
      )}

      {arquivados.length > 0 && (
        <div className="space-y-3">
          <button
            onClick={() => setArquivadosAbertos((v) => !v)}
            aria-expanded={arquivadosAbertos}
            className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-gray-400 hover:text-gray-600"
          >
            <Archive size={14} />
            Arquivados ({arquivados.length})
            <span className="text-[10px]">{arquivadosAbertos ? '▲' : '▼'}</span>
          </button>
          {arquivadosAbertos && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {arquivados.map(renderCard)}
            </div>
          )}
        </div>
      )}

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
              <div>
                <label htmlFor="plano-categoria" className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Categoria (público-alvo)</label>
                <select id="plano-categoria" className="w-full border-2 border-gray-100 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
                  <option value="empresa">Empresa</option>
                  <option value="autonomo">Autônomo</option>
                  <option value="ambos">Ambos</option>
                </select>
                <p className="text-xs text-gray-400 mt-1.5 ml-1">No app do autônomo só aparecem planos "Autônomo" ou "Ambos".</p>
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

      {confirmarExcluir && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b flex items-center gap-2">
              <AlertTriangle className="text-red-600" size={22} />
              <h3 className="text-lg font-bold text-gray-800">Excluir plano</h3>
            </div>
            <div className="p-6 space-y-3">
              <p className="text-sm text-gray-600">
                Esta ação é <strong>irreversível</strong>. O plano <strong>{confirmarExcluir.nome}</strong> será
                removido permanentemente. Só é possível porque ele nunca foi usado.
              </p>
              <p className="text-sm text-gray-500">Para confirmar, digite o nome do plano:</p>
              <input
                autoFocus
                type="text"
                value={excluirTexto}
                onChange={(e) => setExcluirTexto(e.target.value)}
                placeholder={confirmarExcluir.nome}
                className="w-full border-2 border-gray-100 rounded-xl p-3 outline-none focus:border-red-500 bg-gray-50/50"
                aria-label="Digite o nome do plano para confirmar a exclusão"
              />
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end gap-3">
              <button onClick={() => { setConfirmarExcluir(null); setExcluirTexto(''); }} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg text-sm font-medium">Cancelar</button>
              <button
                onClick={() => excluir(confirmarExcluir)}
                disabled={excluirTexto.trim() !== confirmarExcluir.nome}
                className="flex items-center px-5 py-2 bg-red-600 text-white rounded-lg font-medium text-sm hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 size={16} className="mr-1.5" /> Excluir definitivamente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
