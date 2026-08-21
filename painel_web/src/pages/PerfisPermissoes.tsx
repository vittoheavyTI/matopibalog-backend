import { useEffect, useMemo, useState } from 'react';
import api from '../api';
import { UsuariosPermissoes } from './UsuariosPermissoes';

// P2 — Perfis e Permissões (templates da empresa + visibility policy do motorista).
// A empresa define o PADRÃO por perfil; usuários herdam; overrides individuais
// tratam exceções (feitos na tela do usuário/motorista). Backend é a autoridade.

interface PermDef { key: string; category: string; label: string; scoped?: boolean; governance?: boolean; entitlementCodigo?: string }
interface Template {
  id: string; stable_key: string; display_name: string; descricao?: string;
  is_system_baseline: boolean; editable: boolean;
  driver_financial_visibility_mode: string | null;
  permissions: Record<string, boolean>; user_count: number;
}

const CATEGORY_LABEL: Record<string, string> = {
  company: 'Empresa', users: 'Usuários', permissions: 'Permissões', freight: 'Fretes',
  launch: 'Lançamentos', documents: 'Documentos', drivers: 'Motoristas', fleet: 'Frota',
  'finance.operational': 'Financeiro operacional', 'finance.saas': 'Financeiro SaaS',
  reports: 'Relatórios', governance: 'Governança / Integrações',
};

const VIS_LABEL: Record<string, string> = {
  commission_only: 'Somente minha comissão',
  commission_plus_base: 'Comissão + valor-base',
  full_freight_financial: 'Financeiro completo do frete',
};

export function PerfisPermissoes() {
  const [permissions, setPermissions] = useState<PermDef[]>([]);
  const [uiEnabled, setUiEnabled] = useState<string[]>([]);
  const [visModes, setVisModes] = useState<string[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<Template | null>(null);
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [draftVis, setDraftVis] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [tab, setTab] = useState<'perfis' | 'usuarios'>('perfis');

  const carregar = async () => {
    setLoading(true); setErro(null);
    try {
      const [reg, tpl] = await Promise.all([
        api.get('/admin/permissions/registry'),
        api.get('/admin/permissions/templates'),
      ]);
      setPermissions(reg.data.permissions || []);
      setUiEnabled(reg.data.ui_enabled_templates || []);
      setVisModes(reg.data.financial_visibility_modes || []);
      setTemplates(tpl.data.templates || []);
    } catch (e: any) {
      setErro(e?.response?.data?.message || 'Falha ao carregar perfis.');
    } finally { setLoading(false); }
  };
  useEffect(() => { carregar(); }, []);

  const abrir = (t: Template) => {
    setSelected(t);
    setDraft({ ...t.permissions });
    setDraftVis(t.driver_financial_visibility_mode);
    setOk(null); setErro(null);
  };

  const porCategoria = useMemo(() => {
    const g: Record<string, PermDef[]> = {};
    for (const p of permissions) { (g[p.category] ||= []).push(p); }
    return g;
  }, [permissions]);

  const toggle = (key: string) => setDraft((d) => ({ ...d, [key]: !d[key] }));

  const salvar = async () => {
    if (!selected) return;
    setSaving(true); setErro(null); setOk(null);
    try {
      await api.put(`/admin/permissions/templates/${selected.id}`, {
        permissions: draft,
        driver_financial_visibility_mode: selected.stable_key === 'motorista' ? draftVis : undefined,
      });
      setOk('Perfil atualizado. Usuários sem override individual passam a seguir este padrão.');
      await carregar();
      setSelected(null);
    } catch (e: any) {
      setErro(e?.response?.data?.message || 'Falha ao salvar.');
    } finally { setSaving(false); }
  };

  const visiveis = templates.filter((t) => uiEnabled.includes(t.stable_key));
  const preparados = templates.filter((t) => !uiEnabled.includes(t.stable_key));

  if (loading) return <div className="p-6 text-gray-500">Carregando perfis…</div>;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Perfis e Permissões</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        Defina o <strong>padrão de permissões por perfil</strong> da sua empresa. Ao cadastrar um usuário,
        ele herda o perfil — sem marcar permissão por permissão. Exceções individuais são feitas como
        <em> override</em> na tela do usuário. Entitlements do plano e escopo de filial continuam valendo
        acima das permissões.
      </p>

      <div className="mt-4 flex gap-2 border-b border-gray-200 dark:border-gray-700">
        {(['perfis', 'usuarios'] as const).map((t) => (
          <button key={t} onClick={() => { setTab(t); setSelected(null); }}
            className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === t ? 'border-green-600 text-green-700 dark:text-green-400 font-medium' : 'border-transparent text-gray-500'}`}>
            {t === 'perfis' ? 'Perfis' : 'Usuários e exceções'}
          </button>
        ))}
      </div>

      {erro && <div className="mt-4 rounded bg-red-50 text-red-700 px-4 py-2 text-sm">{erro}</div>}
      {ok && <div className="mt-4 rounded bg-green-50 text-green-700 px-4 py-2 text-sm">{ok}</div>}

      {tab === 'usuarios' && (
        <UsuariosPermissoes permissions={permissions} templates={templates} visModes={visModes} />
      )}

      {tab === 'perfis' && !selected && (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {visiveis.map((t) => (
              <button key={t.id} onClick={() => abrir(t)}
                className="text-left rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:border-green-500 hover:shadow transition bg-white dark:bg-gray-800">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-800 dark:text-gray-100">{t.display_name}</span>
                  <span className="text-xs text-gray-500">{t.user_count} usuário(s)</span>
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t.descricao}</p>
                <span className="mt-2 inline-block text-xs text-green-700 dark:text-green-400">Editar permissões →</span>
              </button>
            ))}
          </div>
          {preparados.length > 0 && (
            <details className="mt-6">
              <summary className="cursor-pointer text-sm text-gray-500">Perfis preparados (ainda não usados pela interface)</summary>
              <div className="mt-2 flex flex-wrap gap-2">
                {preparados.map((t) => (
                  <span key={t.id} className="text-xs rounded bg-gray-100 dark:bg-gray-700 px-2 py-1 text-gray-600 dark:text-gray-300">{t.display_name}</span>
                ))}
              </div>
            </details>
          )}
        </>
      )}

      {tab === 'perfis' && selected && (
        <div className="mt-6">
          <button onClick={() => setSelected(null)} className="text-sm text-gray-500 hover:text-gray-700">← Voltar aos perfis</button>
          <h2 className="mt-2 text-xl font-semibold text-gray-800 dark:text-gray-100">{selected.display_name}</h2>
          <p className="text-xs text-gray-500">{selected.descricao}</p>

          {selected.stable_key === 'motorista' && (
            <div className="mt-4 rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">Informações financeiras no app (padrão)</label>
              <select value={draftVis ?? 'commission_only'} onChange={(e) => setDraftVis(e.target.value)}
                className="mt-1 rounded border-gray-300 dark:bg-gray-700 dark:border-gray-600 text-sm">
                {(visModes.length ? visModes : Object.keys(VIS_LABEL)).map((m) => (
                  <option key={m} value={m}>{VIS_LABEL[m] || m}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">Controla o que o motorista vê no aplicativo. O backend omite os campos não autorizados.</p>
            </div>
          )}

          <div className="mt-4 space-y-4">
            {Object.entries(porCategoria).map(([cat, perms]) => (
              <div key={cat} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700 font-medium text-gray-700 dark:text-gray-200">
                  {CATEGORY_LABEL[cat] || cat}
                </div>
                <div className="p-3 grid gap-2 sm:grid-cols-2">
                  {perms.map((p) => (
                    <label key={p.key} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200">
                      <input type="checkbox" checked={draft[p.key] === true} onChange={() => toggle(p.key)} className="mt-0.5" />
                      <span>
                        {p.label}
                        {p.governance && <span className="ml-1 text-[10px] text-amber-600">(governança)</span>}
                        {p.entitlementCodigo && <span className="ml-1 text-[10px] text-blue-500">(requer plano)</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex gap-2">
            <button onClick={salvar} disabled={saving}
              className="rounded bg-green-600 text-white px-4 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50">
              {saving ? 'Salvando…' : 'Salvar padrão do perfil'}
            </button>
            <button onClick={() => setSelected(null)} className="rounded border px-4 py-2 text-sm">Cancelar</button>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            Alterar o padrão afeta todos os usuários deste perfil que não tenham override individual.
            Permissões marcadas como <em>requer plano</em> só valem se o entitlement estiver ativo.
          </p>
        </div>
      )}
    </div>
  );
}
