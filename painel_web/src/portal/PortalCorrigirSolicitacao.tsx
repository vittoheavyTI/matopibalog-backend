import { useMemo, useState } from 'react';
import portalApi, { codigoDoErro, mensagemDeErro } from './portalApi';
import { Cartao, Quantidade } from './PortalUI';

type Detalhe = {
  request_id: string;
  cargo_name: string;
  destination_name: string;
  quantity_unit: string;
  origens: { nome: string; quantidade: number }[];
  window_start: string | null;
  window_end: string | null;
  notes: string | null;
  motivo_transportadora: string | null;
  versao_atual: number | null;
};

type Origem = { nome: string; quantidade: string };

function paraData(valor: string | null) {
  if (!valor) return '';
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

// Correção do pedido depois que a transportadora pediu ajustes.
//
// A tela abre JÁ PREENCHIDA com o que foi enviado antes — corrigir não é
// recomeçar. O motivo do pedido de ajuste fica visível o tempo todo, porque é a
// única informação que diz o que precisa mudar.
//
// `versao_atual` viaja junto no envio: se outra pessoa da mesma empresa
// corrigiu enquanto esta tela estava aberta, o servidor recusa em vez de
// sobrescrever silenciosamente o trabalho dela.

export default function PortalCorrigirSolicitacao({
  detalhe, aoCancelar, aoConcluir,
}: { detalhe: Detalhe; aoCancelar: () => void; aoConcluir: () => void | Promise<void> }) {
  const [cargo, setCargo] = useState(detalhe.cargo_name);
  const [destino, setDestino] = useState(detalhe.destination_name);
  const [unidade, setUnidade] = useState<'ton' | 'kg'>(detalhe.quantity_unit === 'kg' ? 'kg' : 'ton');
  const [origens, setOrigens] = useState<Origem[]>(
    detalhe.origens.length
      ? detalhe.origens.map((o) => ({ nome: o.nome, quantidade: String(o.quantidade) }))
      : [{ nome: '', quantidade: '' }],
  );
  const [inicio, setInicio] = useState(paraData(detalhe.window_start));
  const [fim, setFim] = useState(paraData(detalhe.window_end));
  const [observacoes, setObservacoes] = useState(detalhe.notes || '');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [conflito, setConflito] = useState(false);

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

  async function enviar() {
    const problema = validar();
    if (problema) { setErro(problema); return; }
    setErro(null);
    setConflito(false);
    setEnviando(true);
    try {
      await portalApi.post(`/portal/embarcador/solicitacoes/${detalhe.request_id}/revisar`, {
        cargo_name: cargo.trim(),
        destination_name: destino.trim(),
        quantity_unit: unidade,
        origins: origens
          .filter((o) => o.nome.trim())
          .map((o) => ({ nome: o.nome.trim(), quantidade: Number(String(o.quantidade).replace(',', '.')) })),
        window_start: inicio || null,
        window_end: fim || null,
        notes: observacoes.trim() || null,
        expected_version: detalhe.versao_atual ?? undefined,
      });
      await aoConcluir();
    } catch (e) {
      const codigo = codigoDoErro(e);
      if (codigo === 'request_version_conflict' || codigo === 'request_not_revisable') setConflito(true);
      setErro(mensagemDeErro(e, 'Não foi possível enviar sua correção.'));
    } finally {
      setEnviando(false);
    }
  }

  const campo = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600';

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Corrigir solicitação</h1>
        <p className="mt-1 text-sm text-slate-600">
          Ajuste o que for necessário e envie novamente. Seus envios anteriores ficam registrados.
        </p>
      </div>

      {detalhe.motivo_transportadora && (
        <Cartao className="border-amber-200 bg-amber-50">
          <h2 className="text-sm font-semibold text-amber-900">O que a transportadora pediu</h2>
          <p className="mt-1 whitespace-pre-line text-sm text-amber-900">{detalhe.motivo_transportadora}</p>
        </Cartao>
      )}

      <Cartao>
        <div className="space-y-4">
          <div>
            <label htmlFor="c-cargo" className="block text-sm font-medium text-slate-700">O que será transportado?</label>
            <input id="c-cargo" className={campo} value={cargo} onChange={(e) => setCargo(e.target.value)} />
          </div>
          <div>
            <label htmlFor="c-destino" className="block text-sm font-medium text-slate-700">Para onde vai?</label>
            <input id="c-destino" className={campo} value={destino} onChange={(e) => setDestino(e.target.value)} />
          </div>
        </div>
      </Cartao>

      <Cartao>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">De onde sai?</h2>
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
                <label htmlFor={`c-origem-${i}`} className="block text-xs text-slate-600">Local de coleta {i + 1}</label>
                <input id={`c-origem-${i}`} className={campo} value={o.nome}
                  onChange={(e) => atualizarOrigem(i, 'nome', e.target.value)} />
              </div>
              <div className="w-32">
                <label htmlFor={`c-qtd-${i}`} className="block text-xs text-slate-600">Quantidade</label>
                <input id={`c-qtd-${i}`} className={campo} value={o.quantidade} inputMode="decimal"
                  onChange={(e) => atualizarOrigem(i, 'quantidade', e.target.value)} />
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
          <p className="text-sm text-slate-700">Total: <Quantidade valor={total} unidade={unidade} /></p>
        </div>
      </Cartao>

      <Cartao>
        <h2 className="text-sm font-semibold text-slate-900">Quando você precisa? <span className="font-normal text-slate-500">(opcional)</span></h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <div>
            <label htmlFor="c-inicio" className="block text-xs text-slate-600">A partir de</label>
            <input id="c-inicio" type="date" className={campo} value={inicio} onChange={(e) => setInicio(e.target.value)} />
          </div>
          <div>
            <label htmlFor="c-fim" className="block text-xs text-slate-600">Até</label>
            <input id="c-fim" type="date" className={campo} value={fim} onChange={(e) => setFim(e.target.value)} />
          </div>
        </div>
        <div className="mt-4">
          <label htmlFor="c-obs" className="block text-sm font-medium text-slate-700">
            Observações <span className="font-normal text-slate-500">(opcional)</span>
          </label>
          <textarea id="c-obs" rows={3} className={campo} value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)} />
        </div>
      </Cartao>

      {erro && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2" role="alert">
          <p className="text-sm text-red-800">{erro}</p>
          {conflito && (
            <button
              type="button" onClick={() => void aoConcluir()}
              className="mt-2 rounded-lg bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800"
            >
              Atualizar a página
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button" onClick={aoCancelar} disabled={enviando}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancelar
        </button>
        <button
          type="button" onClick={enviar} disabled={enviando}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {enviando ? 'Enviando…' : 'Enviar correção'}
        </button>
      </div>
    </div>
  );
}
