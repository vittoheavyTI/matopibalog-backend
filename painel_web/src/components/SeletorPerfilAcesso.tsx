import { useEffect, useMemo, useState } from 'react';
import api from '../api';

// Seletor de PERFIL DE ACESSO.
//
// A lista vem já filtrada pelo servidor (`GET /admin/perfis-acesso`): o que este
// componente mostra é o que o ator pode legitimamente conceder. Ele não recebe
// todos os perfis para decidir sozinho o que esconder — filtro de tela não é
// controle de acesso, e a mesma regra é reconferida na gravação.
//
// A tela fala "perfil de acesso", nunca "template" (§5/§107). E explica o efeito
// em uma linha — não despeja a matriz de permissões, que é outra tela e outra
// autoridade (§51/§52).

export type PerfilAcesso = {
  id: string;
  stable_key: string;
  nome: string;
  descricao: string | null;
  resumo: string[];
  editavel: boolean;
};

export function useePerfisAcesso(ativo: boolean) {
  const [perfis, setPerfis] = useState<PerfilAcesso[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    setCarregando(true);
    setErro(null);
    api.get('/admin/perfis-acesso')
      .then((r) => { if (vivo) setPerfis(r.data?.itens || []); })
      .catch((e) => {
        if (!vivo) return;
        const msg = e?.response?.data?.message;
        setErro(typeof msg === 'string' && msg.trim()
          ? msg
          : 'Não foi possível carregar os perfis de acesso.');
      })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [ativo]);

  return { perfis, carregando, erro };
}

export function SeletorPerfilAcesso({
  perfis, carregando, erro, valor, aoEscolher, erroValidacao,
}: {
  perfis: PerfilAcesso[];
  carregando: boolean;
  erro: string | null;
  valor: string | null;
  aoEscolher: (id: string) => void;
  erroValidacao?: string | null;
}) {
  const [busca, setBusca] = useState('');

  // Busca só aparece quando a lista é grande o bastante para justificar (§50).
  // Uma caixa de busca sobre quatro opções é ruído.
  const precisaBuscar = perfis.length > 6;

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return perfis;
    return perfis.filter((p) => `${p.nome} ${p.descricao || ''}`.toLowerCase().includes(termo));
  }, [perfis, busca]);

  const escolhido = perfis.find((p) => p.id === valor) || null;

  if (carregando) {
    return <p className="text-sm text-gray-500">Carregando perfis de acesso…</p>;
  }

  if (erro) {
    return (
      <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800" role="alert">
        {erro}
      </p>
    );
  }

  if (!perfis.length) {
    // Honesto sobre a causa: ou a empresa não tem perfis provisionados, ou este
    // ator não pode conceder nenhum deles.
    return (
      <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
        Nenhum perfil de acesso disponível para você atribuir. Peça a um administrador da empresa.
      </p>
    );
  }

  return (
    <div>
      {precisaBuscar && (
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar perfil"
          className="mb-2 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
          aria-label="Buscar perfil de acesso"
        />
      )}

      <div className="space-y-2 max-h-56 overflow-y-auto pr-1" role="radiogroup" aria-label="Perfil de acesso">
        {filtrados.map((p) => {
          const selecionado = p.id === valor;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={selecionado}
              onClick={() => aoEscolher(p.id)}
              className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                selecionado
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <span className="block text-sm font-bold text-gray-800">{p.nome}</span>
              {p.descricao && <span className="mt-0.5 block text-xs text-gray-500">{p.descricao}</span>}
            </button>
          );
        })}
        {filtrados.length === 0 && (
          <p className="text-sm text-gray-500">Nenhum perfil encontrado com esse termo.</p>
        )}
      </div>

      {/* Resumo do efeito em linguagem de negócio, não a matriz de permissões. */}
      {escolhido && escolhido.resumo.length > 0 && (
        <div className="mt-2 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
          <p className="text-xs font-bold text-gray-600">Esta pessoa poderá:</p>
          <ul className="mt-1 space-y-0.5">
            {escolhido.resumo.map((linha) => (
              <li key={linha} className="text-xs text-gray-600">· {linha}</li>
            ))}
          </ul>
        </div>
      )}

      {erroValidacao && <p className="mt-1 text-xs text-red-600" role="alert">{erroValidacao}</p>}
    </div>
  );
}
