import React, { useEffect, useState } from 'react';
import { FileText, Plus, Pencil, Send, Eye, Archive, AlertTriangle, X, Check } from 'lucide-react';
import api from '../api';

// Seção super-admin: modelos de contrato POR PLANO (versionados). Consome
// /admin/contrato-modelos. Regra de produto: alterações publicadas valem só para
// NOVOS contratos; contratos já assinados mantêm a versão congelada na emissão.

type Vigente = { id: string; versao: number; titulo: string; publicado_em?: string | null };
type PlanoLinha = {
  plano_id: string;
  plano_nome: string;
  preco_mensal?: number | string | null;
  vigente: Vigente | null;
  tem_rascunho: boolean;
  rascunho_id: string | null;
  total_versoes: number;
  ultima_atualizacao: string | null;
  sem_modelo_vigente: boolean;
};

type ModeloDetalhe = {
  id: string;
  plano_id: string;
  versao: number;
  titulo: string;
  conteudo: string;
  status: string;
  publicado_em?: string | null;
};

const formatarData = (d?: string | null) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—');

function mensagemErro(err: unknown, padrao: string) {
  const e = err as { response?: { status?: number; data?: { message?: string } } };
  if (e?.response?.status === 403) return 'Acesso restrito ao super-administrador.';
  return e?.response?.data?.message || padrao;
}

export const ModelosContrato: React.FC<{ notificar: (m: string, t: 'sucesso' | 'erro') => void }> = ({ notificar }) => {
  const [linhas, setLinhas] = useState<PlanoLinha[]>([]);
  const [carregando, setCarregando] = useState(true);

  // Editor (novo rascunho / editar rascunho / visualizar publicado).
  const [editor, setEditor] = useState<{
    modo: 'novo' | 'editar' | 'ver';
    plano: PlanoLinha;
    modeloId?: string;
    titulo: string;
    conteudo: string;
  } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [publicandoId, setPublicandoId] = useState<string | null>(null);

  async function carregar() {
    setCarregando(true);
    try {
      const { data } = await api.get('/admin/contrato-modelos/overview');
      setLinhas(Array.isArray(data?.planos) ? data.planos : []);
    } catch (err) {
      notificar(mensagemErro(err, 'Erro ao carregar modelos de contrato.'), 'erro');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { carregar(); }, []);

  function abrirNovo(plano: PlanoLinha) {
    setEditor({ modo: 'novo', plano, titulo: '', conteudo: '' });
  }

  async function abrirModelo(plano: PlanoLinha, modeloId: string, modo: 'editar' | 'ver') {
    try {
      const { data } = await api.get<ModeloDetalhe>(`/admin/contrato-modelos/${modeloId}`);
      setEditor({ modo, plano, modeloId, titulo: data.titulo || '', conteudo: data.conteudo || '' });
    } catch (err) {
      notificar(mensagemErro(err, 'Erro ao abrir modelo.'), 'erro');
    }
  }

  async function salvar() {
    if (!editor) return;
    if (!editor.titulo.trim() || !editor.conteudo.trim()) {
      notificar('Informe título e conteúdo do modelo.', 'erro');
      return;
    }
    setSalvando(true);
    try {
      if (editor.modo === 'novo') {
        await api.post('/admin/contrato-modelos', {
          plano_id: editor.plano.plano_id,
          titulo: editor.titulo,
          conteudo: editor.conteudo,
        });
        notificar('Rascunho criado. Publique para valer em novos contratos.', 'sucesso');
      } else if (editor.modo === 'editar' && editor.modeloId) {
        await api.patch(`/admin/contrato-modelos/${editor.modeloId}`, {
          titulo: editor.titulo,
          conteudo: editor.conteudo,
        });
        notificar('Rascunho atualizado.', 'sucesso');
      }
      setEditor(null);
      await carregar();
    } catch (err) {
      notificar(mensagemErro(err, 'Erro ao salvar modelo.'), 'erro');
    } finally {
      setSalvando(false);
    }
  }

  async function publicar(modeloId: string) {
    setPublicandoId(modeloId);
    try {
      await api.patch(`/admin/contrato-modelos/${modeloId}/publicar`);
      notificar('Modelo publicado. Vale a partir dos próximos contratos.', 'sucesso');
      await carregar();
    } catch (err) {
      notificar(mensagemErro(err, 'Erro ao publicar modelo.'), 'erro');
    } finally {
      setPublicandoId(null);
    }
  }

  async function arquivar(modeloId: string) {
    try {
      await api.patch(`/admin/contrato-modelos/${modeloId}/arquivar`);
      notificar('Modelo arquivado.', 'sucesso');
      await carregar();
    } catch (err) {
      notificar(mensagemErro(err, 'Erro ao arquivar modelo.'), 'erro');
    }
  }

  const semModelo = linhas.filter((l) => l.sem_modelo_vigente).length;

  return (
    <div className="space-y-4">
      {/* Aviso central de produto */}
      <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <AlertTriangle size={18} className="mt-0.5 shrink-0" />
        <p>
          Alterações publicadas valem apenas para <strong>novos contratos</strong>. Contratos já assinados
          permanecem com a versão original congelada na emissão.
        </p>
      </div>

      {semModelo > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p>
            {semModelo === 1 ? 'Há 1 plano' : `Há ${semModelo} planos`} sem modelo publicado. A contratação
            desses planos usa o <strong>texto técnico padrão</strong> até você publicar um modelo.
          </p>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="text-xs font-bold text-gray-400 uppercase bg-gray-50/60">
              <th className="px-4 py-3">Plano</th>
              <th className="px-4 py-3">Versão vigente</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Última atualização</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 text-sm">
            {carregando && (
              <tr><td colSpan={5} className="p-8 text-center text-gray-400">Carregando…</td></tr>
            )}
            {!carregando && linhas.length === 0 && (
              <tr><td colSpan={5} className="p-8 text-center text-gray-400">Nenhum plano comercial ativo.</td></tr>
            )}
            {!carregando && linhas.map((l) => (
              <tr key={l.plano_id} className="hover:bg-gray-50/50">
                <td className="px-4 py-3 font-semibold text-gray-800">{l.plano_nome}</td>
                <td className="px-4 py-3 text-gray-700">
                  {l.vigente ? `v${l.vigente.versao} — ${l.vigente.titulo}` : '—'}
                </td>
                <td className="px-4 py-3">
                  {l.vigente ? (
                    <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700">Publicado</span>
                  ) : (
                    <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-700">Sem modelo</span>
                  )}
                  {l.tem_rascunho && (
                    <span className="ml-1 px-2.5 py-1 rounded-full text-xs font-bold bg-yellow-100 text-yellow-700">Rascunho</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-500">{formatarData(l.ultima_atualizacao)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {l.vigente && (
                      <button title="Visualizar versão vigente" onClick={() => abrirModelo(l, l.vigente!.id, 'ver')}
                        className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg"><Eye size={17} /></button>
                    )}
                    {l.tem_rascunho && l.rascunho_id ? (
                      <>
                        <button title="Editar rascunho" onClick={() => abrirModelo(l, l.rascunho_id!, 'editar')}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"><Pencil size={17} /></button>
                        <button title="Publicar rascunho" disabled={publicandoId === l.rascunho_id}
                          onClick={() => publicar(l.rascunho_id!)}
                          className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg disabled:opacity-50"><Send size={17} /></button>
                        <button title="Arquivar rascunho" onClick={() => arquivar(l.rascunho_id!)}
                          className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg"><Archive size={17} /></button>
                      </>
                    ) : (
                      <button title="Nova versão (rascunho)" onClick={() => abrirNovo(l)}
                        className="p-1.5 text-green-700 hover:bg-green-50 rounded-lg"><Plus size={17} /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Editor de modelo */}
      {editor && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <FileText size={20} />
                {editor.modo === 'novo' ? 'Nova versão do modelo' : editor.modo === 'editar' ? 'Editar rascunho' : 'Visualizar modelo'}
                <span className="text-sm font-normal text-gray-400">— {editor.plano.plano_nome}</span>
              </h2>
              <button onClick={() => setEditor(null)} className="p-2 hover:bg-gray-100 rounded-full"><X size={18} /></button>
            </div>
            <div className="p-5 overflow-y-auto space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Título</label>
                <input
                  type="text"
                  value={editor.titulo}
                  disabled={editor.modo === 'ver'}
                  onChange={(e) => setEditor((s) => (s ? { ...s, titulo: e.target.value } : s))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:bg-gray-50"
                  placeholder="Ex.: Contrato de prestação de serviços — Plano Start"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Conteúdo do contrato</label>
                <textarea
                  value={editor.conteudo}
                  disabled={editor.modo === 'ver'}
                  onChange={(e) => setEditor((s) => (s ? { ...s, conteudo: e.target.value } : s))}
                  rows={16}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono outline-none focus:border-blue-500 disabled:bg-gray-50"
                  placeholder="Cole aqui o texto do contrato deste plano."
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 p-5 border-t border-gray-100">
              <button onClick={() => setEditor(null)} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100">
                {editor.modo === 'ver' ? 'Fechar' : 'Cancelar'}
              </button>
              {editor.modo !== 'ver' && (
                <button onClick={salvar} disabled={salvando}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-green-700 text-white hover:bg-green-800 disabled:opacity-50">
                  <Check size={16} /> {salvando ? 'Salvando…' : 'Salvar rascunho'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
