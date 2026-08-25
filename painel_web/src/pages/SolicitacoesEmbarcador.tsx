import { useCallback, useEffect, useState } from 'react';
import api from '../api';
import { SolicitacaoEmbarcadorDetalhe } from './SolicitacaoEmbarcadorDetalhe';

// Caixa de entrada de solicitações do Portal do Embarcador — lado da
// TRANSPORTADORA.
//
// Organizada por AÇÃO, não por status (§39/§87). A pergunta que a tela responde
// é "o que eu preciso decidir agora", e não "quantos registros existem". Por
// isso os grupos vêm prontos do backend e o que exige decisão fica no topo.
//
// Aceitar é UM clique (§88): a solicitação já traz tudo o que o embarcador
// declarou, e o objetivo da operação é montado a partir do snapshot aceito.
// Não existe aqui um formulário pedindo ao operador que redigite o pedido.

type Solicitacao = {
  id: string;
  reference_code: string;
  status: string;
  cargo_name: string;
  destination_name: string;
  quantity_unit: string;
  origins: { nome: string; quantidade: number }[];
  total_quantidade: number;
  window_start: string | null;
  window_end: string | null;
  notes: string | null;
  submitted_at: string | null;
  decision_reason: string | null;
  campaign_id: string | null;
  versao_atual: number | null;
  revisoes: number;
  conversao_pendente: boolean;
};

type Caixa = {
  grupos: {
    novas_solicitacoes: Solicitacao[];
    ajustes_reenviados: Solicitacao[];
    conversao_pendente: Solicitacao[];
    aguardando_embarcador: Solicitacao[];
    convertidas_em_operacao: Solicitacao[];
    encerradas: Solicitacao[];
  };
  resumo: {
    aguardando_decisao: number; novas_solicitacoes: number;
    ajustes_reenviados: number; conversao_pendente: number; total: number;
  };
};

function mensagemDeErro(e: unknown, padrao: string): string {
  const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return typeof msg === 'string' && msg.trim() ? msg : padrao;
}

function quantidade(valor: number, unidade: string) {
  const n = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(valor || 0);
  return `${n} ${unidade === 'kg' ? 'kg' : 't'}`;
}

function data(valor: string | null) {
  if (!valor) return '—';
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

export function SolicitacoesEmbarcador() {
  const [caixa, setCaixa] = useState<Caixa | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [agindo, setAgindo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [motivoAberto, setMotivoAberto] = useState<{ id: string; tipo: 'ajustes' | 'recusar' } | null>(null);
  const [motivo, setMotivo] = useState('');
  const [semPermissao, setSemPermissao] = useState(false);
  // Detalhe progressivo (§49): o operador abre uma solicitação por vez, em vez
  // de a lista carregar tudo de todas.
  const [detalheAberto, setDetalheAberto] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const { data: resposta } = await api.get('/shipper-inbox/solicitacoes');
      setCaixa(resposta);
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 403) { setSemPermissao(true); setErro(mensagemDeErro(e, 'Você não tem acesso a esta área.')); }
      else setErro(mensagemDeErro(e, 'Não foi possível carregar as solicitações.'));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  async function aceitar(s: Solicitacao) {
    setAgindo(s.id);
    setAviso(null);
    setErro(null);
    try {
      const { data: r } = await api.post(`/shipper-inbox/solicitacoes/${s.id}/aceitar`);
      // O aceite valeu mesmo se a criação da operação falhou — e é importante
      // dizer isso ao operador em vez de sugerir que nada aconteceu (§44).
      if (r.handoff_error) {
        setAviso('Solicitação aceita. A operação ainda não pôde ser criada — use "Criar operação" para tentar de novo.');
      } else {
        setAviso('Solicitação aceita e operação criada.');
      }
      await carregar();
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível aceitar a solicitação.'));
    } finally {
      setAgindo(null);
    }
  }

  async function reconverter(s: Solicitacao) {
    setAgindo(s.id);
    setAviso(null);
    setErro(null);
    try {
      await api.post(`/shipper-inbox/solicitacoes/${s.id}/reconverter`);
      setAviso('Operação criada.');
      await carregar();
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível criar a operação.'));
    } finally {
      setAgindo(null);
    }
  }

  async function enviarMotivo() {
    if (!motivoAberto) return;
    if (!motivo.trim()) { setErro('Informe o motivo — ele é enviado ao embarcador.'); return; }
    setAgindo(motivoAberto.id);
    setErro(null);
    try {
      const rota = motivoAberto.tipo === 'ajustes' ? 'ajustes' : 'recusar';
      await api.post(`/shipper-inbox/solicitacoes/${motivoAberto.id}/${rota}`, { motivo: motivo.trim() });
      setAviso(motivoAberto.tipo === 'ajustes'
        ? 'Ajustes solicitados. O embarcador foi informado do motivo.'
        : 'Solicitação recusada. O embarcador foi informado do motivo.');
      setMotivoAberto(null);
      setMotivo('');
      await carregar();
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível registrar a decisão.'));
    } finally {
      setAgindo(null);
    }
  }

  if (carregando) {
    return (
      <div className="flex items-center justify-center py-16" role="status" aria-live="polite">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
        <span className="ml-3 text-sm text-gray-600">Carregando solicitações…</span>
      </div>
    );
  }

  if (semPermissao) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6" role="alert">
        <h1 className="text-base font-semibold text-amber-900">Solicitações de embarcadores</h1>
        <p className="mt-2 text-sm text-amber-800">{erro}</p>
        <p className="mt-2 text-sm text-amber-800">
          Peça a um administrador da empresa para conceder o acesso ao Portal do Embarcador no seu perfil.
        </p>
      </div>
    );
  }

  function Grupo({ titulo, descricao, itens, destaque = false, acoes }: {
    titulo: string; descricao?: string; itens: Solicitacao[]; destaque?: boolean;
    acoes?: (s: Solicitacao) => React.ReactNode;
  }) {
    if (!itens.length) return null;
    return (
      <section className={`rounded-xl border p-4 ${destaque ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-white'}`}>
        <h2 className="text-sm font-semibold text-gray-900">{titulo} <span className="font-normal text-gray-500">({itens.length})</span></h2>
        {descricao && <p className="mt-1 text-xs text-gray-600">{descricao}</p>}
        <ul className="mt-3 space-y-3">
          {itens.map((s) => (
            <li key={s.id} className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">{s.cargo_name} · {s.destination_name}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {s.reference_code} · {quantidade(s.total_quantidade, s.quantity_unit)}
                    {s.revisoes > 0 && <> · <span className="text-amber-700">envio {s.versao_atual}</span></>}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Recebida em {data(s.submitted_at)}
                    {(s.window_start || s.window_end) && <> · período {data(s.window_start)} a {data(s.window_end)}</>}
                  </p>
                  {s.origins.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-gray-700">
                      {s.origins.map((o) => (
                        <li key={o.nome}>{o.nome}: {quantidade(o.quantidade, s.quantity_unit)}</li>
                      ))}
                    </ul>
                  )}
                  {s.notes && <p className="mt-2 whitespace-pre-line text-xs text-gray-600">Obs.: {s.notes}</p>}
                  {s.decision_reason && s.status === 'CHANGES_REQUESTED' && (
                    <p className="mt-2 text-xs text-amber-700">Ajustes pedidos: {s.decision_reason}</p>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
                {acoes && acoes(s)}
                <button
                  type="button"
                  onClick={() => setDetalheAberto(detalheAberto === s.id ? null : s.id)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  {detalheAberto === s.id ? 'Ocultar detalhes' : 'Ver detalhes e documentos'}
                </button>
              </div>
              {detalheAberto === s.id && (
                <div className="mt-3">
                  <SolicitacaoEmbarcadorDetalhe requestId={s.id} aoFechar={() => setDetalheAberto(null)} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const botao = 'rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-60';

  function acoesDeDecisao(s: Solicitacao) {
    return (
      <>
        <button type="button" disabled={agindo === s.id} onClick={() => aceitar(s)}
          className={`${botao} bg-emerald-700 text-white hover:bg-emerald-800`}>
          {agindo === s.id ? 'Processando…' : 'Aceitar e criar operação'}
        </button>
        <button type="button" disabled={agindo === s.id}
          onClick={() => { setMotivoAberto({ id: s.id, tipo: 'ajustes' }); setMotivo(''); }}
          className={`${botao} border border-amber-600 text-amber-700 hover:bg-amber-50`}>
          Pedir ajustes
        </button>
        <button type="button" disabled={agindo === s.id}
          onClick={() => { setMotivoAberto({ id: s.id, tipo: 'recusar' }); setMotivo(''); }}
          className={`${botao} border border-gray-300 text-gray-700 hover:bg-gray-50`}>
          Não atender
        </button>
      </>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Solicitações de embarcadores</h1>
        <p className="mt-1 text-sm text-gray-600">
          Pedidos de transporte recebidos pelo Portal do Embarcador.
        </p>
      </div>

      {aviso && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">{aviso}</p>}
      {erro && (
        <div className="rounded-lg bg-red-50 px-3 py-2" role="alert">
          <p className="text-sm text-red-800">{erro}</p>
          <button type="button" onClick={carregar} className="mt-2 text-xs text-red-700 underline">Tentar novamente</button>
        </div>
      )}

      {motivoAberto && (
        <div className="rounded-xl border border-gray-300 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">
            {motivoAberto.tipo === 'ajustes' ? 'O que precisa ser ajustado?' : 'Por que não é possível atender?'}
          </h2>
          <p className="mt-1 text-xs text-gray-600">Este texto é enviado ao embarcador.</p>
          <textarea
            rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)}
            className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder={motivoAberto.tipo === 'ajustes'
              ? 'Ex.: a janela de coleta não é viável; podemos a partir do dia 12.'
              : 'Ex.: não temos veículo disponível para esse volume no período.'}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={enviarMotivo} disabled={agindo !== null}
              className={`${botao} bg-emerald-700 text-white hover:bg-emerald-800`}>
              Enviar
            </button>
            <button type="button" onClick={() => { setMotivoAberto(null); setMotivo(''); }}
              className={`${botao} border border-gray-300 text-gray-700 hover:bg-gray-50`}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {caixa && caixa.resumo.total === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <p className="text-base font-medium text-gray-800">Nenhuma solicitação recebida ainda</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">
            Quando um embarcador convidado enviar um pedido de transporte pelo portal, ele aparece aqui para decisão.
          </p>
        </div>
      )}

      {caixa && (
        <div className="space-y-4">
          <Grupo
            titulo="Ajustes reenviados" destaque
            descricao="O embarcador corrigiu e reenviou. Confira o que mudou antes de decidir."
            itens={caixa.grupos.ajustes_reenviados} acoes={acoesDeDecisao}
          />
          <Grupo
            titulo="Novas solicitações" destaque
            descricao="Aguardando sua decisão."
            itens={caixa.grupos.novas_solicitacoes} acoes={acoesDeDecisao}
          />
          <Grupo
            titulo="Aceitas sem operação criada"
            descricao="O aceite foi registrado, mas a operação ainda não foi criada. O embarcador continua vendo a solicitação como aceita."
            itens={caixa.grupos.conversao_pendente}
            acoes={(s) => (
              <button type="button" disabled={agindo === s.id} onClick={() => reconverter(s)}
                className={`${botao} bg-emerald-700 text-white hover:bg-emerald-800`}>
                {agindo === s.id ? 'Criando…' : 'Criar operação'}
              </button>
            )}
          />
          <Grupo
            titulo="Aguardando o embarcador"
            descricao="Você pediu ajustes e ainda não houve reenvio."
            itens={caixa.grupos.aguardando_embarcador}
          />
          <Grupo titulo="Convertidas em operação" itens={caixa.grupos.convertidas_em_operacao} />
          <Grupo titulo="Encerradas" itens={caixa.grupos.encerradas} />
        </div>
      )}
    </div>
  );
}

export default SolicitacoesEmbarcador;
