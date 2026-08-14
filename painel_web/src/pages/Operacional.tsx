import React, { useEffect, useMemo, useState } from 'react';
import { Building2, CheckCircle2, Globe2, MapPinned, Plus, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';

type Unidade = {
  id: string;
  nome: string;
  codigo?: string | null;
  tipo?: string | null;
  cidade?: string | null;
  uf?: string | null;
  status: string;
  is_default?: boolean;
};

type Regiao = {
  id: string;
  nome: string;
  codigo?: string | null;
  status: string;
};

type Membership = {
  id: string;
  usuario_id: string;
  scope_level: 'LOCAL' | 'REGIONAL' | 'GLOBAL';
  unidade_operacional_id?: string | null;
  regiao_operacional_id?: string | null;
  papel?: string | null;
  status: string;
};

type Grupo = {
  id: string;
  nome: string;
  status: string;
};

type Empresa = {
  id: string;
  nome: string;
};

type OperationalContext = {
  mode?: string;
};

function mensagemErro(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message || fallback;
  }
  return fallback;
}

const emptyUnit = { nome: '', codigo: '', tipo: 'operacional', cidade: '', uf: '', is_default: false };
const emptyRegion = { nome: '', codigo: '' };
const emptyMembership = { usuario_id: '', scope_level: 'LOCAL', unidade_operacional_id: '', regiao_operacional_id: '', papel: 'operador' };

export const Operacional: React.FC = () => {
  const { user } = useAuth();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState(user?.empresa_id || '');
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [regioes, setRegioes] = useState<Regiao[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [contexto, setContexto] = useState<OperationalContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [unitForm, setUnitForm] = useState(emptyUnit);
  const [regionForm, setRegionForm] = useState(emptyRegion);
  const [regionTarget, setRegionTarget] = useState('');
  const [regionUnits, setRegionUnits] = useState<string[]>([]);
  const [membershipForm, setMembershipForm] = useState(emptyMembership);
  const [grupoNome, setGrupoNome] = useState('');

  const isSuper = user?.is_super_admin === true;
  const canManage = isSuper || user?.role === 'admin';
  const selectedEmpresa = empresas.find((e) => e.id === empresaId);

  const unidadeById = useMemo(() => {
    const map = new Map<string, Unidade>();
    unidades.forEach((unidade) => map.set(unidade.id, unidade));
    return map;
  }, [unidades]);

  const regiaoById = useMemo(() => {
    const map = new Map<string, Regiao>();
    regioes.forEach((regiao) => map.set(regiao.id, regiao));
    return map;
  }, [regioes]);

  async function carregarEmpresas() {
    if (!isSuper) {
      if (user?.empresa_id) setEmpresas([{ id: user.empresa_id, nome: user.empresa_nome || 'Empresa atual' }]);
      return;
    }
    const { data } = await api.get('/painel-admin/empresas?includeArchived=true');
    const lista = (data || []).map((empresa: { id: string; nome?: string; razao_social?: string }) => ({
      id: empresa.id,
      nome: empresa.nome || empresa.razao_social || empresa.id,
    }));
    setEmpresas(lista);
    if (!empresaId && lista[0]) setEmpresaId(lista[0].id);
  }

  async function carregarTudo(targetEmpresaId = empresaId) {
    if (!targetEmpresaId) return;
    setLoading(true);
    try {
      const params = { params: { empresa_id: targetEmpresaId } };
      const [contextoRes, unidadesRes, regioesRes, membershipsRes, gruposRes] = await Promise.all([
        api.get('/operacional/contexto', params),
        api.get('/operacional/unidades', params),
        api.get('/operacional/regioes', params),
        api.get('/operacional/memberships', params),
        isSuper ? api.get('/operacional/grupos') : Promise.resolve({ data: [] }),
      ]);
      setContexto(contextoRes.data?.scope || null);
      setUnidades(unidadesRes.data || []);
      setRegioes(regioesRes.data || []);
      setMemberships(membershipsRes.data || []);
      setGrupos(gruposRes.data || []);
    } catch (error) {
      setToast({ tipo: 'erro', texto: mensagemErro(error, 'Erro ao carregar estrutura operacional.') });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      carregarEmpresas().catch(() => setToast({ tipo: 'erro', texto: 'Erro ao carregar empresas.' }));
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!empresaId) return undefined;
    const timer = window.setTimeout(() => { carregarTudo(empresaId); }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function criarUnidade(event: React.FormEvent) {
    event.preventDefault();
    if (!empresaId) return;
    setSaving(true);
    try {
      await api.post('/operacional/unidades', { ...unitForm, empresa_id: empresaId });
      setUnitForm(emptyUnit);
      setToast({ tipo: 'ok', texto: 'Unidade criada.' });
      await carregarTudo(empresaId);
    } catch (error) {
      setToast({ tipo: 'erro', texto: mensagemErro(error, 'Erro ao criar unidade.') });
    } finally {
      setSaving(false);
    }
  }

  async function criarRegiao(event: React.FormEvent) {
    event.preventDefault();
    if (!empresaId) return;
    setSaving(true);
    try {
      await api.post('/operacional/regioes', { ...regionForm, empresa_id: empresaId });
      setRegionForm(emptyRegion);
      setToast({ tipo: 'ok', texto: 'Regiao criada.' });
      await carregarTudo(empresaId);
    } catch (error) {
      setToast({ tipo: 'erro', texto: mensagemErro(error, 'Erro ao criar regiao.') });
    } finally {
      setSaving(false);
    }
  }

  async function salvarUnidadesRegiao() {
    if (!regionTarget) return;
    setSaving(true);
    try {
      await api.put(`/operacional/regioes/${regionTarget}/unidades`, { unidades: regionUnits, empresa_id: empresaId });
      setToast({ tipo: 'ok', texto: 'Regiao atualizada.' });
      setRegionTarget('');
      setRegionUnits([]);
      await carregarTudo(empresaId);
    } catch (error) {
      setToast({ tipo: 'erro', texto: mensagemErro(error, 'Erro ao atualizar regiao.') });
    } finally {
      setSaving(false);
    }
  }

  async function criarMembership(event: React.FormEvent) {
    event.preventDefault();
    if (!empresaId) return;
    setSaving(true);
    try {
      await api.post('/operacional/memberships', {
        ...membershipForm,
        empresa_id: empresaId,
        unidade_operacional_id: membershipForm.scope_level === 'LOCAL' ? membershipForm.unidade_operacional_id : null,
        regiao_operacional_id: membershipForm.scope_level === 'REGIONAL' ? membershipForm.regiao_operacional_id : null,
      });
      setMembershipForm(emptyMembership);
      setToast({ tipo: 'ok', texto: 'Escopo concedido.' });
      await carregarTudo(empresaId);
    } catch (error) {
      setToast({ tipo: 'erro', texto: mensagemErro(error, 'Erro ao conceder escopo.') });
    } finally {
      setSaving(false);
    }
  }

  async function revogarMembership(id: string) {
    setSaving(true);
    try {
      await api.patch(`/operacional/memberships/${id}/revogar`, { motivo: 'Revogado pelo painel operacional.' });
      setToast({ tipo: 'ok', texto: 'Escopo revogado.' });
      await carregarTudo(empresaId);
    } catch (error) {
      setToast({ tipo: 'erro', texto: mensagemErro(error, 'Erro ao revogar escopo.') });
    } finally {
      setSaving(false);
    }
  }

  async function criarGrupo(event: React.FormEvent) {
    event.preventDefault();
    if (!grupoNome.trim()) return;
    setSaving(true);
    try {
      await api.post('/operacional/grupos', { nome: grupoNome.trim() });
      setGrupoNome('');
      setToast({ tipo: 'ok', texto: 'Grupo criado.' });
      await carregarTudo(empresaId);
    } catch (error) {
      setToast({ tipo: 'erro', texto: mensagemErro(error, 'Erro ao criar grupo.') });
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h1 className="text-xl font-bold text-gray-900">Operacao</h1>
        <p className="mt-2 text-sm text-gray-600">Seu perfil nao administra escopos operacionais.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-20 right-6 z-30 rounded-lg px-4 py-3 text-sm font-semibold shadow ${toast.tipo === 'ok' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.texto}
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Operacao</h1>
          <p className="mt-1 text-sm text-gray-500">Grupos empresariais, unidades, regioes e escopos de acesso.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {isSuper && (
            <select
              value={empresaId}
              onChange={(event) => setEmpresaId(event.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800"
            >
              <option value="">Selecione uma empresa</option>
              {empresas.map((empresa) => <option key={empresa.id} value={empresa.id}>{empresa.nome}</option>)}
            </select>
          )}
          <button
            onClick={() => carregarTudo(empresaId)}
            disabled={loading || !empresaId}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 text-gray-500"><Building2 size={18} /> Empresa</div>
          <p className="mt-2 truncate text-lg font-bold text-gray-900">{selectedEmpresa?.nome || user?.empresa_nome || '-'}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 text-gray-500"><Globe2 size={18} /> Modo</div>
          <p className="mt-2 text-lg font-bold text-gray-900">{contexto?.mode || 'LEGACY'}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 text-gray-500"><MapPinned size={18} /> Unidades</div>
          <p className="mt-2 text-lg font-bold text-gray-900">{unidades.length}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 text-gray-500"><ShieldCheck size={18} /> Escopos ativos</div>
          <p className="mt-2 text-lg font-bold text-gray-900">{memberships.filter((m) => m.status === 'ativo').length}</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-gray-900">Unidades operacionais</h2>
            <span className="text-xs font-semibold text-gray-400">{loading ? 'Carregando' : `${unidades.length} registros`}</span>
          </div>
          <form onSubmit={criarUnidade} className="mt-4 grid gap-3 md:grid-cols-6">
            <input value={unitForm.nome} onChange={(e) => setUnitForm({ ...unitForm, nome: e.target.value })} required placeholder="Nome" className="md:col-span-2 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <input value={unitForm.codigo} onChange={(e) => setUnitForm({ ...unitForm, codigo: e.target.value })} placeholder="Codigo" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <input value={unitForm.cidade} onChange={(e) => setUnitForm({ ...unitForm, cidade: e.target.value })} placeholder="Cidade" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <input value={unitForm.uf} onChange={(e) => setUnitForm({ ...unitForm, uf: e.target.value.toUpperCase().slice(0, 2) })} placeholder="UF" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <label className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700">
              <input type="checkbox" checked={unitForm.is_default} onChange={(e) => setUnitForm({ ...unitForm, is_default: e.target.checked })} />
              Padrao
            </label>
            <button disabled={saving || !empresaId} className="md:col-span-6 inline-flex items-center justify-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-60">
              <Plus size={16} /> Criar unidade
            </button>
          </form>
          <div className="mt-5 overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr><th className="px-3 py-2">Nome</th><th className="px-3 py-2">Local</th><th className="px-3 py-2">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {unidades.map((unidade) => (
                  <tr key={unidade.id}>
                    <td className="px-3 py-2 font-medium text-gray-900">{unidade.nome}{unidade.is_default && <span className="ml-2 rounded bg-green-50 px-2 py-0.5 text-xs text-green-700">padrao</span>}</td>
                    <td className="px-3 py-2 text-gray-600">{[unidade.cidade, unidade.uf].filter(Boolean).join(' / ') || '-'}</td>
                    <td className="px-3 py-2 text-gray-600">{unidade.status}</td>
                  </tr>
                ))}
                {!unidades.length && <tr><td colSpan={3} className="px-3 py-6 text-center text-gray-500">Nenhuma unidade cadastrada.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-gray-900">Regioes</h2>
            <MapPinned size={18} className="text-gray-400" />
          </div>
          <form onSubmit={criarRegiao} className="mt-4 grid gap-3 md:grid-cols-5">
            <input value={regionForm.nome} onChange={(e) => setRegionForm({ ...regionForm, nome: e.target.value })} required placeholder="Nome da regiao" className="md:col-span-3 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <input value={regionForm.codigo} onChange={(e) => setRegionForm({ ...regionForm, codigo: e.target.value })} placeholder="Codigo" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <button disabled={saving || !empresaId} className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-60"><Plus size={16} /> Criar</button>
          </form>
          <div className="mt-5 space-y-3">
            <select value={regionTarget} onChange={(e) => { setRegionTarget(e.target.value); setRegionUnits([]); }} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">Selecione uma regiao para vincular unidades</option>
              {regioes.map((regiao) => <option key={regiao.id} value={regiao.id}>{regiao.nome}</option>)}
            </select>
            {regionTarget && (
              <div className="rounded-lg border border-gray-200 p-3">
                <div className="grid gap-2 md:grid-cols-2">
                  {unidades.map((unidade) => (
                    <label key={unidade.id} className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={regionUnits.includes(unidade.id)}
                        onChange={(e) => setRegionUnits((current) => e.target.checked ? [...current, unidade.id] : current.filter((id) => id !== unidade.id))}
                      />
                      {unidade.nome}
                    </label>
                  ))}
                </div>
                <button onClick={salvarUnidadesRegiao} disabled={saving} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-green-700 px-4 py-2 text-sm font-semibold text-green-700 hover:bg-green-50 disabled:opacity-60" type="button">
                  <CheckCircle2 size={16} /> Salvar vinculos
                </button>
              </div>
            )}
            <div className="grid gap-2">
              {regioes.map((regiao) => <div key={regiao.id} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-800">{regiao.nome} <span className="text-gray-400">{regiao.codigo || ''}</span></div>)}
              {!regioes.length && <p className="py-4 text-center text-sm text-gray-500">Nenhuma regiao cadastrada.</p>}
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-gray-900">Escopos de usuarios</h2>
          <Users size={18} className="text-gray-400" />
        </div>
        <form onSubmit={criarMembership} className="mt-4 grid gap-3 lg:grid-cols-6">
          <input value={membershipForm.usuario_id} onChange={(e) => setMembershipForm({ ...membershipForm, usuario_id: e.target.value })} required placeholder="ID do usuario" className="lg:col-span-2 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          <select value={membershipForm.scope_level} onChange={(e) => setMembershipForm({ ...membershipForm, scope_level: e.target.value as Membership['scope_level'], unidade_operacional_id: '', regiao_operacional_id: '' })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option value="LOCAL">Local</option>
            <option value="REGIONAL">Regional</option>
            <option value="GLOBAL">Global</option>
          </select>
          {membershipForm.scope_level === 'LOCAL' ? (
            <select value={membershipForm.unidade_operacional_id} onChange={(e) => setMembershipForm({ ...membershipForm, unidade_operacional_id: e.target.value })} required className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">Unidade</option>
              {unidades.map((unidade) => <option key={unidade.id} value={unidade.id}>{unidade.nome}</option>)}
            </select>
          ) : membershipForm.scope_level === 'REGIONAL' ? (
            <select value={membershipForm.regiao_operacional_id} onChange={(e) => setMembershipForm({ ...membershipForm, regiao_operacional_id: e.target.value })} required className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">Regiao</option>
              {regioes.map((regiao) => <option key={regiao.id} value={regiao.id}>{regiao.nome}</option>)}
            </select>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-500">Todas as unidades</div>
          )}
          <input value={membershipForm.papel} onChange={(e) => setMembershipForm({ ...membershipForm, papel: e.target.value })} placeholder="Papel" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          <button disabled={saving || !empresaId} className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-60"><ShieldCheck size={16} /> Conceder</button>
        </form>
        <div className="mt-5 overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr><th className="px-3 py-2">Usuario</th><th className="px-3 py-2">Escopo</th><th className="px-3 py-2">Destino</th><th className="px-3 py-2">Status</th><th className="px-3 py-2"></th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {memberships.map((membership) => (
                <tr key={membership.id}>
                  <td className="px-3 py-2 font-mono text-xs text-gray-700">{membership.usuario_id}</td>
                  <td className="px-3 py-2 font-semibold text-gray-900">{membership.scope_level}</td>
                  <td className="px-3 py-2 text-gray-600">
                    {membership.scope_level === 'LOCAL'
                      ? unidadeById.get(membership.unidade_operacional_id || '')?.nome || membership.unidade_operacional_id || '-'
                      : membership.scope_level === 'REGIONAL'
                        ? regiaoById.get(membership.regiao_operacional_id || '')?.nome || membership.regiao_operacional_id || '-'
                        : 'Todas'}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{membership.status}</td>
                  <td className="px-3 py-2 text-right">
                    {membership.status === 'ativo' && (
                      <button type="button" onClick={() => revogarMembership(membership.id)} className="text-sm font-semibold text-red-600 hover:text-red-700">Revogar</button>
                    )}
                  </td>
                </tr>
              ))}
              {!memberships.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">Nenhum escopo concedido.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {isSuper && (
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-gray-900">Grupos empresariais</h2>
            <Globe2 size={18} className="text-gray-400" />
          </div>
          <form onSubmit={criarGrupo} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input value={grupoNome} onChange={(e) => setGrupoNome(e.target.value)} placeholder="Nome do grupo" className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <button disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-60"><Plus size={16} /> Criar grupo</button>
          </form>
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            {grupos.map((grupo) => <div key={grupo.id} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-800">{grupo.nome} <span className="text-gray-400">{grupo.status}</span></div>)}
            {!grupos.length && <p className="text-sm text-gray-500">Nenhum grupo cadastrado.</p>}
          </div>
        </section>
      )}
    </div>
  );
};
