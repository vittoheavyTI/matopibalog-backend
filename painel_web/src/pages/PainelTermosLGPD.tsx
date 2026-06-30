import React, { useState, useEffect } from 'react';
import { FileText, Plus, Pencil, Send, Users, X, Check, AlertTriangle } from 'lucide-react';
import api from '../api';

// Tela super-admin para gerenciar termos LGPD (catálogo versionado).
// Apenas leitura/criação/edição de rascunho e publicação confirmada — sem gate,
// sem app, sem backend novo. Consome a API /admin/termos.

type Papel = 'admin' | 'motorista';

interface Termo {
  id: string;
  tipo: string;
  versao: number;
  titulo: string;
  conteudo?: string;
  conteudo_hash?: string;
  resumo?: string | null;
  base_legal?: string | null;
  obrigatorio_para?: string[];
  ativo: boolean;
  publicado_em?: string | null;
}

interface Aceite {
  id: string;
  usuario_id?: string;
  usuario_nome?: string | null;
  usuario_email?: string | null;
  aceito_em?: string;
  origem?: string;
  ip?: string | null;
}

const TIPOS: { value: string; label: string }[] = [
  { value: 'termos_uso', label: 'Termos de Uso' },
  { value: 'politica_privacidade', label: 'Política de Privacidade' },
  { value: 'termo_motorista', label: 'Termo do Motorista' },
  { value: 'consentimento_documentos', label: 'Consentimento de Documentos' },
];

const tipoLabel = (t: string) => TIPOS.find((x) => x.value === t)?.label ?? t;

const emptyForm = {
  tipo: 'termos_uso',
  titulo: '',
  conteudo: '',
  resumo: '',
  base_legal: '',
  obrigatorio_para: ['admin', 'motorista'] as Papel[],
};

const truncar = (s: string | null | undefined, n: number) =>
  !s ? '—' : s.length > n ? s.slice(0, n) + '…' : s;

const formatarData = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('pt-BR') : '—';

export const PainelTermosLGPD: React.FC = () => {
  const [termos, setTermos] = useState<Termo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [toast, setToast] = useState<{ message: string; tipo: 'sucesso' | 'erro' } | null>(null);

  // Modal de formulário (novo / editar rascunho)
  const [showForm, setShowForm] = useState(false);
  const [editando, setEditando] = useState<Termo | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [salvando, setSalvando] = useState(false);

  // Modal de confirmação de publicação
  const [publicando, setPublicando] = useState<Termo | null>(null);
  const [confirmandoPublicacao, setConfirmandoPublicacao] = useState(false);

  // Modal de aceites
  const [aceitesDe, setAceitesDe] = useState<Termo | null>(null);
  const [aceites, setAceites] = useState<Aceite[]>([]);
  const [carregandoAceites, setCarregandoAceites] = useState(false);

  const notificar = (message: string, tipo: 'sucesso' | 'erro') => {
    setToast({ message, tipo });
    setTimeout(() => setToast(null), 4000);
  };

  const mensagemErro = (err: any, padrao: string) => {
    const status = err?.response?.status;
    if (status === 403) return 'Acesso restrito ao super-administrador.';
    return err?.response?.data?.message || padrao;
  };

  async function carregar() {
    setCarregando(true);
    try {
      const { data } = await api.get('/admin/termos');
      setTermos(Array.isArray(data) ? data : []);
    } catch (err: any) {
      notificar(mensagemErro(err, 'Erro ao carregar termos.'), 'erro');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  // Status derivado: Publicado / Rascunho / Substituído
  const tiposComAtivo = new Set(termos.filter((t) => t.ativo).map((t) => t.tipo));
  const statusDe = (t: Termo): 'Publicado' | 'Rascunho' | 'Substituído' => {
    if (t.ativo) return 'Publicado';
    return tiposComAtivo.has(t.tipo) ? 'Substituído' : 'Rascunho';
  };
  const corStatus: Record<string, string> = {
    Publicado: 'bg-green-100 text-green-700',
    Rascunho: 'bg-yellow-100 text-yellow-700',
    Substituído: 'bg-gray-100 text-gray-500',
  };

  function abrirNovo() {
    setEditando(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  }

  function abrirEdicao(t: Termo) {
    setEditando(t);
    setForm({
      tipo: t.tipo,
      titulo: t.titulo || '',
      conteudo: t.conteudo || '',
      resumo: t.resumo || '',
      base_legal: t.base_legal || '',
      obrigatorio_para: (t.obrigatorio_para as Papel[]) || ['admin', 'motorista'],
    });
    setShowForm(true);
  }

  function togglePapel(p: Papel) {
    setForm((f) => ({
      ...f,
      obrigatorio_para: f.obrigatorio_para.includes(p)
        ? f.obrigatorio_para.filter((x) => x !== p)
        : [...f.obrigatorio_para, p],
    }));
  }

  async function salvarForm() {
    if (!form.titulo.trim() || !form.conteudo.trim()) {
      notificar('Título e conteúdo são obrigatórios.', 'erro');
      return;
    }
    setSalvando(true);
    try {
      if (editando) {
        // Edição de rascunho — não envia tipo (imutável por versão).
        await api.patch(`/admin/termos/${editando.id}`, {
          titulo: form.titulo,
          conteudo: form.conteudo,
          resumo: form.resumo,
          base_legal: form.base_legal,
          obrigatorio_para: form.obrigatorio_para,
        });
        notificar('Rascunho atualizado.', 'sucesso');
      } else {
        await api.post('/admin/termos', {
          tipo: form.tipo,
          titulo: form.titulo,
          conteudo: form.conteudo,
          resumo: form.resumo,
          base_legal: form.base_legal,
          obrigatorio_para: form.obrigatorio_para,
        });
        notificar('Rascunho criado.', 'sucesso');
      }
      setShowForm(false);
      setEditando(null);
      carregar();
    } catch (err: any) {
      notificar(mensagemErro(err, 'Erro ao salvar termo.'), 'erro');
    } finally {
      setSalvando(false);
    }
  }

  async function confirmarPublicacao() {
    if (!publicando) return;
    setConfirmandoPublicacao(true);
    try {
      await api.patch(`/admin/termos/${publicando.id}/publicar`);
      notificar('Termo publicado.', 'sucesso');
      setPublicando(null);
      carregar();
    } catch (err: any) {
      notificar(mensagemErro(err, 'Erro ao publicar termo.'), 'erro');
    } finally {
      setConfirmandoPublicacao(false);
    }
  }

  async function abrirAceites(t: Termo) {
    setAceitesDe(t);
    setAceites([]);
    setCarregandoAceites(true);
    try {
      const { data } = await api.get(`/admin/termos/${t.id}/aceites`);
      setAceites(Array.isArray(data) ? data : []);
    } catch (err: any) {
      notificar(mensagemErro(err, 'Erro ao carregar aceites.'), 'erro');
      setAceitesDe(null);
    } finally {
      setCarregandoAceites(false);
    }
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {toast && (
        <div
          className={`fixed top-6 right-6 z-[100] flex items-center space-x-2 px-5 py-3 rounded-xl shadow-2xl text-sm font-bold ${
            toast.tipo === 'sucesso' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
          }`}
        >
          {toast.tipo === 'sucesso' ? <Check size={18} /> : <AlertTriangle size={18} />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Cabeçalho */}
      <div className="flex items-center justify-between bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center space-x-3">
          <div className="bg-gray-800 p-2 rounded-lg text-white">
            <FileText size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Termos LGPD</h1>
            <p className="text-sm text-gray-500">Gerencie os termos legais versionados da plataforma</p>
          </div>
        </div>
        <button
          onClick={abrirNovo}
          className="flex items-center px-4 py-2.5 bg-green-700 text-white rounded-xl font-medium text-sm hover:bg-green-800 active:scale-95"
        >
          <Plus size={18} className="mr-1.5" /> Novo Termo
        </button>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs font-bold text-gray-400 uppercase bg-gray-50/60">
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Versão</th>
                <th className="px-4 py-3">Título</th>
                <th className="px-4 py-3">Resumo</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Obrigatório para</th>
                <th className="px-4 py-3">Publicado em</th>
                <th className="px-4 py-3">Hash</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 text-sm">
              {carregando ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                    Carregando…
                  </td>
                </tr>
              ) : termos.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                    Nenhum termo cadastrado.
                  </td>
                </tr>
              ) : (
                termos.map((t) => {
                  const status = statusDe(t);
                  const ehRascunho = status === 'Rascunho';
                  return (
                    <tr key={t.id} className="hover:bg-gray-50/60">
                      <td className="px-4 py-3 font-medium text-gray-700">{tipoLabel(t.tipo)}</td>
                      <td className="px-4 py-3 text-gray-500">v{t.versao}</td>
                      <td className="px-4 py-3 text-gray-700">{truncar(t.titulo, 40)}</td>
                      <td className="px-4 py-3 text-gray-500" title={t.resumo || ''}>
                        {truncar(t.resumo, 40)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${corStatus[status]}`}>
                          {status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {(t.obrigatorio_para || []).join(', ') || '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{formatarData(t.publicado_em)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400">
                        {t.conteudo_hash ? t.conteudo_hash.slice(0, 14) + '…' : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          {ehRascunho && (
                            <button
                              onClick={() => abrirEdicao(t)}
                              title="Editar rascunho"
                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"
                            >
                              <Pencil size={16} />
                            </button>
                          )}
                          {ehRascunho && (
                            <button
                              onClick={() => setPublicando(t)}
                              title="Publicar termo"
                              className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg"
                            >
                              <Send size={16} />
                            </button>
                          )}
                          <button
                            onClick={() => abrirAceites(t)}
                            title="Ver aceites"
                            className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg"
                          >
                            <Users size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Novo / Editar termo */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-800">
                {editando ? 'Editar Rascunho' : 'Novo Termo'}
              </h2>
              <button onClick={() => setShowForm(false)} className="p-2 hover:bg-gray-100 rounded-full">
                <X size={22} />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Tipo</label>
                <select
                  disabled={!!editando}
                  className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50 disabled:opacity-60"
                  value={form.tipo}
                  onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                >
                  {TIPOS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Título</label>
                <input
                  type="text"
                  className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50"
                  value={form.titulo}
                  onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Conteúdo</label>
                <textarea
                  rows={6}
                  className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50 resize-y"
                  value={form.conteudo}
                  onChange={(e) => setForm({ ...form, conteudo: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Resumo</label>
                <input
                  type="text"
                  className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50"
                  value={form.resumo}
                  onChange={(e) => setForm({ ...form, resumo: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Base legal</label>
                <input
                  type="text"
                  className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50"
                  value={form.base_legal}
                  onChange={(e) => setForm({ ...form, base_legal: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Obrigatório para</label>
                <div className="flex gap-4">
                  {(['admin', 'motorista'] as Papel[]).map((p) => (
                    <label key={p} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.obrigatorio_para.includes(p)}
                        onChange={() => togglePapel(p)}
                      />
                      {p}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={salvarForm}
                disabled={salvando}
                className="px-5 py-2 bg-green-700 text-white rounded-lg text-sm font-bold hover:bg-green-800 disabled:opacity-60"
              >
                {salvando ? 'Salvando…' : editando ? 'Salvar rascunho' : 'Criar rascunho'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirmar publicação */}
      {publicando && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100">
              <div className="bg-yellow-100 p-2 rounded-lg text-yellow-700">
                <AlertTriangle size={22} />
              </div>
              <h2 className="text-lg font-bold text-gray-800">Publicar termo</h2>
            </div>
            <div className="px-6 py-5 space-y-3">
              <p className="text-sm text-gray-600">
                <span className="font-semibold">{tipoLabel(publicando.tipo)}</span> · v{publicando.versao}
              </p>
              <p className="text-sm text-gray-700 bg-yellow-50 border border-yellow-200 rounded-xl p-3">
                Publicar este termo criará pendência no próximo login dos perfis obrigatórios. Confirma?
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100">
              <button
                onClick={() => setPublicando(null)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarPublicacao}
                disabled={confirmandoPublicacao}
                className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 disabled:opacity-60"
              >
                {confirmandoPublicacao ? 'Publicando…' : 'Confirmar publicação'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Ver aceites */}
      {aceitesDe && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-800">
                Aceites — {tipoLabel(aceitesDe.tipo)} v{aceitesDe.versao}
              </h2>
              <button onClick={() => setAceitesDe(null)} className="p-2 hover:bg-gray-100 rounded-full">
                <X size={22} />
              </button>
            </div>
            <div className="px-6 py-4 overflow-y-auto">
              {carregandoAceites ? (
                <p className="text-sm text-gray-400 py-6 text-center">Carregando…</p>
              ) : aceites.length === 0 ? (
                <p className="text-sm text-gray-400 py-6 text-center">Nenhum aceite registrado.</p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs font-bold text-gray-400 uppercase">
                      <th className="px-2 py-2">Usuário</th>
                      <th className="px-2 py-2">Email</th>
                      <th className="px-2 py-2">Aceito em</th>
                      <th className="px-2 py-2">Origem</th>
                      <th className="px-2 py-2">IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {aceites.map((a) => (
                      <tr key={a.id}>
                        <td className="px-2 py-2">
                          <div className="font-medium text-gray-700">
                            {a.usuario_nome || 'Usuário não identificado'}
                          </div>
                          <div className="font-mono text-[11px] text-gray-400">
                            {a.usuario_id || '—'}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-gray-500">{a.usuario_email || '—'}</td>
                        <td className="px-2 py-2 text-gray-500">
                          {a.aceito_em ? new Date(a.aceito_em).toLocaleString('pt-BR') : '—'}
                        </td>
                        <td className="px-2 py-2 text-gray-500">{a.origem || '—'}</td>
                        <td className="px-2 py-2 text-gray-400 font-mono text-xs">{a.ip || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
