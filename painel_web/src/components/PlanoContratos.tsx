import React, { useEffect, useState } from 'react';
import { FileText, Download, ShieldCheck, CheckCircle2, Clock } from 'lucide-react';
import api from '../api';
import { formatTechnicalDate } from '../utils';

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
  resumo?: { plano_nome?: string | null } | null;
  contratos_comerciais?: Contrato[] | Contrato | null;
};

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

      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
          <div className="text-xs font-semibold uppercase text-gray-400">Plano</div>
          <div className="mt-1 font-semibold text-gray-900">{proposta.resumo?.plano_nome || 'Plano contratado'}</div>
        </div>
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
          <div className="text-xs font-semibold uppercase text-gray-400">Situação da contratação</div>
          <div className="mt-1 flex items-center gap-2 font-semibold text-gray-900">
            {concluido ? <CheckCircle2 size={16} className="text-green-600" /> : <Clock size={16} className="text-amber-500" />}
            {statusLabel[contrato.status] || contrato.status}
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
