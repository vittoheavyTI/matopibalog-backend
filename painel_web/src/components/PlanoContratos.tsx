import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Download, ShieldCheck, CheckCircle2, Clock, FileSignature, AlertTriangle } from 'lucide-react';
import api from '../api';
import { formatTechnicalDate } from '../utils';
import { useContratacaoStatus } from '../hooks/useContratacaoStatus';

// Área "Plano e contratos" dentro de Faturas / Regularização. Mostra o plano
// contratado, o andamento da contratação e disponibiliza, em linguagem simples
// (sem jargão técnico), o contrato assinado, o certificado da assinatura e as
// datas de assinatura. Consome apenas GET /contratacao/minha (read-only).

type Contrato = {
  id: string;
  status: string;
  obrigatorio?: boolean;
  contrato_assinado_disponivel?: boolean;
  certificado_disponivel?: boolean;
  assinatura_cliente_em?: string | null;
  assinatura_matopiba_em?: string | null;
  aceito_em?: string | null;
};

type Proposta = {
  id: string;
  status: string;
  origem?: string | null;
  resumo?: {
    plano_nome?: string | null;
    valor_mensal?: number | string | null;
    valor_implantacao?: number | string | null;
    implantacao_gratis?: boolean | null;
  } | null;
  valor_mensal?: number | string | null;
  valor_implantacao?: number | string | null;
  contratos_comerciais?: Contrato[] | Contrato | null;
};

const brl = (v: number | string | null | undefined) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0));

const statusLabel: Record<string, string> = {
  enviada: 'Proposta emitida',
  aceita: 'Proposta aceita',
  aguardando_assinatura: 'Aguardando assinatura',
  pronto_assinatura: 'Pronto para assinatura',
  aguardando_assinatura_cliente: 'Aguardando sua assinatura',
  aguardando_assinatura_matopiba: 'Aguardando Matopiba',
  plenamente_assinado: 'Contrato assinado',
  assinado: 'Contrato assinado',
  aceito_manualmente: 'Contrato concluído',
  cancelado: 'Cancelado',
  recusado: 'Recusado',
  rascunho: 'Em preparação',
};

function contratosDe(p?: Proposta | null): Contrato[] {
  const c = p?.contratos_comerciais;
  if (!c) return [];
  return Array.isArray(c) ? c : [c];
}

export const PlanoContratos: React.FC = () => {
  const [proposta, setProposta] = useState<Proposta | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [baixando, setBaixando] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const { pendenciaObrigatoria } = useContratacaoStatus();

  useEffect(() => {
    api.get('/contratacao/minha')
      .then(({ data }) => setProposta(data?.propostas?.[0] || null))
      .catch(() => {}) // fail-open: a seção some se não houver contratação
      .finally(() => setCarregado(true));
  }, []);

  const contrato = contratosDe(proposta)[0] || null;

  // Só mostra a seção quando existe contratação vinculada.
  if (!carregado || !proposta || !contrato) return null;

  const concluido = ['plenamente_assinado', 'assinado', 'aceito_manualmente'].includes(contrato.status);
  const aquisicaoExplicita = ['aquisicao_explicita', 'pos_trial_continuar'].includes(proposta.origem || '');
  const contratoHistorico = !aquisicaoExplicita;

  async function baixar(tipo: 'assinado' | 'certificado') {
    if (!contrato) return;
    setBaixando(tipo);
    setErro('');
    try {
      const rota = tipo === 'assinado' ? 'assinado-url' : 'certificado-url';
      const { data } = await api.get(`/contratacao/contratos/${contrato.id}/${rota}`);
      if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer');
      else setErro('Documento ainda não disponível.');
    } catch {
      setErro(tipo === 'assinado' ? 'Contrato assinado ainda não disponível.' : 'Certificado ainda não disponível.');
    } finally {
      setBaixando(null);
    }
  }

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <FileText className="text-blue-600" size={20} />
        <h3 className="text-base font-semibold text-gray-800">Plano e contratos</h3>
      </div>

      {/* Pendência obrigatória no TOPO do card: ação obrigatória, não passiva. */}
      {pendenciaObrigatoria && !concluido && aquisicaoExplicita && (
        <div className="mb-4 rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
          <div className="flex items-start gap-2 text-amber-800">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <p className="text-sm font-semibold">
              Sua contratação está iniciada. Assine o contrato para formalizar a continuidade comercial.
            </p>
          </div>
          <Link
            to="/minhas-faturas?aba=contratacao"
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-600 hover:bg-amber-700 px-4 py-2 text-sm font-semibold text-white"
          >
            <FileSignature size={16} /> Assinar contrato
          </Link>
        </div>
      )}

      {contratoHistorico && !concluido && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-start gap-2 text-blue-800">
            <Clock size={18} className="shrink-0 mt-0.5" />
            <p className="text-sm font-semibold">
              Registro comercial histórico. Ele não exige assinatura agora e não bloqueia o teste vigente.
            </p>
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
          <div className="text-xs font-semibold uppercase text-gray-400">Plano</div>
          <div className="mt-1 font-semibold text-gray-900">{proposta.resumo?.plano_nome || 'Plano contratado'}</div>
        </div>
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
          <div className="text-xs font-semibold uppercase text-gray-400">Situação da contratação</div>
          <div className="mt-1 flex items-center gap-2 font-semibold text-gray-900">
            {concluido ? <CheckCircle2 size={16} className="text-green-600" /> : <Clock size={16} className="text-amber-500" />}
            {contratoHistorico && !concluido ? 'Histórico sem ação necessária' : (statusLabel[contrato.status] || contrato.status)}
          </div>
        </div>
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
          <div className="text-xs font-semibold uppercase text-gray-400">Mensalidade</div>
          <div className="mt-1 font-semibold text-gray-900">{brl(proposta.resumo?.valor_mensal ?? proposta.valor_mensal)} <span className="text-xs font-normal text-gray-500">/mês</span></div>
        </div>
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
          <div className="text-xs font-semibold uppercase text-gray-400">Implantação / valor inicial</div>
          <div className="mt-1 font-semibold text-gray-900">
            {(Number(proposta.resumo?.valor_implantacao ?? proposta.valor_implantacao ?? 0) <= 0)
              ? 'Sem cobrança de implantação'
              : brl(proposta.resumo?.valor_implantacao ?? proposta.valor_implantacao)}
          </div>
        </div>
        {contrato.assinatura_cliente_em && (
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
            <div className="text-xs font-semibold uppercase text-gray-400">Assinatura do cliente</div>
            <div className="mt-1 font-semibold text-gray-900">{formatTechnicalDate(contrato.assinatura_cliente_em)}</div>
          </div>
        )}
        {contrato.assinatura_matopiba_em && (
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
            <div className="text-xs font-semibold uppercase text-gray-400">Assinatura Matopiba</div>
            <div className="mt-1 font-semibold text-gray-900">{formatTechnicalDate(contrato.assinatura_matopiba_em)}</div>
          </div>
        )}
      </div>

      {erro && <p className="mt-3 text-sm text-amber-700">{erro}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        {contrato.contrato_assinado_disponivel && (
          <button
            type="button"
            onClick={() => baixar('assinado')}
            disabled={baixando === 'assinado'}
            className="inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50"
          >
            <Download size={16} /> {baixando === 'assinado' ? 'Abrindo…' : 'Baixar contrato assinado'}
          </button>
        )}
        {contrato.certificado_disponivel && (
          <button
            type="button"
            onClick={() => baixar('certificado')}
            disabled={baixando === 'certificado'}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <ShieldCheck size={16} /> {baixando === 'certificado' ? 'Abrindo…' : 'Baixar certificado da assinatura'}
          </button>
        )}
      </div>

      {concluido && (
        <p className="mt-3 text-xs text-gray-400">
          Assinatura eletrônica com confirmação por e-mail e registro técnico. O certificado comprova a
          verificação do documento.
        </p>
      )}
    </div>
  );
};
