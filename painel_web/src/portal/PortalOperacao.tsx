import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import portalApi, { mensagemDeErro } from './portalApi';
import {
  Carregando, Cartao, DataCurta, Erro, FOCO_CLARO, ProgressoEntrega, Quantidade,
  SeletorArquivo, Situacao, type EntregaProgresso,
} from './PortalUI';
import PortalCorrigirSolicitacao from './PortalCorrigirSolicitacao';
import { ArquivoPreviewModal, type ArquivoPreview } from '../components/ArquivoPreviewModal';
import { diferencasEntreEnvios } from '../shared/comparacaoEnvios';

type Detalhe = {
  request_id: string;
  reference_code: string;
  cargo_name: string;
  destination_name: string;
  quantity_unit: string;
  origens: { nome: string; quantidade: number }[];
  total_quantidade: number;
  window_start: string | null;
  window_end: string | null;
  notes: string | null;
  status_externo: string;
  status_rotulo: string;
  motivo_transportadora: string | null;
  versao_atual: number | null;
  revisoes: number;
  comprovante_disponivel: boolean;
  // Progresso em quantidade, calculado pelo backend quando é possível medir com
  // confiança. Só existe aqui porque a pergunta do cliente com carga parada é
  // "quanto falta?" — e ela ficava sem resposta na tela (VIS-02).
  entrega: EntregaProgresso | null;
  proxima_acao: { rotulo: string; tipo: string };
  linha_do_tempo: { chave: string; rotulo: string; em: string }[];
  atualizado_em: string | null;
};

type Documento = {
  id: string; origem: string; nome: string; descricao: string | null;
  enviado_em: string; mime_type?: string | null;
};
type Documentos = { enviados_por_mim: Documento[]; da_transportadora: Documento[]; comprovantes: Documento[] };
type VersaoHistorico = {
  versao: number; enviada_em: string; total_quantidade: number | null; quantity_unit: string | null;
  cargo_name?: string | null; destination_name?: string | null;
  origens: { nome: string; quantidade: number }[]; decisao: string | null; motivo: string | null;
};

// Detalhe do pedido: o que eu pedi, onde está, o que preciso fazer, e onde
// estão meus documentos e o comprovante (§53). Nenhum conceito interno aparece.

export default function PortalOperacao() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  const [documentos, setDocumentos] = useState<Documentos | null>(null);
  const [historico, setHistorico] = useState<VersaoHistorico[] | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [corrigindo, setCorrigindo] = useState(params.get('acao') === 'corrigir');
  // Confirmação de envio (VIS-05). O `?enviada=1` já era escrito na URL pelo
  // formulário e nunca era lido: quem enviava o pedido não recebia resposta
  // nenhuma, só a troca de tela. Consumimos uma vez e limpamos a URL, para um
  // F5 meia hora depois não ressuscitar o aviso (§28).
  const [recemEnviado, setRecemEnviado] = useState(params.get('enviada') === '1');
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const [enviandoArquivo, setEnviandoArquivo] = useState(false);
  const [arquivoSelecionado, setArquivoSelecionado] = useState<string | null>(null);
  const [preview, setPreview] = useState<ArquivoPreview | null>(null);
  const clientRequestId = useRef<string | null>(null);

  useEffect(() => {
    if (params.get('enviada') !== '1') return;
    const limpo = new URLSearchParams(params);
    limpo.delete('enviada');
    setParams(limpo, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [d, docs] = await Promise.all([
        portalApi.get(`/portal/embarcador/operacoes/${id}`),
        portalApi.get(`/portal/embarcador/solicitacoes/${id}/documentos`),
      ]);
      setDetalhe(d.data);
      setDocumentos(docs.data);
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível carregar este pedido.'));
    } finally {
      setCarregando(false);
    }
  }, [id]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function carregarHistorico() {
    try {
      const { data } = await portalApi.get(`/portal/embarcador/solicitacoes/${id}/historico`);
      setHistorico(data.itens || []);
    } catch (e) {
      setErroArquivo(mensagemDeErro(e, 'Não foi possível carregar o histórico.'));
    }
  }

  // Abrir um arquivo é sempre em dois passos: pedimos a URL assinada (curta) no
  // momento do clique. Nunca guardamos link permanente na tela. O arquivo abre
  // EM PRÉ-VISUALIZAÇÃO (§34): quem procura um comprovante quer conferir se é o
  // certo, não baixar um arquivo para depois abrir em outro programa.
  async function abrir(documentoId: string, tipo: 'MEU' | 'COMPARTILHADO', nome: string, mime?: string | null) {
    setAbrindo(documentoId);
    setErroArquivo(null);
    try {
      const { data } = await portalApi.get(`/portal/embarcador/documentos/${documentoId}/url`, { params: { tipo } });
      setPreview({ url: data.url, nome, mime: data.mime_type || mime || null });
    } catch (e) {
      setErroArquivo(mensagemDeErro(e, 'Não foi possível abrir o arquivo. Tente novamente.'));
    } finally {
      setAbrindo(null);
    }
  }

  async function enviarArquivo(arquivo: File) {
    setErroArquivo(null);
    setEnviandoArquivo(true);
    setArquivoSelecionado(arquivo.name);
    if (!clientRequestId.current) {
      clientRequestId.current = `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }
    try {
      const form = new FormData();
      form.append('arquivo', arquivo);
      form.append('nome_documento', arquivo.name);
      form.append('client_request_id', clientRequestId.current);
      await portalApi.post(`/portal/embarcador/solicitacoes/${id}/documentos`, form);
      clientRequestId.current = null;
      setArquivoSelecionado(null);
      await carregar();
    } catch (e) {
      setErroArquivo(mensagemDeErro(e, 'O arquivo não pôde ser enviado. Tente novamente.'));
    } finally {
      setEnviandoArquivo(false);
    }
  }

  if (carregando) return <Carregando />;
  if (erro) return <Erro mensagem={erro} aoTentarNovamente={carregar} />;
  if (!detalhe) return null;

  if (corrigindo) {
    return (
      <PortalCorrigirSolicitacao
        detalhe={detalhe}
        aoCancelar={() => { setCorrigindo(false); params.delete('acao'); setParams(params, { replace: true }); }}
        aoConcluir={async () => {
          setCorrigindo(false);
          params.delete('acao');
          setParams(params, { replace: true });
          await carregar();
        }}
      />
    );
  }

  const precisaCorrigir = detalhe.proxima_acao.tipo === 'REVISAR';
  const listaDocs = documentos || { enviados_por_mim: [], da_transportadora: [], comprovantes: [] };
  const entregaParcial = detalhe.status_externo === 'PARCIALMENTE_ENTREGUE';

  return (
    <div className="space-y-5">
      <div>
        <Link
          to="/portal/embarcador/pedidos"
          className={`rounded text-xs text-emerald-700 hover:underline ${FOCO_CLARO}`}
        >
          ← Voltar
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-slate-900">{detalhe.cargo_name} · {detalhe.destination_name}</h1>
            <p className="mt-0.5 text-xs text-slate-500">Referência {detalhe.reference_code}</p>
          </div>
          <Situacao codigo={detalhe.status_externo} rotulo={detalhe.status_rotulo} />
        </div>
      </div>

      {/* Confirmação do envio recém-feito. Sem isto, quem clicava em "Enviar
          pedido" só via a tela trocar e ficava sem saber se deu certo. */}
      {recemEnviado && (
        <Cartao tom="sucesso">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-emerald-900" role="status">Pedido enviado com sucesso.</h2>
              <p className="mt-1 text-sm text-emerald-900">
                A transportadora vai analisar sua solicitação. Você acompanha a resposta por aqui.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setRecemEnviado(false)}
              className={`rounded-lg border border-emerald-300 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 ${FOCO_CLARO}`}
            >
              Entendi
            </button>
          </div>
        </Cartao>
      )}

      {/* O que a transportadora escreveu PARA o embarcador — em destaque, com a
          ação junto. Um motivo sem botão deixaria a pessoa sem saída. */}
      {detalhe.motivo_transportadora && (
        <Cartao tom={precisaCorrigir ? 'atencao' : 'erro'}>
          <h2 className={`text-sm font-semibold ${precisaCorrigir ? 'text-amber-900' : 'text-red-900'}`}>
            {precisaCorrigir ? 'A transportadora pediu ajustes' : 'A transportadora não pôde atender'}
          </h2>
          <p className={`mt-1 whitespace-pre-line text-sm ${precisaCorrigir ? 'text-amber-900' : 'text-red-900'}`}>
            {detalhe.motivo_transportadora}
          </p>
          {precisaCorrigir && (
            <button
              type="button" onClick={() => setCorrigindo(true)}
              className={`mt-3 w-full rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 sm:w-auto ${FOCO_CLARO}`}
            >
              Corrigir pedido
            </button>
          )}
        </Cartao>
      )}

      <Cartao tom={entregaParcial ? 'atencao' : 'neutro'}>
        <h2 className={`text-sm font-semibold ${entregaParcial ? 'text-amber-900' : 'text-slate-900'}`}>Resumo</h2>
        {entregaParcial && (
          <p className="mt-1 text-xs text-amber-800">
            Parte da carga já foi entregue e o restante continua programado.
          </p>
        )}
        <dl className="mt-3 space-y-3 text-sm">
          {/* Progresso vem primeiro quando existe: é a informação que a pessoa
              abre a tela para ver. Só aparece com dado do backend — nunca é
              calculado aqui a partir de contagem de viagens (§14). */}
          {detalhe.entrega && (
            <ProgressoEntrega entrega={detalhe.entrega} unidade={detalhe.quantity_unit} />
          )}
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Locais de coleta</dt>
            <dd>
              <ul className="mt-1 space-y-1">
                {detalhe.origens.map((o) => (
                  <li key={o.nome} className="flex justify-between gap-4 text-slate-800">
                    <span>{o.nome}</span>
                    <Quantidade valor={o.quantidade} unidade={detalhe.quantity_unit} />
                  </li>
                ))}
              </ul>
              <p className="mt-2 border-t border-slate-100 pt-2 font-medium text-slate-900">
                Total: <Quantidade valor={detalhe.total_quantidade} unidade={detalhe.quantity_unit} />
              </p>
            </dd>
          </div>
          {(detalhe.window_start || detalhe.window_end) && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Período desejado</dt>
              <dd className="text-slate-800">
                <DataCurta valor={detalhe.window_start} /> até <DataCurta valor={detalhe.window_end} />
              </dd>
            </div>
          )}
          {detalhe.notes && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Observações</dt>
              <dd className="whitespace-pre-line text-slate-800">{detalhe.notes}</dd>
            </div>
          )}
        </dl>

        {detalhe.revisoes > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => (historico ? setHistorico(null) : void carregarHistorico())}
              className={`rounded text-xs text-emerald-700 hover:underline ${FOCO_CLARO}`}
            >
              {historico ? 'Ocultar histórico de envios' : `Ver histórico de envios (${detalhe.revisoes + 1})`}
            </button>
            {historico && (
              <ul className="mt-3 space-y-3">
                {/* Ordem cronológica CRESCENTE (§42): envio 1, o que a
                    transportadora pediu, envio 2. Ler causa antes de correção é
                    o que torna a história compreensível — e casa com a linha do
                    tempo logo abaixo, que sempre foi crescente. */}
                {historico.map((v, indice) => {
                  const anterior = indice > 0 ? historico[indice - 1] : null;
                  const mudancas = diferencasEntreEnvios(anterior, v);
                  const ehAtual = v.versao === detalhe.versao_atual;
                  return (
                    <li key={v.versao} className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                      <div className="flex flex-wrap justify-between gap-2">
                        <span className="font-medium">
                          Envio {v.versao}
                          {ehAtual && (
                            <span className="ml-2 rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-900">
                              Envio atual
                            </span>
                          )}
                        </span>
                        <span><DataCurta valor={v.enviada_em} /></span>
                      </div>
                      <p className="mt-1">
                        Total: <Quantidade valor={v.total_quantidade} unidade={v.quantity_unit} />
                        {' · '}{v.origens.length} {v.origens.length === 1 ? 'local' : 'locais'}
                      </p>

                      {/* O mesmo comparativo que a transportadora vê (VIS-09).
                          Antes o embarcador recebia dois totais soltos e tinha
                          que comparar de cabeça o que ele próprio mudou. */}
                      {mudancas.length > 0 && (
                        <div className="mt-2 rounded border border-slate-200 bg-white p-2">
                          <p className="font-medium text-slate-800">O que mudou neste envio</p>
                          <ul className="mt-1 list-disc space-y-0.5 pl-4">
                            {mudancas.map((m) => <li key={m}>{m}</li>)}
                          </ul>
                        </div>
                      )}
                      {anterior && mudancas.length === 0 && (
                        <p className="mt-2 text-slate-600">Reenviado sem alterar os dados da carga.</p>
                      )}

                      {v.decisao === 'CHANGES_REQUESTED' && v.motivo && (
                        <p className="mt-2 text-amber-800">Ajustes pedidos: {v.motivo}</p>
                      )}
                      {v.decisao === 'REJECTED' && v.motivo && (
                        <p className="mt-2 text-red-800">Não atendido: {v.motivo}</p>
                      )}
                      {v.decisao === 'ACCEPTED' && <p className="mt-2 text-emerald-800">Aceito pela transportadora.</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </Cartao>

      {detalhe.linha_do_tempo.length > 0 && (
        <Cartao>
          <h2 className="text-sm font-semibold text-slate-900">Andamento</h2>
          <ol className="mt-3 space-y-3">
            {detalhe.linha_do_tempo.map((m) => (
              <li key={`${m.chave}-${m.em}`} className="flex gap-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-600" aria-hidden="true" />
                <div>
                  <p className="text-sm text-slate-800">{m.rotulo}</p>
                  <p className="text-xs text-slate-500"><DataCurta valor={m.em} /></p>
                </div>
              </li>
            ))}
          </ol>
        </Cartao>
      )}

      {listaDocs.comprovantes.length > 0 && (
        <Cartao tom="sucesso">
          <h2 className="text-sm font-semibold text-emerald-900">Comprovante de entrega</h2>
          <ul className="mt-2 divide-y divide-emerald-100">
            {listaDocs.comprovantes.map((d) => (
              <li key={d.id} className="py-2 sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
                <span className="text-sm text-slate-800">{d.nome}</span>
                <button
                  type="button" onClick={() => abrir(d.id, 'COMPARTILHADO', d.nome, d.mime_type)} disabled={abrindo === d.id}
                  className={`mt-2 w-full rounded-lg bg-emerald-700 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-60 sm:mt-0 sm:w-auto sm:py-1.5 ${FOCO_CLARO}`}
                >
                  {abrindo === d.id ? 'Abrindo…' : 'Ver comprovante'}
                </button>
              </li>
            ))}
          </ul>
        </Cartao>
      )}

      <Cartao>
        <h2 className="text-sm font-semibold text-slate-900">Documentos</h2>

        {listaDocs.da_transportadora.length > 0 && (
          <div className="mt-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Enviados pela transportadora</p>
            <ul className="mt-1 divide-y divide-slate-100">
              {listaDocs.da_transportadora.map((d) => (
                <li key={d.id} className="py-2 sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
                  <span className="text-sm text-slate-800">{d.nome}</span>
                  <button
                    type="button" onClick={() => abrir(d.id, 'COMPARTILHADO', d.nome, d.mime_type)} disabled={abrindo === d.id}
                    className={`mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-60 sm:mt-0 sm:w-auto sm:py-1.5 ${FOCO_CLARO}`}
                  >
                    {abrindo === d.id ? 'Abrindo…' : 'Ver'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Enviados por você</p>
          {listaDocs.enviados_por_mim.length === 0 ? (
            <p className="mt-1 text-sm text-slate-600">
              Você ainda não enviou documentos para este pedido.
            </p>
          ) : (
            <ul className="mt-1 divide-y divide-slate-100">
              {listaDocs.enviados_por_mim.map((d) => (
                <li key={d.id} className="py-2 sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
                  <span className="text-sm text-slate-800">{d.nome}</span>
                  <button
                    type="button" onClick={() => abrir(d.id, 'MEU', d.nome, d.mime_type)} disabled={abrindo === d.id}
                    className={`mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-60 sm:mt-0 sm:w-auto sm:py-1.5 ${FOCO_CLARO}`}
                  >
                    {abrindo === d.id ? 'Abrindo…' : 'Ver'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 border-t border-slate-100 pt-3">
          <SeletorArquivo
            id="novo-doc"
            rotulo="Enviar um documento"
            ajuda="PDF, XML ou imagem, até 15 MB."
            accept="application/pdf,text/xml,application/xml,image/jpeg,image/png,image/webp"
            desabilitado={enviandoArquivo}
            nomeSelecionado={arquivoSelecionado}
            aoSelecionar={(f) => void enviarArquivo(f)}
          />
          {enviandoArquivo && <p className="mt-2 text-xs text-slate-600" role="status">Enviando…</p>}
        </div>

        {erroArquivo && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{erroArquivo}</p>
        )}
      </Cartao>

      <ArquivoPreviewModal arquivo={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
