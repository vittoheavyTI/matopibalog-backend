import React, { useEffect, useState } from 'react';
import { CheckCircle2, Info, Calculator, TrendingUp } from 'lucide-react';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';
import { PlanosVitrine } from './PlanosVitrine';
import { normalizarRecursos } from '../utils/planosCatalogo';
import type { PlanoPublico } from '../utils/planosCatalogo';
import { useLoginConfig } from '../hooks/useLoginConfig';
import { montarLinkComercial } from '../utils/contatoComercial';
import { mensagemErro } from '../utils/mensagemErro';

// Comparador de planos embutido na aba "Plano e contratação".
//
// REGRA DESTA FRENTE (decisão do proprietário): escolher/solicitar um plano usa a
// AQUISIÇÃO EXPLÍCITA (POST /contratacao/iniciar), que cria uma proposta/contrato
// SEM cobrança e SEM tocar Asaas/Billing. NÃO usa o caminho pago
// (/pagamentos/upgrade/solicitar) e NÃO altera empresa.plano_id sozinho: o teste
// real de planos maiores continua via super-admin no painel. O trial não é
// encurtado. ERP/SSO aparecem como "Em breve" (matriz do catálogo), sem preço.
export const ComparadorPlanos: React.FC = () => {
  const { user } = useAuth();
  const { contactEmail, contactPhone, whatsappSuporte } = useLoginConfig();
  const [planos, setPlanos] = useState<PlanoPublico[]>([]);
  const [planoAtualId, setPlanoAtualId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  const categoria = user?.empresa_tipo === 'autonomo' ? 'autonomo' : 'empresa';

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    Promise.all([
      api.get(`/planos/publicos?categoria=${categoria}`).catch(() => ({ data: { planos: [] } })),
      api.get('/contratacao/status').catch(() => ({ data: {} })),
    ])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(([planosRes, statusRes]: [any, any]) => {
        if (!vivo) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const brutos: any[] = planosRes?.data?.planos || [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lista: PlanoPublico[] = brutos.map((p: any) => ({
          ...p,
          preco_mensal: Number(p.preco_mensal) || 0,
          modelo_cobranca: p.modelo_cobranca === 'por_motorista' ? 'por_motorista' : 'fixo',
          preco_por_motorista: p.preco_por_motorista != null ? Number(p.preco_por_motorista) : null,
          recursos: normalizarRecursos(p.recursos),
        }));
        setPlanos(lista);
        setPlanoAtualId(statusRes?.data?.plano_id || null);
        if (!lista.length) setErro('Nenhum plano disponível para comparação agora.');
      })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [categoria]);

  async function escolher(plano: PlanoPublico) {
    if (plano.requer_negociacao) return;
    if (plano.id === planoAtualId) { setAviso('Este já é o seu plano atual.'); setSucesso(null); return; }
    setEnviando(plano.id);
    setAviso(null);
    setSucesso(null);
    setErro('');
    try {
      await api.post('/contratacao/iniciar', { plano_id: plano.id });
      setSucesso(`Plano ${plano.nome} escolhido. Geramos uma proposta/contrato para você assinar quando quiser — nenhuma cobrança foi feita e seu teste segue ativo.`);
      try {
        const { data } = await api.get('/contratacao/status');
        if (data?.plano_id) setPlanoAtualId(data.plano_id);
      } catch { /* mantém o valor anterior */ }
    } catch (err) {
      setAviso(mensagemErro(err, 'Não foi possível registrar a escolha agora.'));
    } finally {
      setEnviando(null);
    }
  }

  const canal = montarLinkComercial(
    { whatsapp: whatsappSuporte, email: contactEmail, telefone: contactPhone },
    { assunto: 'Interesse no plano Enterprise - Matopiba Log', mensagem: 'Olá! Tenho interesse no plano Enterprise do Matopiba Log.' }
  );

  if (loading) {
    return <div className="bg-white rounded-2xl border border-gray-100 p-6 text-sm text-gray-500">Carregando planos...</div>;
  }

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
        <h3 className="text-lg font-bold text-gray-900">Comparar planos</h3>
        <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-100 text-blue-800 rounded-xl p-3.5 text-sm">
          <Info size={18} className="mt-0.5 shrink-0" />
          <span>
            <b>Nenhuma cobrança é feita agora</b> e seu teste gratuito <b>não é encurtado</b>. Ao escolher um plano,
            geramos uma proposta/contrato para assinar quando quiser; o pagamento é uma etapa separada. Recursos de
            ERP e Acesso corporativo (SSO) aparecem como <b>"Em breve"</b> — em preparação, sem contratação automática.
          </span>
        </div>
        {sucesso && (
          <div className="flex items-start gap-2 bg-green-50 border border-green-200 text-green-800 rounded-xl p-3.5 text-sm">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0" />{sucesso}
          </div>
        )}
        {aviso && <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3.5 text-sm">{aviso}</div>}
        {erro && <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3.5 text-sm">{erro}</div>}
      </div>
      {planos.length > 0 && (
        <PlanosVitrine
          planos={planos}
          onEscolher={escolher}
          planoSelecionadoId={planoAtualId}
          ctaSelecionadoLabel="✓ Plano atual"
          ctaLabel={(p) => (enviando === p.id ? 'Registrando...' : 'Escolher este plano')}
          negociacaoCta="Falar sobre Enterprise"
          negociacaoHint="Frotas acima de 40 motoristas — sob proposta personalizada."
          negociacaoHref={canal.href}
          negociacaoExterno={canal.externo}
          negociacaoTelHref={canal.telHref}
        />
      )}

      {planoAtualId && <SimulacaoUpgrade planos={planos} planoAtualId={planoAtualId} />}
    </div>
  );
};

// ── Simulação de custo: plano atual × plano alvo + serviços adicionais (R$149,90) ──
// READ-ONLY: usa POST /contratacao/plano-preview (não escreve, não cobra, não muda
// plano). Mostra snapshot de valores, diferença e recomendação de custo-benefício.
type LinhaAddon = { situacao: string; valor_mensal: number | null; price_status?: string; commercial_status?: string };
type AddonLinha = { codigo: string; nome: string; em_breve: boolean; technical_status?: string; selecionado: boolean; atual: LinhaAddon; alvo: LinhaAddon | null };
type Snapshot = {
  plano_atual: { nome: string | null; valor_mensal: number | null; capacidade_inclusa: number | null };
  plano_alvo: { nome: string | null; valor_mensal: number | null } | null;
  add_ons: AddonLinha[];
  add_on_valor_padrao: number | null;
  subtotal_plano_atual: number | null; subtotal_addons_atual: number | null; total_atual: number | null; total_atual_incompleto?: boolean;
  subtotal_plano_alvo: number | null; subtotal_addons_alvo: number | null; total_alvo: number | null; total_alvo_incompleto?: boolean;
  diferenca_mensal: number | null;
  recomendacao: { tipo: string; mensagem: string };
  proxima_fatura: { texto: string };
  uso_atual?: { motoristas_ativos: number | null; limite: number | null; ilimitado: boolean; capacidade_inclusa: number | null; estado: string } | null;
};

// Rótulo/cor do estado de capacidade (§12) — contagem real, sem % arbitrária.
const usoEstado: Record<string, { texto: string; cls: string }> = {
  confortavel: { texto: 'dentro do plano', cls: 'text-green-700 bg-green-50 border-green-200' },
  proximo: { texto: 'última vaga disponível', cls: 'text-amber-700 bg-amber-50 border-amber-200' },
  no_limite: { texto: 'no limite do plano', cls: 'text-amber-700 bg-amber-50 border-amber-200' },
  acima: { texto: 'acima do limite do plano', cls: 'text-red-700 bg-red-50 border-red-200' },
  ilimitado: { texto: 'plano sem limite de motoristas', cls: 'text-gray-600 bg-gray-50 border-gray-200' },
};

const brl = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Total pode ficar "sob proposta" quando um serviço selecionado não tem preço de
// tabela (ex.: ERP/SSO) — nesse caso NÃO mostramos número (sem economia fantasma).
const totalLabel = (v: number | null, incompleto?: boolean) =>
  incompleto ? 'Sob proposta' : `${brl(v)}/mês`;

const SimulacaoUpgrade: React.FC<{ planos: PlanoPublico[]; planoAtualId: string }> = ({ planos, planoAtualId }) => {
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [planoAlvoId, setPlanoAlvoId] = useState<string>('');
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [enviandoSolic, setEnviandoSolic] = useState(false);
  const [solicOk, setSolicOk] = useState<string | null>(null);
  const [solicErro, setSolicErro] = useState<string | null>(null);

  async function solicitarAddons() {
    if (!selecionados.length) return;
    setEnviandoSolic(true); setSolicOk(null); setSolicErro(null);
    try {
      await api.post('/contratacao/solicitar-addons', { addons: selecionados });
      setSolicOk('Solicitação enviada para análise. Nenhuma cobrança foi gerada; os serviços só entram após aprovação.');
    } catch (err) {
      setSolicErro(mensagemErro(err, 'Não foi possível enviar a solicitação agora.'));
    } finally {
      setEnviandoSolic(false);
    }
  }

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    api.post('/contratacao/plano-preview', {
      plano_alvo_id: planoAlvoId || null,
      addons_selecionados: selecionados,
    })
      .then(({ data }) => { if (vivo) setSnap(data); })
      .catch(() => { if (vivo) setSnap(null); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [planoAlvoId, selecionados]);

  const toggle = (codigo: string) =>
    setSelecionados((s) => (s.includes(codigo) ? s.filter((c) => c !== codigo) : [...s, codigo]));

  const alvos = planos.filter((p) => p.id !== planoAtualId && !p.requer_negociacao);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
      <div className="flex items-center gap-2 text-gray-900">
        <Calculator size={18} className="text-green-700" />
        <h3 className="text-lg font-bold">Simular serviços adicionais e upgrade</h3>
      </div>
      <p className="text-sm text-gray-500">
        Marque serviços adicionais e, se quiser, um plano alvo para ver o impacto estimado —
        <b> sem cobrança agora</b>. Você <b>não é obrigado</b> a trocar de plano: pode adicionar serviços ao plano atual.
      </p>

      {snap?.uso_atual && (
        <div className={`flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-sm ${usoEstado[snap.uso_atual.estado]?.cls || 'text-gray-600 bg-gray-50 border-gray-200'}`}>
          <span className="font-semibold">
            Motoristas em uso: {snap.uso_atual.motoristas_ativos ?? '—'}
            {snap.uso_atual.ilimitado ? '' : ` / ${snap.uso_atual.limite ?? '—'}`}
          </span>
          <span className="text-xs">{usoEstado[snap.uso_atual.estado]?.texto || ''}</span>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase text-gray-400">Serviços adicionais {snap?.add_on_valor_padrao != null && <span className="normal-case font-medium">(padrão {brl(snap.add_on_valor_padrao)}/mês)</span>}</p>
          {(snap?.add_ons || []).map((a) => (
            <label key={a.codigo} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
              <input type="checkbox" checked={selecionados.includes(a.codigo)} onChange={() => toggle(a.codigo)} disabled={a.atual.situacao === 'indisponivel' && (!a.alvo || a.alvo.situacao === 'indisponivel')} />
              <span className="flex-1">{a.nome}{a.em_breve && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-500">em preparação</span>}</span>
              <span className="text-xs text-gray-500">
                {a.atual.situacao === 'incluido' ? 'Incluído' : a.atual.situacao === 'adicional' ? brl(a.atual.valor_mensal) : a.atual.situacao === 'sob_proposta' ? 'Sob proposta' : '—'}
              </span>
            </label>
          ))}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase text-gray-400">Comparar com o plano</p>
          <select value={planoAlvoId} onChange={(e) => setPlanoAlvoId(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option value="">Manter meu plano atual</option>
            {alvos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </div>
      </div>

      {carregando && <p className="text-sm text-gray-400">Calculando…</p>}

      {snap?.plano_atual && !carregando && (
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              <tr><td className="px-3 py-2 text-gray-500">Plano atual ({snap.plano_atual.nome})</td><td className="px-3 py-2 text-right font-medium">{brl(snap.subtotal_plano_atual)}</td></tr>
              <tr><td className="px-3 py-2 text-gray-500">Serviços adicionais</td><td className="px-3 py-2 text-right font-medium">{brl(snap.subtotal_addons_atual)}</td></tr>
              <tr className="bg-gray-50"><td className="px-3 py-2 font-bold text-gray-900">Total mantendo plano atual</td><td className="px-3 py-2 text-right font-bold text-gray-900">{totalLabel(snap.total_atual, snap.total_atual_incompleto)}</td></tr>
              {snap.plano_alvo && (
                <>
                  <tr><td className="px-3 py-2 text-gray-500">Plano alvo ({snap.plano_alvo.nome})</td><td className="px-3 py-2 text-right font-medium">{brl(snap.subtotal_plano_alvo)}</td></tr>
                  <tr><td className="px-3 py-2 text-gray-500">Serviços adicionais no alvo</td><td className="px-3 py-2 text-right font-medium">{brl(snap.subtotal_addons_alvo)}</td></tr>
                  <tr className="bg-gray-50"><td className="px-3 py-2 font-bold text-gray-900">Total no plano alvo</td><td className="px-3 py-2 text-right font-bold text-gray-900">{totalLabel(snap.total_alvo, snap.total_alvo_incompleto)}</td></tr>
                  <tr><td className="px-3 py-2 text-gray-500">Diferença mensal</td><td className={`px-3 py-2 text-right font-bold ${(snap.diferenca_mensal || 0) <= 0 ? 'text-green-700' : 'text-amber-700'}`}>{snap.diferenca_mensal == null ? 'Sob proposta' : `${snap.diferenca_mensal > 0 ? '+' : ''}${brl(snap.diferenca_mensal)}`}</td></tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      )}

      {snap?.recomendacao && !carregando && (
        <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3.5 text-sm text-blue-800">
          <TrendingUp size={18} className="mt-0.5 shrink-0" />{snap.recomendacao.mensagem}
        </div>
      )}

      <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-xs text-gray-500">
        {snap?.proxima_fatura?.texto || 'Nenhuma cobrança é gerada agora.'} ERP e Acesso corporativo (SSO) ficam
        como <b>“integração em preparação”</b> — não são ativados automaticamente. A aprovação e o efeito na
        fatura são a próxima etapa.
      </div>

      {selecionados.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={solicitarAddons}
            disabled={enviandoSolic}
            className="inline-flex items-center gap-2 rounded-xl bg-green-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-60"
          >
            {enviandoSolic ? 'Enviando…' : 'Solicitar serviços adicionais'}
          </button>
          {solicOk && (
            <div className="flex items-start gap-2 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" />{solicOk}
            </div>
          )}
          {solicErro && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{solicErro}</div>}
        </div>
      )}
    </div>
  );
};
