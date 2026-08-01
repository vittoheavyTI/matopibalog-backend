import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock, FileText, RefreshCw, AlertCircle, Download } from 'lucide-react';
import api from '../api';

type Contrato = {
  id: string;
  status: string;
  versao?: string;
  signed_storage_path?: string | null;
  aceito_em?: string | null;
};

type ResumoContratacao = {
  plano_nome?: string | null;
  capacidade_inclusa?: number | string | null;
  quantidade_contratada?: number | string | null;
  preco_motorista_extra?: number | string | null;
  valor_mensal?: number | string | null;
  implantacao_gratis?: boolean | null;
  valor_implantacao?: number | string | null;
  total_inicial?: number | string | null;
  trial_dias?: number | string | null;
};

type Proposta = {
  id: string;
  status: string;
  resumo?: ResumoContratacao;
  valor_mensal?: number;
  valor_implantacao?: number;
  total_inicial?: number;
  trial_dias?: number;
  aceito_em?: string | null;
  contratos_comerciais?: Contrato[] | Contrato | null;
};

const brl = (v: number | string | null | undefined) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0));

function mensagemErro(err: unknown, fallback: string) {
  if (typeof err === 'object' && err && 'response' in err) {
    const response = (err as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message || fallback;
  }
  return fallback;
}

const statusLabel: Record<string, string> = {
  enviada: 'Proposta emitida',
  aceita: 'Proposta aceita',
  cancelada: 'Proposta cancelada',
  expirada: 'Proposta expirada',
  aguardando_assinatura: 'Aguardando assinatura',
  assinado: 'Contrato assinado',
  aceito_manualmente: 'Contrato concluído',
  rascunho: 'Em preparação',
};

function contratosDe(proposta?: Proposta | null): Contrato[] {
  const c = proposta?.contratos_comerciais;
  if (!c) return [];
  return Array.isArray(c) ? c : [c];
}

function etapaAtual(proposta?: Proposta | null, contrato?: Contrato | null) {
  if (!proposta) return 1;
  if (!contrato) return 3;
  if (contrato.status === 'aceito_manualmente') return 9;
  if (contrato.status === 'assinado') return 5;
  return 4;
}

export const Contratacao: React.FC = () => {
  const [dados, setDados] = useState<{ propostas: Proposta[]; migration_pendente?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [abrindo, setAbrindo] = useState(false);

  async function carregar() {
    setLoading(true);
    setErro('');
    try {
      const { data } = await api.get('/contratacao/minha');
      setDados(data);
    } catch (err: unknown) {
      setErro(mensagemErro(err, 'Não foi possível carregar sua contratação agora.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const id = window.setTimeout(() => { void carregar(); }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const proposta = useMemo(() => dados?.propostas?.[0] || null, [dados]);
  const contrato = contratosDe(proposta)[0] || null;
  const resumo = proposta?.resumo || {};
  const etapa = etapaAtual(proposta, contrato);

  async function abrirContrato() {
    if (!contrato?.id) return;
    setAbrindo(true);
    setErro('');
    try {
      const { data } = await api.get(`/contratacao/contratos/${contrato.id}/assinado-url`);
      if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (err: unknown) {
      setErro(mensagemErro(err, 'Contrato assinado ainda não disponível.'));
    } finally {
      setAbrindo(false);
    }
  }

  const passos = [
    'Empresa cadastrada',
    'Administrador criado',
    'Proposta emitida',
    'Contrato aguardando assinatura',
    'Contrato concluído',
    'Configuração financeira',
    'Período de teste',
    'Configuração inicial',
    'Pronto para operar',
  ];

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Contratação</h1>
          <p className="text-sm text-gray-500">Acompanhe sua proposta, contrato e próximos passos.</p>
        </div>
        <button
          type="button"
          onClick={carregar}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={16} /> Atualizar
        </button>
      </div>

      {erro && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-gray-100 rounded-xl p-8 text-sm text-gray-500">Carregando contratação...</div>
      ) : !proposta ? (
        <div className="bg-white border border-gray-100 rounded-xl p-6 text-sm text-gray-600">
          Ainda não há proposta comercial vinculada à sua empresa. Se você acabou de se cadastrar, aguarde a atualização ou fale com o comercial pelo WhatsApp.
        </div>
      ) : (
        <div className="grid xl:grid-cols-3 gap-4">
          <section className="xl:col-span-2 bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{resumo.plano_nome || 'Plano contratado'}</h2>
                <p className="text-sm text-gray-500">{statusLabel[proposta.status] || proposta.status}</p>
              </div>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                {contrato ? (statusLabel[contrato.status] || contrato.status) : 'Contrato em preparação'}
              </span>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
              <Info label="Capacidade incluída" value={`${resumo.capacidade_inclusa ?? '-'} motorista(s)`} />
              <Info label="Quantidade contratada" value={`${resumo.quantidade_contratada ?? '-'} motorista(s)`} />
              <Info label="Motoristas extras" value={resumo.preco_motorista_extra ? brl(resumo.preco_motorista_extra) : 'Não aplicável'} />
              <Info label="Mensalidade" value={brl(resumo.valor_mensal ?? proposta.valor_mensal)} />
              <Info label="Implantação" value={resumo.implantacao_gratis ? 'Implantação grátis' : brl(resumo.valor_implantacao ?? proposta.valor_implantacao)} />
              <Info label="Valor inicial" value={brl(resumo.total_inicial ?? proposta.total_inicial)} />
              <Info label="Teste grátis" value={`${resumo.trial_dias ?? proposta.trial_dias ?? 0} dias`} />
              <Info label="Recorrência" value="Mensal" />
              <Info label="Canal comercial" value="WhatsApp" />
            </div>

            <div className="mt-5 rounded-xl bg-gray-50 border border-gray-100 p-4 text-sm text-gray-600">
              {contrato?.status === 'aceito_manualmente'
                ? 'Seu contrato está concluído. A configuração financeira e o período de teste seguem conforme combinado.'
                : contrato?.status === 'assinado'
                  ? 'Recebemos o contrato assinado. Aguarde o aceite administrativo para concluir esta etapa.'
                  : 'A proposta foi emitida e o contrato está aguardando assinatura. O comercial orientará o envio do PDF assinado.'}
            </div>

            {contrato?.signed_storage_path && (
              <button
                type="button"
                onClick={abrirContrato}
                disabled={abrindo}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50"
              >
                <Download size={16} /> {abrindo ? 'Abrindo...' : 'Baixar contrato assinado'}
              </button>
            )}
          </section>

          <aside className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Próximos passos</h2>
            <ol className="space-y-3">
              {passos.map((p, idx) => {
                const n = idx + 1;
                const done = n < etapa || etapa === 9;
                const active = n === etapa && etapa !== 9;
                return (
                  <li key={p} className="flex items-start gap-3 text-sm">
                    {done ? <CheckCircle2 className="text-green-600 shrink-0" size={18} /> : <Clock className={active ? 'text-blue-600 shrink-0' : 'text-gray-300 shrink-0'} size={18} />}
                    <div>
                      <div className={done ? 'font-medium text-gray-900' : active ? 'font-semibold text-blue-700' : 'text-gray-500'}>{p}</div>
                      {active && <div className="text-xs text-gray-500 mt-0.5">Etapa atual</div>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </aside>
        </div>
      )}
    </div>
  );
};

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase text-gray-400">
        <FileText size={13} /> {label}
      </div>
      <div className="mt-1 font-semibold text-gray-900">{value}</div>
    </div>
  );
}
