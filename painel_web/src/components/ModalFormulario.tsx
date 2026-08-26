import type { ReactNode } from 'react';
import { X } from 'lucide-react';

// ModalFormulario — o padrão de formulário do painel, extraído do modal de
// "Novo Frete" (`UX_FORM_001 = FREIGHT_MODAL_PATTERN_V1`).
//
// POR QUE UM SHELL NOVO E NÃO REFATORAR O FRETE. O modal do Frete vive dentro de
// `GerenciamentoViagens.tsx`, um arquivo de mais de 2.000 linhas onde o formulário
// está entrelaçado com cálculo de valores, autocomplete de motorista, estados de
// odômetro e regras financeiras. Extraí-lo agora significaria mexer no fluxo de
// receita da transportadora para arrumar a tela de cadastro de usuário — risco
// desproporcional ao ganho. Então este shell REPRODUZ o comportamento visual dele
// e é adotado por Usuário e Motorista; o Frete fica intocado, e a convergência
// dos três fica registrada como limpeza técnica, não como dívida de produto.
//
// O que o padrão garante, e que os formulários de usuário e motorista não tinham:
// o corpo rola sozinho enquanto cabeçalho e rodapé ficam parados. Sem isso, num
// formulário longo a pessoa perde o botão de salvar de vista e a página inteira
// vira uma rolagem só.

export function ModalFormulario({
  aberto, titulo, icone, aoFechar, rodape, largura = 'lg', children,
}: {
  aberto: boolean;
  titulo: string;
  icone?: ReactNode;
  aoFechar: () => void;
  rodape: ReactNode;
  largura?: 'lg' | 'xl';
  children: ReactNode;
}) {
  if (!aberto) return null;
  const maxLargura = largura === 'xl' ? 'max-w-2xl' : 'max-w-lg';

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      {/* `max-h-[90vh] flex flex-col` é o coração do padrão: o container nunca
          passa da altura da tela, e as três faixas (topo, corpo, rodapé) se
          distribuem — só o corpo cresce e rola. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className={`bg-white rounded-2xl shadow-xl w-full ${maxLargura} overflow-hidden max-h-[90vh] flex flex-col`}
      >
        <div className="p-5 border-b border-gray-100 flex justify-between items-center shrink-0">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2 min-w-0">
            {icone}
            <span className="truncate">{titulo}</span>
          </h3>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">{children}</div>

        <div className="p-5 bg-gray-50 flex flex-wrap justify-end gap-3 border-t shrink-0">
          {rodape}
        </div>
      </div>
    </div>
  );
}

// Seção do formulário. Agrupa visualmente sem esconder nada.
//
// A prop `recolhivel` foi REMOVIDA (§17/§19). Ela existia para "Opções de acesso"
// e "Informações adicionais", e o efeito prático era ruim: os dois blocos nasciam
// fechados, então a pessoa não via que existia senha temporária nem campo de
// endereço — precisava adivinhar que havia um "Mostrar" para clicar. Esconder
// campo atrás de um clique só se paga quando o campo é raro; estes não são.
//
// Sem a prop, ninguém pode reintroduzir o gate por engano.
export function SecaoFormulario({
  titulo, descricao, children,
}: {
  titulo: string;
  descricao?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-100 bg-gray-50/40 p-4">
      <div>
        <p className="text-sm font-bold text-gray-700">{titulo}</p>
        {descricao && <p className="mt-0.5 text-xs text-gray-500">{descricao}</p>}
      </div>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

// Campo com rótulo e erro inline. O erro fica junto do campo, não num alert do
// navegador — validação que interrompe a pessoa é pior que validação que a guia.
export function Campo({
  id, rotulo, obrigatorio, ajuda, erro, children,
}: {
  id?: string;
  rotulo: string;
  obrigatorio?: boolean;
  ajuda?: string;
  erro?: string | null;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-bold text-gray-600 uppercase mb-1">
        {rotulo}{obrigatorio && <span className="text-red-500"> *</span>}
      </label>
      {children}
      {erro
        ? <p className="mt-1 text-xs text-red-600" role="alert">{erro}</p>
        : ajuda && <p className="mt-1 text-xs text-gray-500">{ajuda}</p>}
    </div>
  );
}

export const CLASSE_INPUT = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none '
  + 'focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-500';

export const CLASSE_BOTAO_SECUNDARIO = 'px-5 py-2.5 font-bold text-gray-600 hover:text-gray-700 transition-colors';

export const CLASSE_BOTAO_PRIMARIO = 'px-8 py-2.5 bg-green-700 text-white rounded-xl font-bold shadow-lg '
  + 'shadow-green-200 hover:bg-green-800 transition-all active:scale-95 disabled:opacity-50 '
  + 'disabled:cursor-not-allowed';

// Duas colunas no desktop, uma no celular. O padrão do Frete usa `grid-cols-2`
// fixo; aqui a quebra é responsiva, porque a exigência de 390px é explícita.
export const CLASSE_GRADE_2 = 'grid grid-cols-1 sm:grid-cols-2 gap-3';
