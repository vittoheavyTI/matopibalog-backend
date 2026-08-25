import { useId, useState, type ReactNode } from 'react';

// Componentes compartilhados do portal. Existem para que TODA tela tenha os três
// estados obrigatórios (§83) sem cada página reinventá-los: carregando, erro
// acionável e vazio útil. Página em branco não é um estado — é um bug visível.

// ---------------------------------------------------------------------------
// Foco de teclado (VIS-13)
// ---------------------------------------------------------------------------
// O anel padrão do navegador some contra o verde escuro dos botões primários.
// Aqui o anel é branco com um halo escuro por fora, então aparece tanto sobre
// fundo escuro quanto sobre fundo claro. Aplicado a tudo que recebe foco.
export const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white '
  + 'focus-visible:ring-offset-2 focus-visible:ring-offset-emerald-800';

export const FOCO_CLARO = 'focus-visible:outline-none focus-visible:ring-2 '
  + 'focus-visible:ring-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white';

export const BOTAO_PRIMARIO = `rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white `
  + `hover:bg-emerald-800 disabled:opacity-60 ${FOCO_CLARO}`;

export const BOTAO_SECUNDARIO = `rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium `
  + `text-slate-700 hover:bg-slate-50 disabled:opacity-60 ${FOCO_CLARO}`;

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
          className={`mt-3 rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 ${FOCO_CLARO}`}
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

// ---------------------------------------------------------------------------
// Cartao — cor por SEMÂNTICA, não por classe solta (VIS-01)
// ---------------------------------------------------------------------------
// A versão anterior trazia `bg-white border-slate-200` na base e aceitava que o
// chamador passasse `bg-amber-50` por `className`. Duas utilitárias da mesma
// propriedade com a mesma especificidade: quem vence é a ordem no CSS gerado,
// não a intenção — e vencia `bg-white`. Todo destaque do portal era renderizado
// branco, silenciosamente.
//
// Agora a cor é decidida DENTRO do componente, a partir do tom. Não existe mais
// como um chamador pedir destaque e receber branco: ou o tom existe, ou não há
// destaque nenhum. `className` continua aceitando ajuste de layout (espaçamento,
// largura), nunca cor de fundo/borda.

export type TomCartao = 'neutro' | 'atencao' | 'erro' | 'sucesso' | 'informacao';

const CARTAO_POR_TOM: Record<TomCartao, string> = {
  neutro: 'border-slate-200 bg-white',
  atencao: 'border-amber-300 bg-amber-50',
  erro: 'border-red-300 bg-red-50',
  sucesso: 'border-emerald-300 bg-emerald-50',
  informacao: 'border-sky-300 bg-sky-50',
};

export function Cartao({ children, tom = 'neutro', className = '' }: {
  children: ReactNode;
  tom?: TomCartao;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${CARTAO_POR_TOM[tom]} ${className}`}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Situação — mapa de tons congelado (VIS-06)
// ---------------------------------------------------------------------------
// Antes, cinco situações diferentes caíam no mesmo cinza: "Em análise", "Em
// planejamento", "Agendada", "Entrega parcial" e "Cancelada" ficavam idênticas —
// uma operação viva com a mesma cara de uma encerrada.
//
// O rótulo textual continua sempre presente: a cor REFORÇA, nunca decide
// sozinha (§30/§84).

type TomSituacao = 'informacao' | 'atencao' | 'sucesso' | 'erro' | 'neutro' | 'encerrado';

const SITUACAO_POR_TOM: Record<TomSituacao, string> = {
  informacao: 'bg-sky-100 text-sky-900 border-sky-200',
  atencao: 'bg-amber-100 text-amber-900 border-amber-200',
  sucesso: 'bg-emerald-100 text-emerald-900 border-emerald-200',
  erro: 'bg-red-100 text-red-900 border-red-200',
  neutro: 'bg-slate-100 text-slate-700 border-slate-200',
  // Encerrado é deliberadamente mais apagado que neutro: "cancelada" não pode
  // ter o mesmo peso visual de algo que ainda está acontecendo.
  encerrado: 'bg-slate-50 text-slate-500 border-slate-200',
};

export const TOM_POR_SITUACAO: Record<string, TomSituacao> = {
  RECEBIDA: 'informacao',
  EM_ANALISE: 'informacao',
  ACEITA: 'informacao',
  EM_PLANEJAMENTO: 'informacao',
  AGENDADA: 'informacao',
  EM_TRANSPORTE: 'informacao',
  PARCIALMENTE_ENTREGUE: 'atencao',
  AJUSTES_SOLICITADOS: 'atencao',
  ENTREGUE: 'sucesso',
  COMPROVANTE_DISPONIVEL: 'sucesso',
  RECUSADA: 'erro',
  REJEITADA: 'erro',
  CANCELADA: 'encerrado',
  ATUALIZACAO_EM_PROCESSAMENTO: 'neutro',
};

export function Situacao({ codigo, rotulo }: { codigo: string; rotulo: string }) {
  const tom = TOM_POR_SITUACAO[codigo] || 'neutro';
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${SITUACAO_POR_TOM[tom]}`}>
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

// ---------------------------------------------------------------------------
// Campo de senha com alternância de visibilidade (VIS-12)
// ---------------------------------------------------------------------------
// Digitar às cegas uma senha que já existe — o caso da ativação com conta
// existente — é onde mais dói no celular.

export function CampoSenha({
  id, rotulo, valor, aoMudar, autoComplete, minLength, ajuda, required = true,
}: {
  id: string;
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
  autoComplete?: string;
  minLength?: number;
  ajuda?: string;
  required?: boolean;
}) {
  const [visivel, setVisivel] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">{rotulo}</label>
      <div className="relative mt-1">
        <input
          id={id}
          type={visivel ? 'text' : 'password'}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          className={`w-full rounded-lg border border-slate-300 py-2 pl-3 pr-24 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600`}
        />
        <button
          type="button"
          onClick={() => setVisivel((v) => !v)}
          aria-pressed={visivel}
          className={`absolute inset-y-0 right-0 px-3 text-xs font-medium text-emerald-700 hover:underline ${FOCO_CLARO}`}
        >
          {visivel ? 'Ocultar senha' : 'Mostrar senha'}
        </button>
      </div>
      {ajuda && <p className="mt-1 text-xs text-slate-500">{ajuda}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Seletor de arquivo em português (VIS-07)
// ---------------------------------------------------------------------------
// O controle nativo mostra "Choose File / No file chosen" e o texto vem do
// NAVEGADOR, não do app — é o único ponto do portal onde o idioma escapava.
// Aqui o input fica acessível mas visualmente oculto, e o rótulo vira o botão.

export function SeletorArquivo({
  id, rotulo, ajuda, accept, desabilitado, aoSelecionar, nomeSelecionado,
}: {
  id?: string;
  rotulo: string;
  ajuda?: string;
  accept?: string;
  desabilitado?: boolean;
  aoSelecionar: (arquivo: File) => void;
  nomeSelecionado?: string | null;
}) {
  const gerado = useId();
  const inputId = id || `arquivo-${gerado}`;
  return (
    <div>
      <p className="block text-sm font-medium text-slate-700">{rotulo}</p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        {/* `sr-only` em vez de `hidden`: o input continua alcançável por teclado
            e por leitor de tela, e o <label> age como botão. */}
        <input
          id={inputId}
          type="file"
          accept={accept}
          disabled={desabilitado}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) aoSelecionar(f); }}
          className="sr-only"
        />
        <label
          htmlFor={inputId}
          className={`inline-flex cursor-pointer items-center rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 ${desabilitado ? 'pointer-events-none opacity-60' : ''}`}
        >
          Escolher arquivo
        </label>
        <span className="text-sm text-slate-600">
          {nomeSelecionado || 'Nenhum arquivo selecionado'}
        </span>
      </div>
      {ajuda && <p className="mt-1 text-xs text-slate-500">{ajuda}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progresso de entrega (VIS-02)
// ---------------------------------------------------------------------------
// Só renderiza com dado do backend. Nunca calcula a partir de contagem de
// viagens: número inventado sobre carga alheia é pior que número nenhum (§14).

export type EntregaProgresso = {
  unidade?: string | null;
  solicitado: number;
  entregue: number;
  restante: number;
  concluida: boolean;
};

export function ProgressoEntrega({ entrega, unidade }: { entrega: EntregaProgresso; unidade?: string | null }) {
  const u = entrega.unidade || unidade || 'ton';
  const faltaAlgo = entrega.restante > 0;
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">Entrega</dt>
      <dd className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <p className="text-xs text-slate-500">Carga solicitada</p>
          <p className="text-sm font-medium text-slate-900"><Quantidade valor={entrega.solicitado} unidade={u} /></p>
        </div>
        <div className="rounded-lg bg-emerald-50 px-3 py-2">
          <p className="text-xs text-emerald-800">Já entregue</p>
          <p className="text-sm font-medium text-emerald-900"><Quantidade valor={entrega.entregue} unidade={u} /></p>
        </div>
        <div className={`rounded-lg px-3 py-2 ${faltaAlgo ? 'bg-amber-50' : 'bg-slate-50'}`}>
          <p className={`text-xs ${faltaAlgo ? 'text-amber-800' : 'text-slate-500'}`}>Ainda falta</p>
          <p className={`text-sm font-medium ${faltaAlgo ? 'text-amber-900' : 'text-slate-900'}`}>
            <Quantidade valor={entrega.restante} unidade={u} />
          </p>
        </div>
      </dd>
    </div>
  );
}
