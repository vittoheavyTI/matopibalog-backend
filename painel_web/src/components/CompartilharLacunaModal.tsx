import { useEffect, useMemo, useState } from 'react';
import { Share2, AlertTriangle } from 'lucide-react';
import api from '../api';
import { mensagemErro } from '../utils/mensagemErro';
import {
  ModalFormulario, Campo, CLASSE_INPUT, CLASSE_BOTAO_PRIMARIO, CLASSE_BOTAO_SECUNDARIO,
} from './ModalFormulario';

// Compartilhar lacuna de capacidade com a rede privada.
//
// O ponto desta tela é o que ela NÃO pede (§23): carga, origem, destino,
// quantidade, unidade e janela já existem na campanha e vêm prontos do servidor.
// O operador informa só o que não dá para derivar — quais parceiros, prazo e uma
// mensagem opcional.
//
// E o que ela não mostra: preço, ranking, "melhor parceiro", economia estimada.
// E3.6A pede capacidade e recebe disponibilidade declarada. Nada mais.

type Parceiro = { id: string; nome: string; status: string; tipo: 'LITE' | 'CLIENTE' };

type Lacuna = {
  campanha: { id: string; name: string; cargo_name: string | null; planned_start: string | null; planned_end: string | null };
  pode_compartilhar: boolean;
  motivo: string | null;
  residual: { remaining: number; unit: string | null };
  replan: { status: string; reason_code: string } | null;
};

function formatarQuantidade(valor: number, unidade: string | null) {
  return `${valor.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${unidade || ''}`.trim();
}

function formatarJanela(inicio: string | null, fim: string | null) {
  const d = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : null);
  const a = d(inicio); const b = d(fim);
  if (a && b) return `${a} a ${b}`;
  if (a) return `a partir de ${a}`;
  if (b) return `até ${b}`;
  return 'sem janela definida';
}

export function CompartilharLacunaModal({
  aberto, campaignId, aoFechar, aoCompartilhar,
}: {
  aberto: boolean;
  campaignId: string | null;
  aoFechar: () => void;
  aoCompartilhar?: () => void;
}) {
  const [lacuna, setLacuna] = useState<Lacuna | null>(null);
  const [parceiros, setParceiros] = useState<Parceiro[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [prazo, setPrazo] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  // Uma vez por abertura: reenviar por duplo clique converge para a mesma
  // oportunidade em vez de criar duas.
  const [clientRequestId, setClientRequestId] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto || !campaignId) return;
    let vivo = true;
    setCarregando(true);
    setErro(null);
    setSelecionados([]);
    setErroEnvio(null);
    setClientRequestId(`share-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

    Promise.all([
      api.get(`/rede-parceiros/campanhas/${campaignId}/lacuna`),
      api.get('/rede-parceiros/parceiros'),
    ])
      .then(([l, p]) => {
        if (!vivo) return;
        setLacuna(l.data);
        setParceiros((p.data?.itens || []).filter((x: Parceiro) => x.status === 'ACTIVE'));
      })
      .catch((e) => { if (vivo) setErro(mensagemErro(e, 'Não foi possível carregar a lacuna desta campanha.')); })
      .finally(() => { if (vivo) setCarregando(false); });

    return () => { vivo = false; };
  }, [aberto, campaignId]);

  const alternar = (id: string) => {
    setSelecionados((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  };

  const podeEnviar = useMemo(
    () => Boolean(lacuna?.pode_compartilhar) && selecionados.length > 0 && !enviando,
    [lacuna, selecionados, enviando],
  );

  const enviar = async () => {
    if (!campaignId || !podeEnviar) return;
    setEnviando(true);
    setErroEnvio(null);
    try {
      await api.post(`/rede-parceiros/campanhas/${campaignId}/compartilhar`, {
        relationship_ids: selecionados,
        prazo_resposta: prazo ? new Date(prazo).toISOString() : null,
        mensagem: mensagem.trim() || null,
        client_request_id: clientRequestId,
      });
      aoCompartilhar?.();
      aoFechar();
    } catch (e) {
      setErroEnvio(mensagemErro(e, 'Não foi possível compartilhar com a rede.'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <ModalFormulario
      aberto={aberto}
      titulo="Buscar capacidade na rede"
      icone={<Share2 size={20} className="text-blue-600" />}
      aoFechar={aoFechar}
      largura="xl"
      rodape={(
        <>
          <button type="button" onClick={aoFechar} className={CLASSE_BOTAO_SECUNDARIO}>Cancelar</button>
          <button type="button" onClick={enviar} disabled={!podeEnviar} className={CLASSE_BOTAO_PRIMARIO}>
            {enviando ? 'Compartilhando…' : 'Compartilhar com parceiros'}
          </button>
        </>
      )}
    >
      {carregando && <p className="text-sm text-gray-500">Carregando a lacuna da campanha…</p>}

      {erro && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{erro}</p>
      )}

      {!carregando && lacuna && (
        <>
          {/* O que vai ser pedido — derivado, não digitado (§51). */}
          <section className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-gray-500">O que será compartilhado</p>
            <p className="mt-2 text-2xl font-bold text-gray-800">
              {formatarQuantidade(lacuna.residual.remaining, lacuna.residual.unit)}
            </p>
            <p className="text-sm text-gray-600">
              {lacuna.campanha.cargo_name || lacuna.campanha.name}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Janela: {formatarJanela(lacuna.campanha.planned_start, lacuna.campanha.planned_end)}
            </p>
            <p className="mt-2 text-xs text-gray-500">
              O parceiro vê a carga, a quantidade, a janela e o prazo. Não vê preço, seus motoristas,
              sua frota, nem os outros parceiros convidados.
            </p>
          </section>

          {!lacuna.pode_compartilhar && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{lacuna.motivo}</span>
            </p>
          )}

          {/* Replanejamento pendente é aviso, não bloqueio: quem decide é o
              operador, mas ele precisa saber que o número pode mudar. */}
          {lacuna.replan && lacuna.replan.status !== 'REPLAN_NOT_NEEDED' && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                Esta campanha tem replanejamento pendente. Se você replanejar depois de compartilhar,
                a oportunidade enviada deixa de valer como pedido atual.
              </span>
            </p>
          )}

          <Campo rotulo="Parceiros" obrigatorio ajuda="Só aparecem parceiros ativos na sua rede.">
            {parceiros.length === 0 ? (
              <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                Você ainda não tem parceiros ativos. Convide um parceiro na tela Rede de parceiros.
              </p>
            ) : (
              <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                {parceiros.map((p) => (
                  <label
                    key={p.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
                      selecionados.includes(p.id) ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selecionados.includes(p.id)}
                      onChange={() => alternar(p.id)}
                      className="h-4 w-4"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-gray-800">{p.nome}</span>
                      <span className="block text-xs text-gray-500">
                        {p.tipo === 'CLIENTE' ? 'Cliente Matopiba' : 'Parceiro convidado'}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </Campo>

          <Campo id="prazo-resposta" rotulo="Prazo para resposta" ajuda="Opcional. Depois dele, o parceiro não consegue mais responder.">
            <input
              id="prazo-resposta" type="datetime-local" className={CLASSE_INPUT}
              value={prazo} onChange={(e) => setPrazo(e.target.value)}
            />
          </Campo>

          <Campo id="mensagem-parceiro" rotulo="Mensagem" ajuda="Opcional. Vai junto do pedido.">
            <textarea
              id="mensagem-parceiro" rows={2} className={CLASSE_INPUT}
              placeholder="Ex.: precisamos concluir até o fim do mês."
              value={mensagem} onChange={(e) => setMensagem(e.target.value)}
            />
          </Campo>

          {erroEnvio && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {erroEnvio}
            </p>
          )}
        </>
      )}
    </ModalFormulario>
  );
}

export default CompartilharLacunaModal;
