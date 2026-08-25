import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import portalApi, { mensagemDeErro } from './portalApi';
import { usePortalAuth } from './PortalAuthContext';
import { Cartao, Quantidade } from './PortalUI';

type Origem = { nome: string; quantidade: string };

// Pedido de transporte. O teste de produto (§142) é: o embarcador está
// DECLARANDO uma necessidade ou preenchendo o modelo de dados da transportadora?
//
// Por isso a tela pergunta, em linguagem de quem tem carga para mover: o que
// você precisa transportar, de onde sai, para onde vai, e quando. Não existe
// aqui nenhum campo de Campanha, viagem planejada, veículo, unidade operacional
// ou status — isso é trabalho da transportadora e ela já sabe fazer.
//
// Duas etapas: preencher e conferir. A conferência existe porque enviar é um
// compromisso — não porque o formulário é grande.

export default function PortalNovaSolicitacao() {
  const { transportadoraAtiva, transportadoras } = usePortalAuth();
  const navigate = useNavigate();

  const [etapa, setEtapa] = useState<'dados' | 'conferir'>('dados');
  const [cargo, setCargo] = useState('');
  const [destino, setDestino] = useState('');
  const [unidade, setUnidade] = useState<'ton' | 'kg'>('ton');
  const [origens, setOrigens] = useState<Origem[]>([{ nome: '', quantidade: '' }]);
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Gerado UMA vez e reaproveitado em todas as tentativas (§30). Se o envio for
  // repetido por falha de rede, o backend reconhece o mesmo pedido lógico em vez
  // de criar uma segunda solicitação.
  const clientRequestId = useRef(
    `portal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  );

  const total = useMemo(
    () => origens.reduce((s, o) => s + (Number(String(o.quantidade).replace(',', '.')) || 0), 0),
    [origens],
  );

  function atualizarOrigem(indice: number, campo: keyof Origem, valor: string) {
    setOrigens((atual) => atual.map((o, i) => (i === indice ? { ...o, [campo]: valor } : o)));
  }

  function validar(): string | null {
    if (!cargo.trim()) return 'Informe o que será transportado.';
    if (!destino.trim()) return 'Informe para onde a carga vai.';
    const preenchidas = origens.filter((o) => o.nome.trim());
    if (!preenchidas.length) return 'Informe ao menos um local de coleta.';
    for (const o of preenchidas) {
      const q = Number(String(o.quantidade).replace(',', '.'));
      if (!Number.isFinite(q) || q <= 0) return `Informe a quantidade de "${o.nome.trim()}".`;
    }
    const nomes = preenchidas.map((o) => o.nome.trim().toLowerCase());
    if (new Set(nomes).size !== nomes.length) return 'Há locais de coleta repetidos.';
    if (inicio && fim && new Date(fim) < new Date(inicio)) return 'A data final não pode ser anterior à inicial.';
    return null;
  }

  function irParaConferencia(e: FormEvent) {
    e.preventDefault();
    const problema = validar();
    if (problema) { setErro(problema); return; }
    setErro(null);
    setEtapa('conferir');
  }

  async function enviar() {
    setErro(null);
    setEnviando(true);
    try {
      const { data } = await portalApi.post('/portal/embarcador/solicitacoes', {
        relationship_id: transportadoraAtiva?.relationship_id,
        cargo_name: cargo.trim(),
        destination_name: destino.trim(),
        quantity_unit: unidade,
        origins: origens
          .filter((o) => o.nome.trim())
          .map((o) => ({ nome: o.nome.trim(), quantidade: Number(String(o.quantidade).replace(',', '.')) })),
        window_start: inicio || null,
        window_end: fim || null,
        notes: observacoes.trim() || null,
        client_request_id: clientRequestId.current,
      });
      navigate(`/portal/embarcador/operacoes/${data.id}?enviada=1`, { replace: true });
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível enviar seu pedido.'));
      setEtapa('dados');
    } finally {
      setEnviando(false);
    }
  }

  const campo = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600';

  if (etapa === 'conferir') {
    return (
      <div className="space-y-5">
        <h1 className="text-lg font-semibold text-slate-900">Confira antes de enviar</h1>
        <Cartao>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">O que será transportado</dt>
              <dd className="text-slate-900">{cargo}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Destino</dt>
              <dd className="text-slate-900">{destino}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Locais de coleta</dt>
              <dd className="text-slate-900">
                <ul className="mt-1 space-y-1">
                  {origens.filter((o) => o.nome.trim()).map((o) => (
                    <li key={o.nome} className="flex justify-between gap-4">
                      <span>{o.nome}</span>
                      <Quantidade valor={Number(String(o.quantidade).replace(',', '.'))} unidade={unidade} />
                    </li>
                  ))}
                </ul>
                <p className="mt-2 border-t border-slate-100 pt-2 text-sm font-medium">
                  Total: <Quantidade valor={total} unidade={unidade} />
                </p>
              </dd>
            </div>
            {(inicio || fim) && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Período desejado</dt>
                <dd className="text-slate-900">
                  {inicio ? new Date(inicio).toLocaleDateString('pt-BR') : 'a combinar'}
                  {' até '}
                  {fim ? new Date(fim).toLocaleDateString('pt-BR') : 'a combinar'}
                </dd>
              </div>
            )}
            {observacoes.trim() && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Observações</dt>
                <dd className="whitespace-pre-line text-slate-900">{observacoes}</dd>
              </div>
            )}
            {transportadoras.length > 1 && transportadoraAtiva && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Transportadora</dt>
                <dd className="text-slate-900">{transportadoraAtiva.nome}</dd>
              </div>
            )}
          </dl>
        </Cartao>

        {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{erro}</p>}

        <div className="flex flex-wrap gap-3">
          <button
            type="button" onClick={() => setEtapa('dados')} disabled={enviando}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Voltar e ajustar
          </button>
          <button
            type="button" onClick={enviar} disabled={enviando}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            {enviando ? 'Enviando…' : 'Enviar pedido'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={irParaConferencia} className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Pedir um transporte</h1>
        <p className="mt-1 text-sm text-slate-600">
          Descreva o que você precisa mover. A transportadora cuida do resto.
        </p>
      </div>

      <Cartao>
        <div className="space-y-4">
          <div>
            <label htmlFor="cargo" className="block text-sm font-medium text-slate-700">O que será transportado?</label>
            <input id="cargo" className={campo} value={cargo} onChange={(e) => setCargo(e.target.value)}
              placeholder="Ex.: Soja em grãos" required />
          </div>
          <div>
            <label htmlFor="destino" className="block text-sm font-medium text-slate-700">Para onde vai?</label>
            <input id="destino" className={campo} value={destino} onChange={(e) => setDestino(e.target.value)}
              placeholder="Ex.: Porto de Itaqui" required />
          </div>
        </div>
      </Cartao>

      <Cartao>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">De onde sai?</h2>
          {/* A unidade é da SOLICITAÇÃO inteira, não de cada local. Misturar kg e
              toneladas produziria um total sem significado. */}
          <label className="flex items-center gap-2 text-xs text-slate-600">
            Unidade
            <select
              className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
              value={unidade} onChange={(e) => setUnidade(e.target.value as 'ton' | 'kg')}
              aria-label="Unidade das quantidades"
            >
              <option value="ton">toneladas</option>
              <option value="kg">quilos</option>
            </select>
          </label>
        </div>

        <div className="mt-3 space-y-3">
          {origens.map((o, i) => (
            <div key={i} className="flex flex-wrap items-end gap-3">
              <div className="min-w-[12rem] flex-1">
                <label htmlFor={`origem-${i}`} className="block text-xs text-slate-600">Local de coleta {i + 1}</label>
                <input
                  id={`origem-${i}`} className={campo} value={o.nome}
                  onChange={(e) => atualizarOrigem(i, 'nome', e.target.value)}
                  placeholder="Ex.: Fazenda Boa Vista"
                />
              </div>
              <div className="w-32">
                <label htmlFor={`qtd-${i}`} className="block text-xs text-slate-600">Quantidade</label>
                <input
                  id={`qtd-${i}`} className={campo} value={o.quantidade} inputMode="decimal"
                  onChange={(e) => atualizarOrigem(i, 'quantidade', e.target.value)} placeholder="0"
                />
              </div>
              {origens.length > 1 && (
                <button
                  type="button"
                  onClick={() => setOrigens((atual) => atual.filter((_, idx) => idx !== i))}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
                  aria-label={`Remover local de coleta ${i + 1}`}
                >
                  Remover
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setOrigens((atual) => [...atual, { nome: '', quantidade: '' }])}
            className="rounded-lg border border-emerald-700 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
          >
            Adicionar outro local
          </button>
          {/* Total DERIVADO, nunca digitado. */}
          <p className="text-sm text-slate-700">Total: <Quantidade valor={total} unidade={unidade} /></p>
        </div>
      </Cartao>

      <Cartao>
        <h2 className="text-sm font-semibold text-slate-900">Quando você precisa? <span className="font-normal text-slate-500">(opcional)</span></h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <div>
            <label htmlFor="inicio" className="block text-xs text-slate-600">A partir de</label>
            <input id="inicio" type="date" className={campo} value={inicio} onChange={(e) => setInicio(e.target.value)} />
          </div>
          <div>
            <label htmlFor="fim" className="block text-xs text-slate-600">Até</label>
            <input id="fim" type="date" className={campo} value={fim} onChange={(e) => setFim(e.target.value)} />
          </div>
        </div>
        <div className="mt-4">
          <label htmlFor="obs" className="block text-sm font-medium text-slate-700">
            Algo que a transportadora precisa saber? <span className="font-normal text-slate-500">(opcional)</span>
          </label>
          <textarea
            id="obs" rows={3} className={campo} value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            placeholder="Ex.: portaria fecha às 17h"
          />
        </div>
      </Cartao>

      {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{erro}</p>}

      <div className="flex flex-wrap gap-3">
        <Link
          to="/portal/embarcador"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancelar
        </Link>
        <button type="submit" className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800">
          Conferir pedido
        </button>
      </div>
    </form>
  );
}
