import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import portalApi, { mensagemDeErro } from './portalApi';
import { Carregando, Cartao, DataCurta, Erro, Quantidade, Situacao, Vazio } from './PortalUI';

export type OperacaoLista = {
  request_id: string;
  reference_code: string;
  cargo_name: string;
  destination_name: string;
  quantity_unit: string;
  total_quantidade: number;
  window_start: string | null;
  window_end: string | null;
  status_externo: string;
  status_rotulo: string;
  comprovante_disponivel: boolean;
  proxima_acao: { rotulo: string; tipo: string };
  atualizado_em: string | null;
};

// Estados que caracterizam uma operação já em curso — ou seja, o pedido virou
// transporte de verdade. Antes disso ele ainda é só um pedido.
const EM_OPERACAO = new Set([
  'ACEITA', 'EM_PLANEJAMENTO', 'AGENDADA', 'EM_TRANSPORTE', 'ENTREGUE',
  'COMPROVANTE_DISPONIVEL', 'ATUALIZACAO_EM_PROCESSAMENTO',
]);

// Lista em CARTÕES, não em tabela larga (§81/§82/§130). Uma tabela com sete
// colunas obriga rolagem horizontal no celular e é justamente a "planilha" que o
// portal não deve ser. Cada item responde: o que é, onde está, e o que fazer.
export default function PortalLista({ modo }: { modo: 'solicitacoes' | 'operacoes' }) {
  const [itens, setItens] = useState<OperacaoLista[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const { data } = await portalApi.get('/portal/embarcador/operacoes');
      setItens(data.itens || []);
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível carregar sua lista agora.'));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const filtrados = useMemo(() => {
    const base = modo === 'operacoes' ? itens.filter((i) => EM_OPERACAO.has(i.status_externo)) : itens;
    const termo = busca.trim().toLowerCase();
    if (!termo) return base;
    return base.filter((i) => [i.reference_code, i.cargo_name, i.destination_name]
      .filter(Boolean).some((c) => c.toLowerCase().includes(termo)));
  }, [itens, modo, busca]);

  if (carregando) return <Carregando />;
  if (erro) return <Erro mensagem={erro} aoTentarNovamente={carregar} />;

  const titulo = modo === 'operacoes' ? 'Operações' : 'Solicitações';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-slate-900">{titulo}</h1>
        {modo === 'solicitacoes' && (
          <Link
            to="/portal/embarcador/solicitacoes/nova"
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
          >
            Pedir um transporte
          </Link>
        )}
      </div>

      {itens.length > 3 && (
        <label className="block">
          <span className="sr-only">Buscar por referência, carga ou destino</span>
          <input
            type="search" value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por referência, carga ou destino"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
          />
        </label>
      )}

      {filtrados.length === 0 && (
        <Vazio
          titulo={busca.trim()
            ? 'Nada encontrado com esse termo'
            : (modo === 'operacoes' ? 'Nenhuma operação em andamento' : 'Nenhum pedido ainda')}
          descricao={busca.trim()
            ? 'Tente outro termo ou limpe a busca.'
            : (modo === 'operacoes'
              ? 'Assim que a transportadora aceitar um pedido seu, o transporte aparece aqui para acompanhamento.'
              : 'Quando precisar mover uma carga, faça um pedido e acompanhe a resposta por aqui.')}
          acao={modo === 'solicitacoes' && !busca.trim() ? (
            <Link
              to="/portal/embarcador/solicitacoes/nova"
              className="inline-block rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
            >
              Pedir um transporte
            </Link>
          ) : undefined}
        />
      )}

      <ul className="space-y-3">
        {filtrados.map((op) => (
          <li key={op.request_id}>
            <Cartao>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/portal/embarcador/operacoes/${op.request_id}`}
                    className="text-sm font-medium text-slate-900 hover:underline"
                  >
                    {op.cargo_name} · {op.destination_name}
                  </Link>
                  <p className="mt-1 text-xs text-slate-500">
                    {op.reference_code} · <Quantidade valor={op.total_quantidade} unidade={op.quantity_unit} />
                  </p>
                  {(op.window_start || op.window_end) && (
                    <p className="mt-0.5 text-xs text-slate-500">
                      Período: <DataCurta valor={op.window_start} /> até <DataCurta valor={op.window_end} />
                    </p>
                  )}
                </div>
                <Situacao codigo={op.status_externo} rotulo={op.status_rotulo} />
              </div>

              {op.proxima_acao.tipo !== 'NENHUMA' && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <Link
                    to={op.proxima_acao.tipo === 'REVISAR'
                      ? `/portal/embarcador/operacoes/${op.request_id}?acao=corrigir`
                      : `/portal/embarcador/operacoes/${op.request_id}`}
                    className="inline-block rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800"
                  >
                    {op.proxima_acao.rotulo}
                  </Link>
                </div>
              )}
            </Cartao>
          </li>
        ))}
      </ul>
    </div>
  );
}
