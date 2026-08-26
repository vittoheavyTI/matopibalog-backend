import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Check } from 'lucide-react';
import { CLASSE_INPUT } from './ModalFormulario';

// SeletorConta — escolha da conta-alvo do super-admin (`TEAM-VIS-01`).
//
// O QUE ESTAVA ERRADO. O campo era um `<select size={5}>` com todas as contas
// renderizadas permanentemente embaixo da busca. Com 25 empresas já ficava uma
// parede; a lista nunca fechava, então mesmo depois de escolher a pessoa
// continuava olhando para as outras opções, e o formulário inteiro era empurrado
// para baixo.
//
// O QUE ELE FAZ AGORA (§7). Começa como um campo de busca compacto. Os
// resultados só aparecem enquanto se digita, a lista FECHA ao escolher, e o
// estado selecionado mostra a conta com uma ação "Alterar conta" — que é o que
// permite corrigir sem reabrir a parede.
//
// Nota de escala (§9): a lista de contas já vem carregada em memória (o painel a
// usa em vários lugares), então o filtro é local e não há requisição por tecla.
// O `debounce` aqui seria latência sem ganho. O que evitamos é RENDERIZAR
// centenas de linhas — e é isso que o corte por `LIMITE_RESULTADOS` faz.

const LIMITE_RESULTADOS = 8;

export type ContaOpcao = { id: string; nome: string; tipo?: string | null };

export function SeletorConta({
  contas, valor, aoEscolher, carregando = false, erro,
}: {
  contas: ContaOpcao[];
  valor: string;
  aoEscolher: (id: string) => void;
  carregando?: boolean;
  erro?: string | null;
}) {
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const escolhida = useMemo(
    () => contas.find((c) => c.id === valor) || null,
    [contas, valor],
  );

  const resultados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return [];
    return contas
      .filter((c) => c.nome.toLowerCase().includes(termo))
      .slice(0, LIMITE_RESULTADOS);
  }, [contas, busca]);

  // Clicar fora fecha — senão a lista fica presa aberta sobre o resto do form.
  useEffect(() => {
    if (!aberto) return;
    const aoClicarFora = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setAberto(false);
      }
    };
    document.addEventListener('mousedown', aoClicarFora);
    return () => document.removeEventListener('mousedown', aoClicarFora);
  }, [aberto]);

  // Estado SELECIONADO: a conta escolhida, sem a lista por baixo.
  if (escolhida) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
        <span className="flex min-w-0 items-center gap-2">
          <Check size={16} className="shrink-0 text-green-700" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-gray-800">{escolhida.nome}</span>
            {escolhida.tipo === 'autonomo' && (
              <span className="block text-xs text-gray-500">Autônomo</span>
            )}
          </span>
        </span>
        <button
          type="button"
          onClick={() => { aoEscolher(''); setBusca(''); setAberto(true); }}
          className="shrink-0 text-xs font-bold text-blue-600 hover:underline"
        >
          Alterar conta
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          className={`${CLASSE_INPUT} pl-9`}
          placeholder={carregando ? 'Carregando contas…' : 'Buscar conta por nome'}
          value={busca}
          disabled={carregando}
          onChange={(e) => { setBusca(e.target.value); setAberto(true); }}
          onFocus={() => setAberto(true)}
          aria-label="Buscar conta"
          aria-expanded={aberto && resultados.length > 0}
          role="combobox"
          aria-controls="lista-contas"
        />
        {busca && (
          <button
            type="button"
            onClick={() => { setBusca(''); setAberto(false); }}
            aria-label="Limpar busca"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {aberto && busca.trim() && (
        <ul
          id="lista-contas"
          role="listbox"
          className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg"
        >
          {resultados.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => { aoEscolher(c.id); setBusca(''); setAberto(false); }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-blue-50"
              >
                <span className="block truncate font-medium text-gray-800">{c.nome}</span>
                {c.tipo === 'autonomo' && <span className="block text-xs text-gray-500">Autônomo</span>}
              </button>
            </li>
          ))}
          {resultados.length === 0 && (
            <li className="px-3 py-2 text-sm text-gray-500">Nenhuma conta encontrada.</li>
          )}
          {resultados.length === LIMITE_RESULTADOS && (
            <li className="border-t border-gray-100 px-3 py-1.5 text-xs text-gray-400">
              Refine a busca para ver outras contas.
            </li>
          )}
        </ul>
      )}

      {erro && <p className="mt-1 text-xs text-red-600" role="alert">{erro}</p>}
    </div>
  );
}
