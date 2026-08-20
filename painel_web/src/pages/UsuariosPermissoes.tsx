import { useEffect, useMemo, useState } from 'react';
import api from '../api';

// P2 — Exceções por usuário: atribuir perfil (template) e overrides individuais
// (herdar / permitir / negar) por permissão. Motorista ganha toggles de
// criar/finalizar frete e visibilidade financeira. Backend é a autoridade e
// bloqueia mudanças que deixem a empresa sem administrador.

interface PermDef { key: string; category: string; label: string; governance?: boolean; entitlementCodigo?: string }
interface Usuario { id: string; nome: string; tipo: string; status: string }
interface Template { id: string; stable_key: string; display_name: string }

type Effect = 'inherit' | 'allow' | 'deny';

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

export function UsuariosPermissoes({ permissions, templates, visModes }:
  { permissions: PermDef[]; templates: Template[]; visModes: string[] }) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [sel, setSel] = useState<Usuario | null>(null);
  const [templateId, setTemplateId] = useState<string>('');
  const [overrides, setOverrides] = useState<Record<string, Effect>>({});
  const [effective, setEffective] = useState<Record<string, boolean>>({});
  const [mot, setMot] = useState<{ pode_criar_frete?: boolean; pode_finalizar_viagem?: boolean; financial_visibility_mode?: string | null } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/admin/usuarios').then((r) => setUsuarios((r.data || []).filter((u: any) => u.id && u.nome)))
      .catch(() => setErro('Falha ao listar usuários.'));
  }, []);

  const porCategoria = useMemo(() => {
    const g: Record<string, PermDef[]> = {};
    for (const p of permissions) (g[p.category] ||= []).push(p);
    return g;
  }, [permissions]);

  const abrir = async (u: Usuario) => {
    setSel(u); setErro(null); setOk(null); setMot(null);
    try {
      const r = await api.get(`/admin/permissions/usuarios/${u.id}`);
      setTemplateId(r.data.permission_template_id || '');
      const ov: Record<string, Effect> = {};
      for (const [k, v] of Object.entries(r.data.overrides || {})) ov[k] = v as Effect;
      setOverrides(ov);
      setEffective(r.data.effective || {});
      if (u.tipo === 'motorista') {
        setMot({ financial_visibility_mode: r.data.driver_financial_visibility || 'commission_only' });
      }
    } catch (e: any) { setErro(e?.response?.data?.message || 'Falha ao carregar usuário.'); }
  };

  const effectOf = (key: string): Effect => overrides[key] || 'inherit';

  const setOverride = async (key: string, effect: Effect) => {
    if (!sel) return;
    setBusy(true); setErro(null); setOk(null);
    try {
      await api.put(`/admin/permissions/usuarios/${sel.id}/override`, { permission_key: key, effect });
      await abrir(sel);
      setOk('Exceção atualizada.');
    } catch (e: any) { setErro(e?.response?.data?.message || 'Falha ao atualizar exceção.'); }
    finally { setBusy(false); }
  };

  const salvarTemplate = async () => {
    if (!sel || !templateId) return;
    setBusy(true); setErro(null); setOk(null);
    try {
      await api.put(`/admin/permissions/usuarios/${sel.id}/template`, { template_id: templateId });
      await abrir(sel);
      setOk('Perfil do usuário atualizado.');
    } catch (e: any) { setErro(e?.response?.data?.message || 'Falha ao atribuir perfil.'); }
    finally { setBusy(false); }
  };

  const salvarMotorista = async (patch: any) => {
    if (!sel) return;
    setBusy(true); setErro(null); setOk(null);
    try {
      await api.put(`/admin/permissions/motoristas/${sel.id}`, patch);
      await abrir(sel);
      setOk('Motorista atualizado.');
    } catch (e: any) { setErro(e?.response?.data?.message || 'Falha ao atualizar motorista.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="mt-4">
      {erro && <div className="mb-3 rounded bg-red-50 text-red-700 px-4 py-2 text-sm">{erro}</div>}
      {ok && <div className="mb-3 rounded bg-green-50 text-green-700 px-4 py-2 text-sm">{ok}</div>}

      {!sel && (
        <div className="grid gap-2 sm:grid-cols-2">
          {usuarios.map((u) => (
            <button key={u.id} onClick={() => abrir(u)}
              className="text-left rounded border border-gray-200 dark:border-gray-700 p-3 hover:border-green-500 bg-white dark:bg-gray-800">
              <div className="font-medium text-gray-800 dark:text-gray-100">{u.nome}</div>
              <div className="text-xs text-gray-500">{u.tipo} · {u.status}</div>
            </button>
          ))}
          {usuarios.length === 0 && <div className="text-sm text-gray-500">Nenhum usuário.</div>}
        </div>
      )}

      {sel && (
        <div>
          <button onClick={() => setSel(null)} className="text-sm text-gray-500 hover:text-gray-700">← Voltar aos usuários</button>
          <h3 className="mt-2 text-lg font-semibold text-gray-800 dark:text-gray-100">{sel.nome} <span className="text-xs text-gray-500">({sel.tipo})</span></h3>

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-sm text-gray-700 dark:text-gray-200">
              Perfil (template)
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}
                className="ml-2 rounded border-gray-300 dark:bg-gray-700 dark:border-gray-600 text-sm">
                <option value="">—</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}
              </select>
            </label>
            <button onClick={salvarTemplate} disabled={busy || !templateId}
              className="rounded bg-green-600 text-white px-3 py-1.5 text-sm disabled:opacity-50">Atribuir perfil</button>
          </div>
          <p className="mt-1 text-xs text-gray-400">Mudar o perfil respeita a proteção do último administrador (bloqueio 409).</p>

          {sel.tipo === 'motorista' && mot && (
            <div className="mt-4 rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800 space-y-2">
              <div className="font-medium text-gray-700 dark:text-gray-200">Motorista</div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={effective['freight.create'] === true}
                  onChange={(e) => salvarMotorista({ pode_criar_frete: e.target.checked })} />
                Pode criar frete pelo app
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={effective['freight.finish'] === true}
                  onChange={(e) => salvarMotorista({ pode_finalizar_viagem: e.target.checked })} />
                Pode finalizar frete pelo app
              </label>
              <label className="block text-sm">
                Informações financeiras no app
                <select value={mot.financial_visibility_mode ?? 'commission_only'}
                  onChange={(e) => salvarMotorista({ financial_visibility_mode: e.target.value })}
                  className="ml-2 rounded border-gray-300 dark:bg-gray-700 dark:border-gray-600 text-sm">
                  {(visModes.length ? visModes : Object.keys(VIS_LABEL)).map((m) => (
                    <option key={m} value={m}>{VIS_LABEL[m] || m}</option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-gray-400">Herdado do perfil Motorista, salvo override individual acima.</p>
            </div>
          )}

          <div className="mt-4 space-y-3">
            {Object.entries(porCategoria).map(([cat, perms]) => (
              <div key={cat} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700 font-medium text-gray-700 dark:text-gray-200">{CATEGORY_LABEL[cat] || cat}</div>
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {perms.map((p) => {
                    const eff = effective[p.key] === true;
                    const cur = effectOf(p.key);
                    return (
                      <div key={p.key} className="px-4 py-2 flex items-center justify-between gap-2">
                        <div className="text-sm text-gray-700 dark:text-gray-200">
                          {p.label}
                          <span className={`ml-2 text-[10px] ${eff ? 'text-green-600' : 'text-gray-400'}`}>
                            {cur === 'inherit' ? (eff ? 'HERDADO — permitido' : 'HERDADO — não permitido')
                              : cur === 'allow' ? 'PERSONALIZADO — permitido' : 'PERSONALIZADO — negado'}
                          </span>
                        </div>
                        <select value={cur} disabled={busy}
                          onChange={(e) => setOverride(p.key, e.target.value as Effect)}
                          className="rounded border-gray-300 dark:bg-gray-700 dark:border-gray-600 text-xs">
                          <option value="inherit">Usar padrão</option>
                          <option value="allow">Permitir</option>
                          <option value="deny">Negar</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
