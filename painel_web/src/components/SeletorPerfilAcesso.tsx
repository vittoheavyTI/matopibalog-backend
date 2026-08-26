import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Search, SlidersHorizontal } from 'lucide-react';
import api from '../api';
import { CLASSE_INPUT } from './ModalFormulario';

// Seletor de PERFIL DE ACESSO.
//
// A lista vem já filtrada pelo servidor (`GET /admin/perfis-acesso`): o que este
// componente mostra é o que o ator pode legitimamente conceder. Ele não recebe
// todos os perfis para decidir sozinho o que esconder — filtro de tela não é
// controle de acesso, e a mesma regra é reconferida na gravação.
//
// SELEÇÃO RECOLHIDA (`TEAM-VIS-02`, §11–§16). Antes, todos os perfis ficavam
// expandidos permanentemente: um bloco alto de cartões que empurrava o resto do
// formulário e não sumia depois da escolha. Agora o padrão é o de qualquer campo
// de escolha — mostra o que está selecionado, abre sob demanda, fecha ao
// escolher. A busca interna aparece só quando a lista justifica (§16).
//
// A tela fala "perfil de acesso", nunca "template" (§5/§107). E explica o efeito
// em uma linha — não despeja a matriz de permissões, que é outra tela e outra
// autoridade (§44/§52).

export type PerfilAcesso = {
  id: string;
  stable_key: string;
  nome: string;
  descricao: string | null;
  resumo: string[];
  editavel: boolean;
};

export function useePerfisAcesso(ativo: boolean, empresaId?: string | null) {
  const [perfis, setPerfis] = useState<PerfilAcesso[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    setCarregando(true);
    setErro(null);
    // §55: o super-admin troca de conta com o modal aberto; os perfis precisam
    // vir da conta ALVO, não da dele.
    const params = empresaId ? { empresa_id: empresaId } : undefined;
    api.get('/admin/perfis-acesso', { params })
      .then((r) => { if (vivo) setPerfis(r.data?.itens || []); })
      .catch((e) => {
        if (!vivo) return;
        setPerfis([]);
        const msg = e?.response?.data?.message;
        setErro(typeof msg === 'string' && msg.trim()
          ? msg
          : 'Não foi possível carregar os perfis de acesso.');
      })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [ativo, empresaId]);

  return { perfis, carregando, erro };
}

// Resumo em linguagem de negócio + atalho para quem pode editar o que o perfil
// concede. Compartilhado entre o estado selecionado e a lista aberta.
function ResumoDoPerfil({
  perfil, podeEditarPermissoes, empresaId,
}: {
  perfil: PerfilAcesso;
  podeEditarPermissoes: boolean;
  empresaId?: string | null;
}) {
  const destino = `/perfis-permissoes?perfil=${perfil.id}`
    + (empresaId ? `&empresa_id=${empresaId}` : '');

  return (
    <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
      {perfil.resumo.length > 0 ? (
        <>
          <p className="text-xs font-bold text-gray-600">Esta pessoa poderá:</p>
          <ul className="mt-1 space-y-0.5">
            {perfil.resumo.map((linha) => (
              <li key={linha} className="text-xs text-gray-600">· {linha}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-xs text-gray-500">Acesso básico, sem áreas administrativas.</p>
      )}

      {/* TEAM-FUNC-04 (§44–§48): ATRIBUIR perfil e EDITAR o que ele concede são
          ações diferentes, com autoridades diferentes. Este link não edita nada:
          leva à tela canônica, já apontando para o perfil e a conta certos, e só
          aparece para quem tem `permissions.manage`. */}
      {podeEditarPermissoes && perfil.editavel && (
        <Link
          to={destino}
          className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline"
        >
          <SlidersHorizontal size={12} />
          Editar permissões do perfil
        </Link>
      )}
    </div>
  );
}

export function SeletorPerfilAcesso({
  perfis, carregando, erro, valor, aoEscolher, erroValidacao,
  podeEditarPermissoes = false, empresaId = null, aguardandoConta = false,
}: {
  perfis: PerfilAcesso[];
  carregando: boolean;
  erro: string | null;
  valor: string | null;
  aoEscolher: (id: string) => void;
  erroValidacao?: string | null;
  podeEditarPermissoes?: boolean;
  empresaId?: string | null;
  /** Super-admin ainda não escolheu a conta: não há o que listar AINDA. */
  aguardandoConta?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');

  // Busca só quando a lista é grande o bastante para justificar (§16). Uma caixa
  // de busca sobre quatro opções é ruído.
  const precisaBuscar = perfis.length > 6;

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return perfis;
    return perfis.filter((p) => `${p.nome} ${p.descricao || ''}`.toLowerCase().includes(termo));
  }, [perfis, busca]);

  const escolhido = perfis.find((p) => p.id === valor) || null;

  if (carregando) return <p className="text-sm text-gray-500">Carregando perfis de acesso…</p>;

  if (erro) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="alert">
        {erro}
      </p>
    );
  }

  // Estado de espera ≠ estado de impedimento. Antes, enquanto o super-admin não
  // tinha escolhido a conta, a tela dizia "Nenhum perfil disponível para você
  // atribuir. Peça a um administrador" — acusando de falta de permissão quem só
  // não tinha preenchido o campo anterior.
  if (aguardandoConta) {
    return (
      <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
        Escolha a conta acima para ver os perfis de acesso disponíveis.
      </p>
    );
  }

  if (!perfis.length) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        Nenhum perfil de acesso disponível para você atribuir. Peça a um administrador da empresa.
      </p>
    );
  }

  return (
    <div>
      {/* FECHADO: mostra o que está escolhido, ou convida a escolher (§12/§14). */}
      {!aberto && (
        <button
          type="button"
          onClick={() => { setAberto(true); setBusca(''); }}
          className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
            escolhido ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'
          }`}
        >
          <span className="min-w-0">
            {escolhido ? (
              <>
                <span className="block truncate text-sm font-bold text-gray-800">{escolhido.nome}</span>
                {escolhido.descricao && (
                  <span className="mt-0.5 block truncate text-xs text-gray-500">{escolhido.descricao}</span>
                )}
              </>
            ) : (
              <span className="block text-sm text-gray-500">Selecionar perfil de acesso</span>
            )}
          </span>
          <span className="shrink-0 text-xs font-bold text-blue-600">
            {escolhido ? 'Alterar perfil' : <ChevronDown size={16} />}
          </span>
        </button>
      )}

      {/* ABERTO: as opções. Fecha ao escolher (§14). */}
      {aberto && (
        <div className="rounded-lg border border-gray-200 bg-white p-2">
          {precisaBuscar && (
            <div className="relative mb-2">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar perfil"
                className={`${CLASSE_INPUT} pl-8`}
                aria-label="Buscar perfil de acesso"
              />
            </div>
          )}

          <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1" role="radiogroup" aria-label="Perfil de acesso">
            {filtrados.map((p) => {
              const selecionado = p.id === valor;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={selecionado}
                  onClick={() => { aoEscolher(p.id); setAberto(false); }}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                    selecionado ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <span className="block text-sm font-bold text-gray-800">{p.nome}</span>
                  {p.descricao && <span className="mt-0.5 block text-xs text-gray-500">{p.descricao}</span>}
                </button>
              );
            })}
            {filtrados.length === 0 && (
              <p className="px-1 py-2 text-sm text-gray-500">Nenhum perfil encontrado com esse termo.</p>
            )}
          </div>

          {escolhido && (
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="mt-2 w-full rounded-lg px-3 py-1.5 text-xs font-bold text-gray-500 hover:bg-gray-50"
            >
              Cancelar
            </button>
          )}
        </div>
      )}

      {escolhido && !aberto && (
        <ResumoDoPerfil perfil={escolhido} podeEditarPermissoes={podeEditarPermissoes} empresaId={empresaId} />
      )}

      {erroValidacao && <p className="mt-1 text-xs text-red-600" role="alert">{erroValidacao}</p>}
    </div>
  );
}
