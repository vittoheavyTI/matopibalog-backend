import type { ReactNode } from 'react';

// Componentes compartilhados do portal. Existem para que TODA tela tenha os três
// estados obrigatórios (§83) sem cada página reinventá-los: carregando, erro
// acionável e vazio útil. Página em branco não é um estado — é um bug visível.

export function Carregando({ rotulo = 'Carregando…' }: { rotulo?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-slate-600" role="status" aria-live="polite">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" aria-hidden="true" />
      <span className="text-sm">{rotulo}</span>
    </div>
  );
}

// Erro sempre com caminho de saída: uma mensagem sem ação deixa a pessoa parada.
export function Erro({ mensagem, aoTentarNovamente }: { mensagem: string; aoTentarNovamente?: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
      <p className="text-sm text-red-800">{mensagem}</p>
      {aoTentarNovamente && (
        <button
          type="button"
          onClick={aoTentarNovamente}
          className="mt-3 rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800"
        >
          Tentar novamente
        </button>
      )}
    </div>
  );
}

// Vazio que explica o que fazer, em vez de só dizer "nenhum registro".
export function Vazio({ titulo, descricao, acao }: { titulo: string; descricao: string; acao?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="text-base font-medium text-slate-800">{titulo}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">{descricao}</p>
      {acao && <div className="mt-4">{acao}</div>}
    </div>
  );
}

export function Cartao({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>{children}</div>;
}

// Cores por família de situação, com o RÓTULO sempre presente: quem não
// distingue cores continua entendendo o estado (§84).
const TOM: Record<string, string> = {
  AJUSTES_SOLICITADOS: 'bg-amber-100 text-amber-900 border-amber-200',
  RECUSADA: 'bg-red-100 text-red-900 border-red-200',
  CANCELADA: 'bg-slate-100 text-slate-700 border-slate-200',
  ENTREGUE: 'bg-emerald-100 text-emerald-900 border-emerald-200',
  COMPROVANTE_DISPONIVEL: 'bg-emerald-100 text-emerald-900 border-emerald-200',
  EM_TRANSPORTE: 'bg-sky-100 text-sky-900 border-sky-200',
  ATUALIZACAO_EM_PROCESSAMENTO: 'bg-slate-100 text-slate-700 border-slate-200',
};

export function Situacao({ codigo, rotulo }: { codigo: string; rotulo: string }) {
  const tom = TOM[codigo] || 'bg-slate-100 text-slate-800 border-slate-200';
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${tom}`}>
      {rotulo}
    </span>
  );
}

export function Quantidade({ valor, unidade }: { valor: number | null | undefined; unidade?: string | null }) {
  if (valor === null || valor === undefined) return <span>—</span>;
  const formatado = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(valor);
  const u = unidade === 'kg' ? 'kg' : 't';
  return <span>{formatado} {u}</span>;
}

export function DataCurta({ valor }: { valor?: string | null }) {
  if (!valor) return <span>—</span>;
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return <span>—</span>;
  return <span>{d.toLocaleDateString('pt-BR')}</span>;
}
