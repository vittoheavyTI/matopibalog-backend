import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// HIGH-05 — o fluxo de documentos/comprovantes do lado da TRANSPORTADORA.
//
// Antes existia backend para tudo isto e nenhuma tela que usasse. Estes testes
// protegem o caminho de uso: ver o que o cliente anexou, entender o que mudou
// entre envios, disponibilizar e revogar.

const get = vi.fn();
const post = vi.fn();

vi.mock('../api', () => ({
  default: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));

import { SolicitacaoEmbarcadorDetalhe } from './SolicitacaoEmbarcadorDetalhe';

const clicar = (el: HTMLElement) => fireEvent.click(el);

function versao(over: Record<string, unknown> = {}) {
  return {
    versao: 1, enviada_em: '2026-01-01T10:00:00Z', cargo_name: 'Soja',
    destination_name: 'Porto de Itaqui', quantity_unit: 'ton', total_quantidade: 100,
    origens: [{ nome: 'Fazenda A', quantidade: 100 }],
    decisao: null, motivo: null, decidida_em: null, ...over,
  };
}

function montar(resp: {
  historico?: unknown[];
  docsEmbarcador?: unknown[];
  compartilhaveis?: unknown | 'forbidden';
} = {}) {
  get.mockImplementation((url: string) => {
    if (url.includes('/historico')) return Promise.resolve({ data: { itens: resp.historico ?? [versao()] } });
    if (url.includes('/documentos-embarcador/') && url.includes('/url')) {
      return Promise.resolve({ data: { url: 'https://signed/doc' } });
    }
    if (url.includes('/documentos-embarcador')) return Promise.resolve({ data: { itens: resp.docsEmbarcador ?? [] } });
    if (url.includes('/compartilhaveis')) {
      if (resp.compartilhaveis === 'forbidden') {
        return Promise.reject({ response: { status: 403, data: { message: 'Permissão insuficiente.' } } });
      }
      return Promise.resolve({
        data: resp.compartilhaveis ?? { documentos: [], comprovantes: [], ja_compartilhados: [] },
      });
    }
    return Promise.resolve({ data: {} });
  });
  return render(<SolicitacaoEmbarcadorDetalhe requestId="req-1" aoFechar={() => {}} />);
}

beforeEach(() => { get.mockReset(); post.mockReset(); });

describe('Documentos enviados pelo embarcador', () => {
  it('mostra o que o cliente anexou e permite abrir', async () => {
    montar({
      docsEmbarcador: [{
        id: 'doc-1', nome: 'Nota fiscal.pdf', descricao: null,
        tipo_arquivo: 'application/pdf', tamanho_bytes: 1024, enviado_em: '2026-01-02T10:00:00Z',
      }],
    });
    expect(await screen.findByText('Nota fiscal.pdf')).toBeInTheDocument();
    const abrirJanela = vi.spyOn(window, 'open').mockImplementation(() => null);
    clicar(screen.getByRole('button', { name: 'Abrir' }));
    // Pré-visualização embutida, igual ao portal externo: quem confere um
    // documento do embarcador quer olhar, não baixar para abrir em outro
    // programa. A nova aba deixou de ser o caminho principal.
    expect(await screen.findByRole('dialog', { name: /visualizar arquivo/i })).toBeInTheDocument();
    expect(abrirJanela).not.toHaveBeenCalled();
    abrirJanela.mockRestore();
  });

  it('sem anexos, diz isso claramente em vez de deixar vazio', async () => {
    montar({ docsEmbarcador: [] });
    expect(await screen.findByText(/não anexou documentos/i)).toBeInTheDocument();
  });
});

describe('Comparação entre envios', () => {
  it('descreve o que mudou entre o envio anterior e o atual', async () => {
    // A caixa de entrada diz "Confira o que mudou" — esta tela precisa
    // realmente permitir isso, sem comparação mental.
    montar({
      historico: [
        versao({ versao: 2, total_quantidade: 150, origens: [{ nome: 'Fazenda A', quantidade: 150 }] }),
        versao({
          versao: 1, total_quantidade: 100, decisao: 'CHANGES_REQUESTED',
          motivo: 'Quantidade não confere.', origens: [{ nome: 'Fazenda A', quantidade: 100 }],
        }),
      ],
    });
    expect(await screen.findByText(/o que mudou no envio 2/i)).toBeInTheDocument();
    expect(screen.getByText(/Você havia pedido:/)).toBeInTheDocument();
    expect(screen.getByText(/Fazenda A: 100 t → 150 t/)).toBeInTheDocument();
  });

  it('reenvio sem alteração é dito explicitamente', async () => {
    montar({
      historico: [
        versao({ versao: 2 }),
        versao({ versao: 1, decisao: 'CHANGES_REQUESTED', motivo: 'Reenvie.' }),
      ],
    });
    expect(await screen.findByText(/reenviou sem alterar os dados/i)).toBeInTheDocument();
  });

  it('com um único envio não há bloco de comparação', async () => {
    montar({ historico: [versao()] });
    await screen.findByText(/histórico de envios/i);
    expect(screen.queryByText(/o que mudou no envio/i)).not.toBeInTheDocument();
  });
});

describe('Disponibilizar e revogar', () => {
  it('disponibiliza um documento da operação ao embarcador', async () => {
    montar({
      compartilhaveis: {
        documentos: [{ id: 'fd-1', titulo: 'CT-e', criado_em: '2026-01-03T10:00:00Z', compartilhado: false }],
        comprovantes: [], ja_compartilhados: [],
      },
    });
    post.mockResolvedValue({ data: { id: 'share-1' } });
    clicar(await screen.findByRole('button', { name: /disponibilizar ao embarcador/i }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/shipper-inbox/solicitacoes/req-1/compartilhar',
      { source_kind: 'FRETE_DOCUMENTO', objeto_id: 'fd-1' },
    ));
    expect(await screen.findByRole('status')).toHaveTextContent(/documento disponibilizado/i);
  });

  it('disponibiliza um comprovante aprovado', async () => {
    montar({
      compartilhaveis: {
        documentos: [],
        comprovantes: [{ id: 'ev-1', titulo: 'Comprovante de entrega', criado_em: '2026-01-06T10:00:00Z', compartilhado: false }],
        ja_compartilhados: [],
      },
    });
    post.mockResolvedValue({ data: { id: 'share-2' } });
    clicar(await screen.findByRole('button', { name: /disponibilizar comprovante/i }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/shipper-inbox/solicitacoes/req-1/compartilhar',
      { source_kind: 'EPOD_EVIDENCIA', objeto_id: 'ev-1' },
    ));
    expect(await screen.findByRole('status')).toHaveTextContent(/comprovante disponibilizado/i);
  });

  it('revoga um acesso já concedido', async () => {
    montar({
      compartilhaveis: {
        documentos: [], comprovantes: [],
        ja_compartilhados: [{ id: 'share-1', titulo: 'CT-e', origem: 'FRETE_DOCUMENTO', desde: '2026-01-04T10:00:00Z' }],
      },
    });
    post.mockResolvedValue({ data: {} });
    clicar(await screen.findByRole('button', { name: /revogar acesso/i }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/shipper-inbox/compartilhamentos/share-1/revogar'));
    expect(await screen.findByRole('status')).toHaveTextContent(/não consegue mais abrir/i);
  });

  it('nada é compartilhado automaticamente — documento interno aparece como "Somente interno"', async () => {
    montar({
      compartilhaveis: {
        documentos: [{ id: 'fd-1', titulo: 'CT-e', criado_em: '2026-01-03T10:00:00Z', compartilhado: false }],
        comprovantes: [], ja_compartilhados: [],
      },
    });
    expect(await screen.findByText('Somente interno')).toBeInTheDocument();
  });
});

describe('Permissão de compartilhamento', () => {
  it('sem documents.share: revisa, mas não vê ações de compartilhar', async () => {
    montar({
      compartilhaveis: 'forbidden',
      docsEmbarcador: [{
        id: 'doc-1', nome: 'Nota.pdf', descricao: null, tipo_arquivo: null,
        tamanho_bytes: null, enviado_em: '2026-01-02T10:00:00Z',
      }],
    });
    // Continua conseguindo revisar o que o cliente mandou…
    expect(await screen.findByText('Nota.pdf')).toBeInTheDocument();
    // …mas a capacidade de compartilhar não aparece, e a tela explica.
    expect(screen.getByText(/não tem permissão para disponibilizar/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /disponibilizar/i })).not.toBeInTheDocument();
  });
});
