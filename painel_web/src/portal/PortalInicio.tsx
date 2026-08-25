import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import portalApi, { mensagemDeErro } from './portalApi';
import { Carregando, Cartao, DataCurta, Erro, Quantidade, Situacao, Vazio } from './PortalUI';

type Operacao = {
  request_id: string;
  reference_code: string;
  cargo_name: string;
  destination_name: string;
  quantity_unit: string;
  total_quantidade: number;
  status_externo: string;
  status_rotulo: string;
  comprovante_disponivel: boolean;
  proxima_acao: { rotulo: string; tipo: string; request_id: string };
  atualizado_em: string | null;
};

type Resumo = {
  precisam_atencao: Operacao[];
  em_andamento: Operacao[];
  comprovantes_disponiveis: Operacao[];
  recentes: Operacao[];
  contadores: { precisam_atencao: number; em_andamento: number; comprovantes_disponiveis: number; total: number };
};

// Início do portal. Ordenado por URGÊNCIA, não por completude (§79): primeiro o
// que depende do embarcador, depois o que está andando, depois o que ele veio
// buscar (o comprovante). Nada de uma parede de cartões genéricos.

function LinhaOperacao({ op }: { op: Operacao }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <Link to={`/portal/embarcador/operacoes/${op.request_id}`} className="text-sm font-medium text-slate-900 hover:underline">
          {op.cargo_name} · {op.destination_name}
        </Link>
        <p className="mt-0.5 text-xs text-slate-500">
          {op.reference_code} · <Quantidade valor={op.total_quantidade} unidade={op.quantity_unit} />
          {op.atualizado_em && <> · atualizado em <DataCurta valor={op.atualizado_em} /></>}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Situacao codigo={op.status_externo} rotulo={op.status_rotulo} />
        {op.proxima_acao.tipo !== 'NENHUMA' && (
          <Link
            to={op.proxima_acao.tipo === 'REVISAR'
              ? `/portal/embarcador/operacoes/${op.request_id}?acao=corrigir`
              : `/portal/embarcador/operacoes/${op.request_id}`}
            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800"
          >
            {op.proxima_acao.rotulo}
          </Link>
        )}
      </div>
    </li>
  );
}

export default function PortalInicio() {
  const [dados, setDados] = useState<Resumo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const { data } = await portalApi.get('/portal/embarcador/inicio');
      setDados(data);
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível carregar seus dados agora.'));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  if (carregando) return <Carregando />;
  if (erro) return <Erro mensagem={erro} aoTentarNovamente={carregar} />;
  if (!dados) return null;

  const semNada = dados.contadores.total === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-slate-900">Início</h1>
        <Link
          to="/portal/embarcador/solicitacoes/nova"
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
        >
          Pedir um transporte
        </Link>
      </div>

      {semNada && (
        <Vazio
          titulo="Você ainda não pediu nenhum transporte"
          descricao="Quando precisar mover uma carga, descreva o que é, de onde sai e para onde vai. A transportadora recebe o pedido e responde por aqui."
          acao={(
            <Link
              to="/portal/embarcador/solicitacoes/nova"
              className="inline-block rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
            >
              Pedir um transporte
            </Link>
          )}
        />
      )}

      {dados.precisam_atencao.length > 0 && (
        <Cartao className="border-amber-200 bg-amber-50">
          <h2 className="text-sm font-semibold text-amber-900">Precisa da sua atenção</h2>
          <p className="mt-1 text-xs text-amber-800">
            A transportadora pediu ajustes nestes pedidos. Depois de corrigir, eles voltam para análise.
          </p>
          <ul className="mt-2">
            {dados.precisam_atencao.map((op) => <LinhaOperacao key={op.request_id} op={op} />)}
          </ul>
        </Cartao>
      )}

      {dados.comprovantes_disponiveis.length > 0 && (
        <Cartao>
          <h2 className="text-sm font-semibold text-slate-900">Comprovantes disponíveis</h2>
          <ul className="mt-2">
            {dados.comprovantes_disponiveis.map((op) => <LinhaOperacao key={op.request_id} op={op} />)}
          </ul>
        </Cartao>
      )}

      {dados.em_andamento.length > 0 && (
        <Cartao>
          <h2 className="text-sm font-semibold text-slate-900">Em andamento</h2>
          <ul className="mt-2">
            {dados.em_andamento.map((op) => <LinhaOperacao key={op.request_id} op={op} />)}
          </ul>
        </Cartao>
      )}

      {!semNada && dados.precisam_atencao.length === 0 && dados.em_andamento.length === 0
        && dados.comprovantes_disponiveis.length === 0 && (
        <Cartao>
          <p className="text-sm text-slate-600">No momento, nenhuma ação é necessária.</p>
        </Cartao>
      )}
    </div>
  );
}
