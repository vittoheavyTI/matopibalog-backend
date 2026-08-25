import { useCallback, useEffect, useState } from 'react';
import api from '../api';

// Detalhe de UMA solicitação, do lado da transportadora (owner review HIGH-05).
//
// Existia backend para tudo isto — ver o que o embarcador anexou, comparar o que
// mudou entre envios, disponibilizar documento e comprovante — e nenhuma tela
// que usasse. Endpoint sem caminho de uso não é funcionalidade entregue.
//
// Detalhe progressivo, não tabela gigante (§49/§55): o operador abre o que
// precisa, quando precisa.

type Documento = {
  id: string; nome: string; descricao: string | null;
  tipo_arquivo: string | null; tamanho_bytes: number | null; enviado_em: string;
};
type Versao = {
  versao: number; enviada_em: string; cargo_name: string | null; destination_name: string | null;
  quantity_unit: string | null; total_quantidade: number | null;
  origens: { nome: string; quantidade: number }[];
  decisao: string | null; motivo: string | null; decidida_em: string | null;
};
type Compartilhavel = { id: string; titulo: string; tipo?: string; criado_em: string; compartilhado: boolean };
type Compartilhaveis = {
  documentos: Compartilhavel[];
  comprovantes: Compartilhavel[];
  ja_compartilhados: { id: string; titulo: string; origem: string; desde: string }[];
};

function mensagemDeErro(e: unknown, padrao: string): string {
  const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return typeof msg === 'string' && msg.trim() ? msg : padrao;
}

function statusHttp(e: unknown): number | null {
  return (e as { response?: { status?: number } })?.response?.status ?? null;
}

function quantidade(valor: number | null | undefined, unidade: string | null) {
  if (valor === null || valor === undefined) return '—';
  const n = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(valor);
  return `${n} ${unidade === 'kg' ? 'kg' : 't'}`;
}

function dataHora(valor: string | null) {
  if (!valor) return '—';
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

// Compara duas versões e descreve o que mudou (§50). Sem isto, "Confira o que
// mudou" seria uma instrução que a tela não permite cumprir — o operador teria
// que comparar de cabeça.
function diferencas(anterior: Versao | null, atual: Versao | null): string[] {
  if (!anterior || !atual) return [];
  const mudancas: string[] = [];
  if (anterior.cargo_name !== atual.cargo_name) {
    mudancas.push(`Carga: "${anterior.cargo_name}" → "${atual.cargo_name}"`);
  }
  if (anterior.destination_name !== atual.destination_name) {
    mudancas.push(`Destino: "${anterior.destination_name}" → "${atual.destination_name}"`);
  }
  if (anterior.total_quantidade !== atual.total_quantidade) {
    mudancas.push(`Quantidade total: ${quantidade(anterior.total_quantidade, anterior.quantity_unit)} → ${quantidade(atual.total_quantidade, atual.quantity_unit)}`);
  }
  const antes = new Map(anterior.origens.map((o) => [o.nome, o.quantidade]));
  const depois = new Map(atual.origens.map((o) => [o.nome, o.quantidade]));
  for (const [nome, q] of depois) {
    if (!antes.has(nome)) mudancas.push(`Local incluído: ${nome} (${quantidade(q, atual.quantity_unit)})`);
    else if (antes.get(nome) !== q) {
      mudancas.push(`${nome}: ${quantidade(antes.get(nome) ?? null, anterior.quantity_unit)} → ${quantidade(q, atual.quantity_unit)}`);
    }
  }
  for (const nome of antes.keys()) {
    if (!depois.has(nome)) mudancas.push(`Local removido: ${nome}`);
  }
  return mudancas;
}

export function SolicitacaoEmbarcadorDetalhe({ requestId, aoFechar }: { requestId: string; aoFechar: () => void }) {
  const [historico, setHistorico] = useState<Versao[]>([]);
  const [docsEmbarcador, setDocsEmbarcador] = useState<Documento[]>([]);
  const [compartilhaveis, setCompartilhaveis] = useState<Compartilhaveis | null>(null);
  const [semPermissaoShare, setSemPermissaoShare] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [agindo, setAgindo] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [h, d] = await Promise.all([
        api.get(`/shipper-inbox/solicitacoes/${requestId}/historico`),
        api.get(`/shipper-inbox/solicitacoes/${requestId}/documentos-embarcador`),
      ]);
      setHistorico(h.data.itens || []);
      setDocsEmbarcador(d.data.itens || []);
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível carregar a solicitação.'));
      setCarregando(false);
      return;
    }

    // Compartilháveis exigem outra permissão: a ausência dela não é erro da
    // tela, é uma capacidade que este usuário não tem.
    try {
      const c = await api.get(`/shipper-inbox/solicitacoes/${requestId}/compartilhaveis`);
      setCompartilhaveis(c.data);
      setSemPermissaoShare(false);
    } catch (e) {
      if (statusHttp(e) === 403) setSemPermissaoShare(true);
      else setErro(mensagemDeErro(e, 'Não foi possível carregar os documentos da operação.'));
    } finally {
      setCarregando(false);
    }
  }, [requestId]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function abrirDocumentoDoEmbarcador(docId: string) {
    setAgindo(docId);
    setErro(null);
    try {
      const { data } = await api.get(`/shipper-inbox/solicitacoes/${requestId}/documentos-embarcador/${docId}/url`);
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível abrir o documento.'));
    } finally {
      setAgindo(null);
    }
  }

  async function compartilhar(objetoId: string, sourceKind: 'FRETE_DOCUMENTO' | 'EPOD_EVIDENCIA') {
    setAgindo(objetoId);
    setErro(null);
    setAviso(null);
    try {
      await api.post(`/shipper-inbox/solicitacoes/${requestId}/compartilhar`, {
        source_kind: sourceKind, objeto_id: objetoId,
      });
      setAviso(sourceKind === 'EPOD_EVIDENCIA'
        ? 'Comprovante disponibilizado ao embarcador.'
        : 'Documento disponibilizado ao embarcador.');
      await carregar();
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível disponibilizar o documento.'));
    } finally {
      setAgindo(null);
    }
  }

  async function revogar(shareId: string) {
    setAgindo(shareId);
    setErro(null);
    setAviso(null);
    try {
      await api.post(`/shipper-inbox/compartilhamentos/${shareId}/revogar`);
      setAviso('Acesso revogado. O embarcador não consegue mais abrir este arquivo.');
      await carregar();
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível revogar o acesso.'));
    } finally {
      setAgindo(null);
    }
  }

  const botao = 'rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-60';
  const atual = historico[0] || null;
  const anterior = historico[1] || null;
  const mudancas = diferencas(anterior, atual);

  if (carregando) {
    return (
      <div className="flex items-center justify-center py-10" role="status" aria-live="polite">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
        <span className="ml-3 text-sm text-gray-600">Carregando detalhes…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-gray-300 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-900">Detalhes da solicitação</h2>
        <button type="button" onClick={aoFechar} className={`${botao} border border-gray-300 text-gray-700 hover:bg-gray-50`}>
          Fechar
        </button>
      </div>

      {aviso && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">{aviso}</p>}
      {erro && (
        <div className="rounded-lg bg-red-50 px-3 py-2" role="alert">
          <p className="text-sm text-red-800">{erro}</p>
          <button type="button" onClick={carregar} className="mt-1 text-xs text-red-700 underline">Tentar novamente</button>
        </div>
      )}

      {/* O que mudou entre envios — a tela cumpre a promessa de "confira o que mudou". */}
      {historico.length > 1 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-900">
            O que mudou no envio {atual?.versao}
          </h3>
          {anterior?.motivo && (
            <p className="mt-1 text-xs text-amber-900">
              Você havia pedido: <span className="italic">{anterior.motivo}</span>
            </p>
          )}
          {mudancas.length === 0 ? (
            <p className="mt-2 text-xs text-amber-900">
              O embarcador reenviou sem alterar os dados da carga.
            </p>
          ) : (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-amber-900">
              {mudancas.map((m) => <li key={m}>{m}</li>)}
            </ul>
          )}
        </section>
      )}

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Histórico de envios</h3>
        <ul className="mt-2 space-y-2">
          {historico.map((v) => (
            <li key={v.versao} className="rounded-lg bg-gray-50 p-2 text-xs text-gray-700">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-medium">Envio {v.versao}</span>
                <span>{dataHora(v.enviada_em)}</span>
              </div>
              <p className="mt-0.5">
                {quantidade(v.total_quantidade, v.quantity_unit)} · {v.origens.length} {v.origens.length === 1 ? 'local' : 'locais'}
              </p>
              {v.decisao === 'CHANGES_REQUESTED' && <p className="mt-0.5 text-amber-700">Ajustes pedidos: {v.motivo}</p>}
              {v.decisao === 'REJECTED' && <p className="mt-0.5 text-red-700">Não atendida: {v.motivo}</p>}
              {v.decisao === 'ACCEPTED' && <p className="mt-0.5 text-emerald-700">Aceita.</p>}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Documentos enviados pelo embarcador
        </h3>
        {docsEmbarcador.length === 0 ? (
          <p className="mt-1 text-sm text-gray-600">O embarcador não anexou documentos a esta solicitação.</p>
        ) : (
          <ul className="mt-1 divide-y divide-gray-100">
            {docsEmbarcador.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="text-sm text-gray-800">{d.nome}</p>
                  <p className="text-xs text-gray-500">Enviado em {dataHora(d.enviado_em)}</p>
                </div>
                <button
                  type="button" disabled={agindo === d.id} onClick={() => abrirDocumentoDoEmbarcador(d.id)}
                  className={`${botao} border border-gray-300 text-gray-700 hover:bg-gray-50`}
                >
                  {agindo === d.id ? 'Abrindo…' : 'Abrir'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {semPermissaoShare && (
        <section className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs text-gray-600">
            Você pode revisar esta solicitação, mas não tem permissão para disponibilizar
            documentos ao embarcador. Peça a um administrador da empresa se precisar dessa ação.
          </p>
        </section>
      )}

      {compartilhaveis && (
        <>
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Documentos da operação
            </h3>
            {compartilhaveis.documentos.length === 0 ? (
              <p className="mt-1 text-sm text-gray-600">
                Ainda não há documentos nas viagens desta operação.
              </p>
            ) : (
              <ul className="mt-1 divide-y divide-gray-100">
                {compartilhaveis.documentos.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800">{d.titulo}</p>
                      <p className="text-xs text-gray-500">
                        {d.compartilhado ? 'Disponível ao embarcador' : 'Somente interno'}
                      </p>
                    </div>
                    {!d.compartilhado && (
                      <button
                        type="button" disabled={agindo === d.id}
                        onClick={() => compartilhar(d.id, 'FRETE_DOCUMENTO')}
                        className={`${botao} bg-emerald-700 text-white hover:bg-emerald-800`}
                      >
                        {agindo === d.id ? 'Disponibilizando…' : 'Disponibilizar ao embarcador'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Comprovantes de entrega aprovados
            </h3>
            {compartilhaveis.comprovantes.length === 0 ? (
              <p className="mt-1 text-sm text-gray-600">
                Ainda não há comprovante aprovado nesta operação.
              </p>
            ) : (
              <ul className="mt-1 divide-y divide-gray-100">
                {compartilhaveis.comprovantes.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800">{c.titulo}</p>
                      <p className="text-xs text-gray-500">
                        {c.compartilhado ? 'Disponível ao embarcador' : 'Somente interno'}
                      </p>
                    </div>
                    {!c.compartilhado && (
                      <button
                        type="button" disabled={agindo === c.id}
                        onClick={() => compartilhar(c.id, 'EPOD_EVIDENCIA')}
                        className={`${botao} bg-emerald-700 text-white hover:bg-emerald-800`}
                      >
                        {agindo === c.id ? 'Disponibilizando…' : 'Disponibilizar comprovante'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {compartilhaveis.ja_compartilhados.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Já disponibilizado ao embarcador
              </h3>
              <ul className="mt-1 divide-y divide-gray-100">
                {compartilhaveis.ja_compartilhados.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800">{s.titulo}</p>
                      <p className="text-xs text-gray-500">Desde {dataHora(s.desde)}</p>
                    </div>
                    <button
                      type="button" disabled={agindo === s.id} onClick={() => revogar(s.id)}
                      className={`${botao} border border-red-300 text-red-700 hover:bg-red-50`}
                    >
                      {agindo === s.id ? 'Revogando…' : 'Revogar acesso'}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

export default SolicitacaoEmbarcadorDetalhe;
