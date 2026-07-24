import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Plus, Ticket, X, Power } from 'lucide-react';
import api from '../api';

// FASE 6 (MEGA-FRENTE Billing Comercial Avançado) — painel de PROMOÇÕES.
// Consome os endpoints super-admin de painel-admin.js. Enquanto a migration 040
// não for aplicada, o backend responde 503 e a tela mostra um aviso claro em vez
// de quebrar.

type TipoPromocao =
  | 'desconto_percentual_mensalidade'
  | 'desconto_fixo_mensalidade'
  | 'desconto_percentual_implantacao'
  | 'desconto_fixo_implantacao'
  | 'isencao_implantacao'
  | 'trial_estendido'
  | 'preco_promocional';

type PromocaoCodigo = {
  id: string;
  codigo: string;
  limite_usos: number | null;
  usos: number;
  ativo: boolean;
};

type Promocao = {
  id: string;
  nome: string;
  descricao: string | null;
  tipo: TipoPromocao;
  percentual: number | null;
  valor: number | null;
  duracao_meses: number | null;
  dias_trial_extra: number | null;
  data_inicio: string;
  data_fim: string;
  ativo: boolean;
  limite_usos_total: number | null;
  usos_total: number;
  uso_unico_por_empresa: boolean;
  promocao_codigos?: PromocaoCodigo[];
};

const TIPOS: { chave: TipoPromocao; titulo: string; campo: 'percentual' | 'valor' | 'dias' | 'nenhum' }[] = [
  { chave: 'desconto_percentual_mensalidade', titulo: 'Desconto % na mensalidade', campo: 'percentual' },
  { chave: 'desconto_fixo_mensalidade', titulo: 'Desconto fixo na mensalidade', campo: 'valor' },
  { chave: 'preco_promocional', titulo: 'Preço promocional (mensalidade)', campo: 'valor' },
  { chave: 'desconto_percentual_implantacao', titulo: 'Desconto % na implantação', campo: 'percentual' },
  { chave: 'desconto_fixo_implantacao', titulo: 'Desconto fixo na implantação', campo: 'valor' },
  { chave: 'isencao_implantacao', titulo: 'Isenção de implantação', campo: 'nenhum' },
  { chave: 'trial_estendido', titulo: 'Trial estendido (dias)', campo: 'dias' },
];

const FORM_VAZIO = {
  nome: '',
  tipo: 'desconto_percentual_mensalidade' as TipoPromocao,
  percentual: '',
  valor: '',
  duracao_meses: '',
  dias_trial_extra: '',
  data_inicio: '',
  data_fim: '',
  limite_usos_total: '',
  uso_unico_por_empresa: true,
  plano_alvo_id: '',
};

function tituloTipo(tipo: TipoPromocao): string {
  return TIPOS.find((t) => t.chave === tipo)?.titulo ?? tipo;
}

function campoDoTipo(tipo: TipoPromocao): 'percentual' | 'valor' | 'dias' | 'nenhum' {
  return TIPOS.find((t) => t.chave === tipo)?.campo ?? 'nenhum';
}

export function PainelPromocoes() {
  const [promocoes, setPromocoes] = useState<Promocao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [naoProvisionado, setNaoProvisionado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [form, setForm] = useState({ ...FORM_VAZIO });
  const [salvando, setSalvando] = useState(false);
  const [novoCodigo, setNovoCodigo] = useState<Record<string, string>>({});
  const [novoLimite, setNovoLimite] = useState<Record<string, string>>({});
  const [planos, setPlanos] = useState<{ id: string; nome: string }[]>([]);
  const [manual, setManual] = useState<Record<string, string>>({}); // promoId -> empresa_id
  const [manualMsg, setManualMsg] = useState<Record<string, string>>({});

  async function carregar() {
    setCarregando(true);
    setErro(null);
    try {
      const { data } = await api.get('/painel-admin/promocoes');
      setPromocoes(Array.isArray(data) ? data : []);
      setNaoProvisionado(false);
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 503) setNaoProvisionado(true);
      else setErro('Não foi possível carregar as promoções.');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
    api.get('/painel-admin/planos')
      .then(({ data }) => setPlanos((Array.isArray(data) ? data : []).map((p: { id: string; nome: string }) => ({ id: p.id, nome: p.nome }))))
      .catch(() => setPlanos([]));
  }, []);

  async function criar(ev: React.FormEvent) {
    ev.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      const payload: Record<string, unknown> = {
        nome: form.nome,
        tipo: form.tipo,
        data_inicio: form.data_inicio,
        data_fim: form.data_fim,
        uso_unico_por_empresa: form.uso_unico_por_empresa,
      };
      const campo = campoDoTipo(form.tipo);
      if (campo === 'percentual' && form.percentual) payload.percentual = Number(form.percentual);
      if (campo === 'valor' && form.valor) payload.valor = Number(form.valor);
      if (campo === 'dias' && form.dias_trial_extra) payload.dias_trial_extra = Number(form.dias_trial_extra);
      if (form.tipo === 'preco_promocional' && form.duracao_meses) payload.duracao_meses = Number(form.duracao_meses);
      if (form.limite_usos_total) payload.limite_usos_total = Number(form.limite_usos_total);
      if (form.plano_alvo_id) payload.plano_alvo_id = form.plano_alvo_id;

      await api.post('/painel-admin/promocoes', payload);
      setForm({ ...FORM_VAZIO });
      await carregar();
    } catch (e: unknown) {
      const resp = (e as { response?: { status?: number; data?: { message?: string } } })?.response;
      if (resp?.status === 503) setNaoProvisionado(true);
      else setErro(resp?.data?.message ?? 'Não foi possível criar a promoção.');
    } finally {
      setSalvando(false);
    }
  }

  async function alternarAtivo(p: Promocao) {
    try {
      await api.patch(`/painel-admin/promocoes/${p.id}`, { ativo: !p.ativo });
      await carregar();
    } catch {
      setErro('Não foi possível alterar o status.');
    }
  }

  async function gerarCodigo(p: Promocao) {
    const codigo = (novoCodigo[p.id] || '').trim();
    if (!codigo) return;
    const lim = (novoLimite[p.id] || '').trim();
    try {
      await api.post(`/painel-admin/promocoes/${p.id}/codigos`, { codigo, limite_usos: lim ? Number(lim) : undefined });
      setNovoCodigo((s) => ({ ...s, [p.id]: '' }));
      setNovoLimite((s) => ({ ...s, [p.id]: '' }));
      await carregar();
    } catch (e: unknown) {
      const resp = (e as { response?: { status?: number; data?: { message?: string } } })?.response;
      setErro(resp?.data?.message ?? 'Não foi possível gerar o código.');
    }
  }

  // Aplicação MANUAL do super-admin a uma empresa (fura janela/ativo; respeita
  // limites). Vale inclusive após a campanha expirar.
  async function aplicarManual(p: Promocao) {
    const empresa_id = (manual[p.id] || '').trim();
    if (!empresa_id) return;
    setManualMsg((s) => ({ ...s, [p.id]: '' }));
    try {
      await api.post(`/painel-admin/promocoes/${p.id}/aplicar`, { empresa_id, motivo: 'aplicacao_manual_painel' });
      setManual((s) => ({ ...s, [p.id]: '' }));
      setManualMsg((s) => ({ ...s, [p.id]: 'Aplicada ✓' }));
      await carregar();
    } catch (e: unknown) {
      const resp = (e as { response?: { data?: { message?: string } } })?.response;
      setManualMsg((s) => ({ ...s, [p.id]: resp?.data?.message ?? 'Falha ao aplicar.' }));
    }
  }

  const campoAtual = campoDoTipo(form.tipo);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Ticket className="text-green-700" />
        <h1 className="text-2xl font-bold">Promoções e Tickets</h1>
      </div>

      {naoProvisionado && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-800">
          <AlertTriangle className="mt-0.5 shrink-0" size={18} />
          <div>
            <strong>Recurso ainda não provisionado.</strong> As tabelas de promoções (migration 040)
            ainda não foram aplicadas ao banco. Aplique a migration para habilitar a criação de campanhas.
          </div>
        </div>
      )}

      {erro && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-red-700">
          <X size={18} /> {erro}
        </div>
      )}

      {/* Criar campanha */}
      <form onSubmit={criar} className="mb-8 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-3 flex items-center gap-2 font-semibold"><Plus size={18} /> Nova campanha</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col text-sm">
            Nome da campanha
            <input className="mt-1 rounded border border-gray-300 p-2 dark:bg-gray-900" value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })} required />
          </label>
          <label className="flex flex-col text-sm">
            Tipo
            <select className="mt-1 rounded border border-gray-300 p-2 dark:bg-gray-900" value={form.tipo}
              onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoPromocao })}>
              {TIPOS.map((t) => <option key={t.chave} value={t.chave}>{t.titulo}</option>)}
            </select>
          </label>
          {campoAtual === 'percentual' && (
            <label className="flex flex-col text-sm">
              Percentual (%)
              <input type="number" min="0" max="100" step="0.01" className="mt-1 rounded border border-gray-300 p-2 dark:bg-gray-900"
                value={form.percentual} onChange={(e) => setForm({ ...form, percentual: e.target.value })} required />
            </label>
          )}
          {campoAtual === 'valor' && (
            <label className="flex flex-col text-sm">
              Valor (R$)
              <input type="number" min="0" step="0.01" className="mt-1 rounded border border-gray-300 p-2 dark:bg-gray-900"
                value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} required />
            </label>
          )}
          {campoAtual === 'dias' && (
            <label className="flex flex-col text-sm">
              Dias extras de trial
              <input type="number" min="1" step="1" className="mt-1 rounded border border-gray-300 p-2 dark:bg-gray-900"
                value={form.dias_trial_extra} onChange={(e) => setForm({ ...form, dias_trial_extra: e.target.value })} required />
            </label>
          )}
          {form.tipo === 'preco_promocional' && (
            <label className="flex flex-col text-sm">
              Duração (meses)
              <input type="number" min="1" step="1" className="mt-1 rounded border border-gray-300 p-2 dark:bg-gray-900"
                value={form.duracao_meses} onChange={(e) => setForm({ ...form, duracao_meses: e.target.value })} />
            </label>
          )}
          <label className="flex flex-col text-sm">
            Início
            <input type="datetime-local" className="mt-1 rounded border border-gray-300 p-2 dark:bg-gray-900"
              value={form.data_inicio} onChange={(e) => setForm({ ...form, data_inicio: e.target.value })} required />
          </label>
          <label className="flex flex-col text-sm">
            Fim
            <input type="datetime-local" className="mt-1 rounded border border-gray-300 p-2 dark:bg-gray-900"
              value={form.data_fim} onChange={(e) => setForm({ ...form, data_fim: e.target.value })} required />
          </label>
          <label className="flex flex-col text-sm">
            Limite de usos total (vazio = ilimitado)
            <input type="number" min="0" step="1" className="mt-1 rounded border border-gray-300 p-2 dark:bg-gray-900"
              value={form.limite_usos_total} onChange={(e) => setForm({ ...form, limite_usos_total: e.target.value })} />
          </label>
          <label className="flex flex-col text-sm">
            Plano-alvo (vazio = todos)
            <select className="mt-1 rounded border border-gray-300 p-2 dark:bg-gray-900"
              value={form.plano_alvo_id} onChange={(e) => setForm({ ...form, plano_alvo_id: e.target.value })}>
              <option value="">Todos os planos</option>
              {planos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={form.uso_unico_por_empresa}
              onChange={(e) => setForm({ ...form, uso_unico_por_empresa: e.target.checked })} />
            Uso único por empresa
          </label>
        </div>
        <button type="submit" disabled={salvando}
          className="mt-4 flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 font-medium text-white disabled:opacity-60">
          <Check size={18} /> {salvando ? 'Salvando…' : 'Criar campanha'}
        </button>
      </form>

      {/* Lista */}
      {carregando ? (
        <p className="text-gray-500">Carregando…</p>
      ) : promocoes.length === 0 && !naoProvisionado ? (
        <p className="text-gray-500">Nenhuma campanha cadastrada.</p>
      ) : (
        <div className="space-y-4">
          {promocoes.map((p) => (
            <div key={p.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{p.nome}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${p.ativo ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                      {p.ativo ? 'Ativa' : 'Inativa'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500">{tituloTipo(p.tipo)}</p>
                  <p className="text-xs text-gray-400">
                    {new Date(p.data_inicio).toLocaleDateString()} — {new Date(p.data_fim).toLocaleDateString()} ·
                    {' '}usos: {p.usos_total}{p.limite_usos_total != null ? `/${p.limite_usos_total}` : ''}
                    {p.uso_unico_por_empresa ? ' · uso único/empresa' : ''}
                  </p>
                </div>
                <button onClick={() => alternarAtivo(p)}
                  className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1 text-sm dark:border-gray-600">
                  <Power size={14} /> {p.ativo ? 'Desativar' : 'Ativar'}
                </button>
              </div>

              {/* Códigos */}
              <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-700">
                <div className="mb-2 flex flex-wrap gap-2">
                  {(p.promocao_codigos ?? []).map((c) => (
                    <span key={c.id} className="rounded bg-gray-100 px-2 py-1 text-xs font-mono dark:bg-gray-900">
                      {c.codigo} · {c.usos}{c.limite_usos != null ? `/${c.limite_usos}` : ''}{c.ativo ? '' : ' (off)'}
                    </span>
                  ))}
                  {(p.promocao_codigos ?? []).length === 0 && <span className="text-xs text-gray-400">Sem códigos ainda.</span>}
                </div>
                <div className="flex gap-2">
                  <input placeholder="NOVO-CODIGO" value={novoCodigo[p.id] ?? ''}
                    onChange={(e) => setNovoCodigo((s) => ({ ...s, [p.id]: e.target.value }))}
                    className="flex-1 rounded border border-gray-300 p-1.5 text-sm font-mono dark:bg-gray-900" />
                  <input type="number" min="0" placeholder="limite" value={novoLimite[p.id] ?? ''}
                    onChange={(e) => setNovoLimite((s) => ({ ...s, [p.id]: e.target.value }))}
                    className="w-20 rounded border border-gray-300 p-1.5 text-sm dark:bg-gray-900" />
                  <button onClick={() => gerarCodigo(p)}
                    className="flex items-center gap-1 rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-white">
                    <Ticket size={14} /> Gerar
                  </button>
                </div>
              </div>

              {/* Aplicação manual (super-admin) — vale mesmo após expirar */}
              <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-700">
                <p className="mb-1 text-xs text-gray-500">Aplicar manualmente a uma empresa (ID):</p>
                <div className="flex gap-2">
                  <input placeholder="empresa_id (uuid)" value={manual[p.id] ?? ''}
                    onChange={(e) => setManual((s) => ({ ...s, [p.id]: e.target.value }))}
                    className="flex-1 rounded border border-gray-300 p-1.5 text-xs font-mono dark:bg-gray-900" />
                  <button onClick={() => aplicarManual(p)}
                    className="rounded-lg bg-green-700 px-3 py-1.5 text-sm text-white">Aplicar</button>
                </div>
                {manualMsg[p.id] && <p className="mt-1 text-xs text-gray-600">{manualMsg[p.id]}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default PainelPromocoes;
