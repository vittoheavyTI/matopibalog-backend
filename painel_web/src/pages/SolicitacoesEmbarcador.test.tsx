import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Caixa de entrada da transportadora. O que estes testes protegem: que aceitar
// seja UM clique sem redigitação, que o motivo seja obrigatório porque vai para
// o cliente, e que uma conversão pendente fique visível em vez de sumir.

const get = vi.fn();
const post = vi.fn();

vi.mock('../api', () => ({
  default: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));

import { SolicitacoesEmbarcador } from './SolicitacoesEmbarcador';

const clicar = (el: HTMLElement) => fireEvent.click(el);
const digitar = (el: HTMLElement, valor: string) => fireEvent.change(el, { target: { value: valor } });

type Solic = Record<string, unknown>;

function solicitacao(over: Solic = {}): Solic {
  return {
    id: 'req-1', reference_code: 'SOL-1', status: 'SUBMITTED',
    cargo_name: 'Soja', destination_name: 'Porto de Itaqui', quantity_unit: 'ton',
    origins: [{ nome: 'Fazenda 1', quantidade: 70 }, { nome: 'Fazenda 2', quantidade: 50 }],
    total_quantidade: 120, window_start: null, window_end: null, notes: null,
    submitted_at: '2026-01-01T00:00:00Z', decision_reason: null, campaign_id: null,
    versao_atual: 1, revisoes: 0, conversao_pendente: false, ...over,
  };
}

function caixa(over: Record<string, Solic[]> = {}) {
  const grupos: Record<string, Solic[]> = {
    novas_solicitacoes: [], ajustes_reenviados: [], conversao_pendente: [],
    aguardando_embarcador: [], convertidas_em_operacao: [], encerradas: [], ...over,
  };
  const total = Object.values(grupos).reduce((s, g) => s + g.length, 0);
  return {
    grupos,
    resumo: {
      aguardando_decisao: grupos.novas_solicitacoes.length + grupos.ajustes_reenviados.length,
      novas_solicitacoes: grupos.novas_solicitacoes.length,
      ajustes_reenviados: grupos.ajustes_reenviados.length,
      conversao_pendente: grupos.conversao_pendente.length,
      total,
    },
  };
}

function montar() {
  return render(<MemoryRouter><SolicitacoesEmbarcador /></MemoryRouter>);
}

beforeEach(() => { get.mockReset(); post.mockReset(); });

describe('Caixa de entrada de solicitações', () => {
  it('estado vazio explica de onde vêm as solicitações', async () => {
    get.mockResolvedValue({ data: caixa() });
    montar();
    expect(await screen.findByText(/nenhuma solicitação recebida ainda/i)).toBeInTheDocument();
  });

  it('sem permissão, orienta em vez de mostrar uma tela quebrada', async () => {
    get.mockRejectedValue({
      response: { status: 403, data: { message: 'Permissão insuficiente para esta ação no Portal do Embarcador.' } },
    });
    montar();
    expect(await screen.findByRole('alert')).toHaveTextContent(/permissão insuficiente/i);
    expect(screen.getByText(/peça a um administrador/i)).toBeInTheDocument();
  });

  it('mostra o que o embarcador declarou — o operador não redigita nada', async () => {
    get.mockResolvedValue({ data: caixa({ novas_solicitacoes: [solicitacao()] }) });
    montar();
    await screen.findByText('Soja · Porto de Itaqui');
    // Origens e quantidades já vêm prontas na tela de decisão.
    expect(screen.getByText(/Fazenda 1: 70 t/)).toBeInTheDocument();
    expect(screen.getByText(/Fazenda 2: 50 t/)).toBeInTheDocument();
    // Aceitar é uma ação única, não um formulário que recria o pedido.
    expect(screen.getByRole('button', { name: /aceitar e criar operação/i })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('aceitar chama a rota de aceite e informa o resultado', async () => {
    get.mockResolvedValue({ data: caixa({ novas_solicitacoes: [solicitacao()] }) });
    post.mockResolvedValue({ data: { campaign_id: 'camp-1', criada_agora: true } });
    montar();
    clicar(await screen.findByRole('button', { name: /aceitar e criar operação/i }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/shipper-inbox/solicitacoes/req-1/aceitar'));
    expect(await screen.findByRole('status')).toHaveTextContent(/aceita e operação criada/i);
  });

  it('se a operação não pôde ser criada, o aceite ainda vale e a tela diz isso', async () => {
    get.mockResolvedValue({ data: caixa({ novas_solicitacoes: [solicitacao()] }) });
    post.mockResolvedValue({ data: { campaign_id: null, handoff_error: { code: 'handoff_failed', message: 'x' } } });
    montar();
    clicar(await screen.findByRole('button', { name: /aceitar e criar operação/i }));
    // O operador não pode achar que nada aconteceu, nem pedir ao cliente que reenvie.
    expect(await screen.findByRole('status')).toHaveTextContent(/aceita.*operação ainda não pôde ser criada/i);
  });

  it('conversão pendente aparece como trabalho a fazer, com retentativa', async () => {
    get.mockResolvedValue({
      data: caixa({ conversao_pendente: [solicitacao({ status: 'ACCEPTED', conversao_pendente: true })] }),
    });
    post.mockResolvedValue({ data: { campaign_id: 'camp-1' } });
    montar();
    expect(await screen.findByText(/aceitas sem operação criada/i)).toBeInTheDocument();
    clicar(screen.getByRole('button', { name: /criar operação/i }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/shipper-inbox/solicitacoes/req-1/reconverter'));
  });

  it('pedir ajustes exige motivo, e avisa que ele vai para o embarcador', async () => {
    get.mockResolvedValue({ data: caixa({ novas_solicitacoes: [solicitacao()] }) });
    montar();
    clicar(await screen.findByRole('button', { name: /pedir ajustes/i }));
    expect(screen.getByText(/este texto é enviado ao embarcador/i)).toBeInTheDocument();

    // Enviar em branco não passa.
    clicar(screen.getByRole('button', { name: /^enviar$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/informe o motivo/i);
    expect(post).not.toHaveBeenCalled();

    // Com motivo, envia.
    digitar(screen.getByRole('textbox'), 'A janela não é viável.');
    clicar(screen.getByRole('button', { name: /^enviar$/i }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/shipper-inbox/solicitacoes/req-1/ajustes', { motivo: 'A janela não é viável.' },
    ));
  });

  it('recusar usa a rota de recusa, também com motivo obrigatório', async () => {
    get.mockResolvedValue({ data: caixa({ novas_solicitacoes: [solicitacao()] }) });
    post.mockResolvedValue({ data: {} });
    montar();
    clicar(await screen.findByRole('button', { name: /não atender/i }));
    digitar(screen.getByRole('textbox'), 'Sem veículo no período.');
    clicar(screen.getByRole('button', { name: /^enviar$/i }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/shipper-inbox/solicitacoes/req-1/recusar', { motivo: 'Sem veículo no período.' },
    ));
  });

  it('reenvio aparece destacado com o número do envio', async () => {
    get.mockResolvedValue({
      data: caixa({ ajustes_reenviados: [solicitacao({ versao_atual: 2, revisoes: 1 })] }),
    });
    montar();
    expect(await screen.findByText(/ajustes reenviados/i)).toBeInTheDocument();
    expect(screen.getByText(/envio 2/)).toBeInTheDocument();
  });
});
