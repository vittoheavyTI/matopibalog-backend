import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import portalApi, { mensagemDeErro } from './portalApi';
import { Carregando, Cartao, DataCurta, Erro, FOCO_CLARO, Vazio } from './PortalUI';
import { ArquivoPreviewModal, type ArquivoPreview } from '../components/ArquivoPreviewModal';

type Documento = {
  id: string;
  origem: 'ENVIADO_POR_MIM' | 'ENVIADO_PELA_TRANSPORTADORA' | 'COMPROVANTE';
  nome: string;
  descricao: string | null;
  enviado_em: string;
  mime_type?: string | null;
  request_id: string;
  pedido_referencia: string | null;
  pedido_titulo: string | null;
};

// Todos os arquivos, de todos os pedidos, em um lugar só.
//
// Existe porque a pessoa procura pelo ARQUIVO ("cadê o canhoto da entrega?") e
// não pelo pedido que o originou — antes era preciso lembrar em qual pedido ele
// estava. A separação por origem continua explícita: quem mandou o quê nunca
// fica ambíguo (§61).

const ROTULO_ORIGEM: Record<Documento['origem'], string> = {
  COMPROVANTE: 'Comprovante de entrega',
  ENVIADO_PELA_TRANSPORTADORA: 'Enviado pela transportadora',
  ENVIADO_POR_MIM: 'Enviado por você',
};

const ORDEM_GRUPOS: Documento['origem'][] = [
  'COMPROVANTE', 'ENVIADO_PELA_TRANSPORTADORA', 'ENVIADO_POR_MIM',
];

export default function PortalDocumentos() {
  const [itens, setItens] = useState<Documento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const [preview, setPreview] = useState<ArquivoPreview | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const { data } = await portalApi.get('/portal/embarcador/documentos');
      setItens(data.itens || []);
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível carregar seus documentos agora.'));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  // A URL assinada continua sendo pedida no clique, e é curta: nunca guardamos
  // link permanente na tela (§39/§105).
  async function abrir(doc: Documento) {
    setAbrindo(doc.id);
    setErroArquivo(null);
    try {
      const tipo = doc.origem === 'ENVIADO_POR_MIM' ? 'MEU' : 'COMPARTILHADO';
      const { data } = await portalApi.get(`/portal/embarcador/documentos/${doc.id}/url`, { params: { tipo } });
      setPreview({ url: data.url, nome: doc.nome, mime: data.mime_type || doc.mime_type || null });
    } catch (e) {
      setErroArquivo(mensagemDeErro(e, 'Não foi possível abrir o arquivo. Tente novamente.'));
    } finally {
      setAbrindo(null);
    }
  }

  const grupos = useMemo(() => {
    const mapa = new Map<Documento['origem'], Documento[]>();
    for (const d of itens) {
      if (!mapa.has(d.origem)) mapa.set(d.origem, []);
      mapa.get(d.origem)!.push(d);
    }
    return ORDEM_GRUPOS.filter((g) => mapa.has(g)).map((g) => [g, mapa.get(g)!] as const);
  }, [itens]);

  if (carregando) return <Carregando />;
  if (erro) return <Erro mensagem={erro} aoTentarNovamente={carregar} />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Documentos</h1>
        <p className="mt-1 max-w-xl text-sm text-slate-600">
          Os arquivos de todos os seus pedidos: comprovantes de entrega, documentos que a
          transportadora disponibilizou e os que você enviou.
        </p>
      </div>

      {erroArquivo && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{erroArquivo}</p>
      )}

      {itens.length === 0 && (
        <Vazio
          titulo="Nenhum documento ainda"
          descricao="Comprovantes de entrega e documentos da transportadora aparecem aqui assim que ficam disponíveis. Você também pode enviar documentos dentro de cada pedido."
        />
      )}

      {grupos.map(([origem, docs]) => (
        <Cartao key={origem} tom={origem === 'COMPROVANTE' ? 'sucesso' : 'neutro'}>
          <h2 className={`text-sm font-semibold ${origem === 'COMPROVANTE' ? 'text-emerald-900' : 'text-slate-900'}`}>
            {ROTULO_ORIGEM[origem]}
          </h2>
          <ul className="mt-2 divide-y divide-slate-100">
            {docs.map((d) => (
              <li key={d.id} className="py-3 sm:flex sm:items-center sm:justify-between sm:gap-3">
                <div className="min-w-0 sm:flex-1">
                  <p className="text-sm text-slate-800">{d.nome}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {d.pedido_referencia && (
                      <>
                        <Link
                          to={`/portal/embarcador/pedidos/${d.request_id}`}
                          className={`rounded text-emerald-700 hover:underline ${FOCO_CLARO}`}
                        >
                          {d.pedido_referencia}
                        </Link>
                        {d.pedido_titulo && <> · {d.pedido_titulo}</>}
                        {' · '}
                      </>
                    )}
                    <DataCurta valor={d.enviado_em} />
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => abrir(d)}
                  disabled={abrindo === d.id}
                  className={`mt-2 w-full rounded-lg px-3 py-2 text-center text-xs font-medium sm:mt-0 sm:w-auto sm:py-1.5 ${FOCO_CLARO} ${
                    origem === 'COMPROVANTE'
                      ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                      : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
                  } disabled:opacity-60`}
                >
                  {abrindo === d.id ? 'Abrindo…' : 'Ver'}
                </button>
              </li>
            ))}
          </ul>
        </Cartao>
      ))}

      <ArquivoPreviewModal arquivo={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
