import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import portalApi, { mensagemDeErro } from './portalApi';
import { Carregando, Cartao, DataCurta, Erro, FOCO_CLARO, Quantidade, Situacao, Vazio } from './PortalUI';

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
  tem_operacao?: boolean;
  proxima_acao: { rotulo: string; tipo: string };
  atualizado_em: string | null;
};

// Duas listas, cada pedido em UMA delas (VIS-10).
//
// A divisão é por PROVENIÊNCIA, não por status: "Transportes" é o que virou
// operação de verdade (`tem_operacao`), "Pedidos" é todo o resto — o que ainda
// está sendo decidido e o que terminou sem virar transporte. Um pedido aceito
// cuja operação ainda não foi criada fica em "Pedidos" como "Pedido aceito"
// (§48): anunciá-lo como transporte seria prometer um acompanhamento que ainda
// não existe.
//
// Antes, "Solicitações" não filtrava nada e o mesmo item aparecia nas duas abas,
// sem que a diferença estivesse explicada em lugar nenhum.

// Lista em CARTÕES, não em tabela larga (§81/§82/§130). Uma tabela com sete
// colunas obriga rolagem horizontal no celular e é justamente a "planilha" que o
// portal não deve ser. Cada item responde: o que é, onde está, e o que fazer.
export default function PortalLista({ modo }: { modo: 'pedidos' | 'transportes' }) {
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

  const daAba = useMemo(
    () => itens.filter((i) => (modo === 'transportes' ? i.tem_operacao === true : i.tem_operacao !== true)),
    [itens, modo],
  );

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return daAba;
    return daAba.filter((i) => [i.reference_code, i.cargo_name, i.destination_name]
      .filter(Boolean).some((c) => c.toLowerCase().includes(termo)));
  }, [daAba, busca]);

  if (carregando) return <Carregando />;
  if (erro) return <Erro mensagem={erro} aoTentarNovamente={carregar} />;

  const titulo = modo === 'transportes' ? 'Transportes' : 'Pedidos';
  const explicacao = modo === 'transportes'
    ? 'Pedidos que a transportadora aceitou e já viraram transporte. Acompanhe o andamento e os comprovantes por aqui.'
    : 'Pedidos que você enviou e ainda estão sendo decididos, e os que foram encerrados sem virar transporte.';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{titulo}</h1>
          <p className="mt-1 max-w-xl text-sm text-slate-600">{explicacao}</p>
        </div>
        {modo === 'pedidos' && (
          <Link
            to="/portal/embarcador/pedidos/novo"
            className={`rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 ${FOCO_CLARO}`}
          >
            Pedir um transporte
          </Link>
        )}
      </div>

      {daAba.length > 3 && (
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
            : (modo === 'transportes' ? 'Nenhum transporte em andamento' : 'Nenhum pedido ainda')}
          descricao={busca.trim()
            ? 'Tente outro termo ou limpe a busca.'
            : (modo === 'transportes'
              ? 'Assim que a transportadora aceitar um pedido seu e montar a operação, o transporte aparece aqui para acompanhamento.'
              : 'Quando precisar mover uma carga, faça um pedido e acompanhe a resposta por aqui.')}
          acao={modo === 'pedidos' && !busca.trim() ? (
            <Link
              to="/portal/embarcador/pedidos/novo"
              className={`inline-block rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 ${FOCO_CLARO}`}
            >
              Pedir um transporte
            </Link>
          ) : undefined}
        />
      )}

      <ul className="space-y-3">
        {filtrados.map((op) => {
          const destino = op.proxima_acao.tipo === 'REVISAR'
            ? `/portal/embarcador/pedidos/${op.request_id}?acao=corrigir`
            : `/portal/embarcador/pedidos/${op.request_id}`;
          return (
            <li key={op.request_id}>
              <Cartao tom={op.status_externo === 'PARCIALMENTE_ENTREGUE' ? 'atencao' : 'neutro'}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/portal/embarcador/pedidos/${op.request_id}`}
                      className={`rounded text-sm font-medium text-slate-900 hover:underline ${FOCO_CLARO}`}
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
                      to={destino}
                      className={`block w-full rounded-lg bg-emerald-700 px-3 py-2 text-center text-xs font-medium text-white hover:bg-emerald-800 sm:inline-block sm:w-auto sm:py-1.5 ${FOCO_CLARO}`}
                    >
                      {op.proxima_acao.rotulo}
                    </Link>
                  </div>
                )}
              </Cartao>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
