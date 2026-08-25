import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import portalApi, { mensagemDeErro } from './portalApi';
import { Carregando, Cartao, DataCurta, Erro, Quantidade, Situacao } from './PortalUI';
import PortalCorrigirSolicitacao from './PortalCorrigirSolicitacao';

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
  proxima_acao: { rotulo: string; tipo: string };
  linha_do_tempo: { chave: string; rotulo: string; em: string }[];
  atualizado_em: string | null;
};

type Documento = { id: string; origem: string; nome: string; descricao: string | null; enviado_em: string };
type Documentos = { enviados_por_mim: Documento[]; da_transportadora: Documento[]; comprovantes: Documento[] };
type VersaoHistorico = {
  versao: number; enviada_em: string; total_quantidade: number | null; quantity_unit: string | null;
  origens: { nome: string; quantidade: number }[]; decisao: string | null; motivo: string | null;
};

// Detalhe da operação: o que eu pedi, onde está, o que preciso fazer, e onde
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
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const [enviandoArquivo, setEnviandoArquivo] = useState(false);
  const inputArquivo = useRef<HTMLInputElement>(null);
  const clientRequestId = useRef<string | null>(null);

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
      setErro(mensagemDeErro(e, 'Não foi possível carregar esta operação.'));
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
  // momento do clique. Nunca guardamos link permanente na tela.
  async function abrir(documentoId: string, tipo: 'MEU' | 'COMPARTILHADO') {
    setAbrindo(documentoId);
    setErroArquivo(null);
    try {
      const { data } = await portalApi.get(`/portal/embarcador/documentos/${documentoId}/url`, { params: { tipo } });
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setErroArquivo(mensagemDeErro(e, 'Não foi possível abrir o arquivo. Tente novamente.'));
    } finally {
      setAbrindo(null);
    }
  }

  async function enviarArquivo(arquivo: File) {
    setErroArquivo(null);
    setEnviandoArquivo(true);
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
      if (inputArquivo.current) inputArquivo.current.value = '';
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

  return (
    <div className="space-y-5">
      <div>
        <Link to="/portal/embarcador/operacoes" className="text-xs text-emerald-700 hover:underline">← Voltar</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{detalhe.cargo_name} · {detalhe.destination_name}</h1>
            <p className="mt-0.5 text-xs text-slate-500">Referência {detalhe.reference_code}</p>
          </div>
          <Situacao codigo={detalhe.status_externo} rotulo={detalhe.status_rotulo} />
        </div>
      </div>

      {/* O que a transportadora escreveu PARA o embarcador — em destaque, com a
          ação junto. Um motivo sem botão deixaria a pessoa sem saída. */}
      {detalhe.motivo_transportadora && (
        <Cartao className={precisaCorrigir ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50'}>
          <h2 className={`text-sm font-semibold ${precisaCorrigir ? 'text-amber-900' : 'text-red-900'}`}>
            {precisaCorrigir ? 'A transportadora pediu ajustes' : 'A transportadora não pôde atender'}
          </h2>
          <p className={`mt-1 whitespace-pre-line text-sm ${precisaCorrigir ? 'text-amber-900' : 'text-red-900'}`}>
            {detalhe.motivo_transportadora}
          </p>
          {precisaCorrigir && (
            <button
              type="button" onClick={() => setCorrigindo(true)}
              className="mt-3 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
            >
              Corrigir solicitação
            </button>
          )}
        </Cartao>
      )}

      <Cartao>
        <h2 className="text-sm font-semibold text-slate-900">Resumo</h2>
        <dl className="mt-3 space-y-3 text-sm">
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
              className="text-xs text-emerald-700 hover:underline"
            >
              {historico ? 'Ocultar histórico de envios' : `Ver histórico de envios (${detalhe.revisoes + 1})`}
            </button>
            {historico && (
              <ul className="mt-3 space-y-3">
                {historico.map((v) => (
                  <li key={v.versao} className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-medium">Envio {v.versao}</span>
                      <span><DataCurta valor={v.enviada_em} /></span>
                    </div>
                    <p className="mt-1">
                      Total: <Quantidade valor={v.total_quantidade} unidade={v.quantity_unit} />
                      {' · '}{v.origens.length} {v.origens.length === 1 ? 'local' : 'locais'}
                    </p>
                    {v.decisao === 'CHANGES_REQUESTED' && v.motivo && (
                      <p className="mt-1 text-amber-800">Ajustes pedidos: {v.motivo}</p>
                    )}
                    {v.decisao === 'REJECTED' && v.motivo && (
                      <p className="mt-1 text-red-800">Não atendida: {v.motivo}</p>
                    )}
                    {v.decisao === 'ACCEPTED' && <p className="mt-1 text-emerald-800">Aceita pela transportadora.</p>}
                  </li>
                ))}
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
        <Cartao className="border-emerald-200">
          <h2 className="text-sm font-semibold text-slate-900">Comprovante de entrega</h2>
          <ul className="mt-2 divide-y divide-slate-100">
            {listaDocs.comprovantes.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span className="text-sm text-slate-800">{d.nome}</span>
                <button
                  type="button" onClick={() => abrir(d.id, 'COMPARTILHADO')} disabled={abrindo === d.id}
                  className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
                >
                  {abrindo === d.id ? 'Abrindo…' : 'Abrir comprovante'}
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
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span className="text-sm text-slate-800">{d.nome}</span>
                  <button
                    type="button" onClick={() => abrir(d.id, 'COMPARTILHADO')} disabled={abrindo === d.id}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {abrindo === d.id ? 'Abrindo…' : 'Abrir'}
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
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span className="text-sm text-slate-800">{d.nome}</span>
                  <button
                    type="button" onClick={() => abrir(d.id, 'MEU')} disabled={abrindo === d.id}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {abrindo === d.id ? 'Abrindo…' : 'Abrir'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 border-t border-slate-100 pt-3">
          <label htmlFor="novo-doc" className="block text-sm font-medium text-slate-700">
            Enviar um documento
          </label>
          <input
            id="novo-doc" ref={inputArquivo} type="file" disabled={enviandoArquivo}
            accept="application/pdf,text/xml,application/xml,image/jpeg,image/png,image/webp"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void enviarArquivo(f); }}
            className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-700 file:px-3 file:py-1.5 file:text-sm file:text-white hover:file:bg-emerald-800"
          />
          <p className="mt-1 text-xs text-slate-500">PDF, XML ou imagem, até 15 MB.</p>
          {enviandoArquivo && <p className="mt-2 text-xs text-slate-600" role="status">Enviando…</p>}
        </div>

        {erroArquivo && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{erroArquivo}</p>
        )}
      </Cartao>
    </div>
  );
}
