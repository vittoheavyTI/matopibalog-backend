import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// HIGH-01 na tela: quando o e-mail já tem conta, a ativação pede a SENHA DESSA
// CONTA — não uma senha nova. Sem isso a pessoa inventa uma senha, a ativação
// falha e ela não entende o motivo.

const get = vi.fn();
const post = vi.fn();

vi.mock('./portalApi', async () => {
  const real = await vi.importActual<typeof import('./portalApi')>('./portalApi');
  return {
    ...real,
    default: {
      get: (...args: unknown[]) => get(...args),
      post: (...args: unknown[]) => post(...args),
    },
  };
});

import PortalAtivarConvite from './PortalAtivarConvite';
import { PortalAuthProvider } from './PortalAuthContext';

const clicar = (el: HTMLElement) => fireEvent.click(el);
const digitar = (el: HTMLElement, valor: string) => fireEvent.change(el, { target: { value: valor } });

function preview(over: Record<string, unknown> = {}) {
  return {
    email: 'contato@embarcador.test',
    nome_convidado: 'Contato',
    transportadora: 'Transportadora A',
    embarcador: 'Fazendas X',
    utilizavel: true,
    conta_existente: false,
    motivo: null,
    ...over,
  };
}

function montar(dadosPreview: Record<string, unknown>) {
  get.mockImplementation((url: string) => {
    if (url.includes('/convite')) return Promise.resolve({ data: dadosPreview });
    return Promise.resolve({ data: {} });
  });
  return render(
    <MemoryRouter initialEntries={['/portal/embarcador/convite?token=abc']}>
      <PortalAuthProvider>
        <Routes>
          <Route path="/portal/embarcador/convite" element={<PortalAtivarConvite />} />
          <Route path="/portal/embarcador" element={<div>inicio</div>} />
        </Routes>
      </PortalAuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => { get.mockReset(); post.mockReset(); localStorage.clear(); });

describe('Ativação — conta nova', () => {
  it('pede para criar senha, com confirmação', async () => {
    montar(preview({ conta_existente: false }));
    expect(await screen.findByLabelText(/crie uma senha/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/repita a senha/i)).toBeInTheDocument();
  });

  it('recusa senhas que não conferem antes de chamar o servidor', async () => {
    montar(preview({ conta_existente: false }));
    digitar(await screen.findByLabelText(/crie uma senha/i), 'senha-forte-123');
    digitar(screen.getByLabelText(/repita a senha/i), 'outra-coisa');
    clicar(screen.getByRole('button', { name: /ativar meu acesso/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/não conferem/i);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('Ativação — conta já existente (HIGH-01)', () => {
  it('pede a SENHA DA CONTA, sem confirmação, e avisa que ela não muda', async () => {
    montar(preview({ conta_existente: true }));
    expect(await screen.findByLabelText(/senha da sua conta/i)).toBeInTheDocument();
    // Pedir "repita a senha" sugeriria troca de senha — e não há troca.
    expect(screen.queryByLabelText(/repita a senha/i)).not.toBeInTheDocument();
    expect(screen.getByText(/já tem uma conta no Matopiba Log/i)).toBeInTheDocument();
    // A tela diz em mais de um lugar que a senha não muda — o que importa é
    // que diga, e nenhum texto sugira criação de senha nova.
    expect(screen.getAllByText(/continua a mesma|não será alterada/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/pelo menos 8 caracteres/i)).not.toBeInTheDocument();
  });

  it('envia a senha informada para verificação', async () => {
    montar(preview({ conta_existente: true }));
    digitar(await screen.findByLabelText(/senha da sua conta/i), 'minha-senha-real');
    post.mockResolvedValue({ data: { token: 't', senha_definida_agora: false } });
    clicar(screen.getByRole('button', { name: /ativar meu acesso/i }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/portal/embarcador/convite/ativar',
      expect.objectContaining({ senha: 'minha-senha-real' }),
    ));
  });

  it('senha errada mostra a mensagem do servidor, sem ativar', async () => {
    montar(preview({ conta_existente: true }));
    digitar(await screen.findByLabelText(/senha da sua conta/i), 'chute');
    post.mockRejectedValue({
      response: {
        status: 401,
        data: {
          code: 'existing_account_password_invalid',
          message: 'Senha incorreta para a conta já existente com este e-mail. Informe a senha atual dessa conta para ativar seu acesso.',
        },
      },
    });
    clicar(screen.getByRole('button', { name: /ativar meu acesso/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/senha incorreta/i);
  });

  it('após ativar, diz que a senha antiga continua valendo', async () => {
    montar(preview({ conta_existente: true }));
    digitar(await screen.findByLabelText(/senha da sua conta/i), 'minha-senha-real');
    post.mockResolvedValue({ data: { token: 't', senha_definida_agora: false } });
    clicar(screen.getByRole('button', { name: /ativar meu acesso/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/continue usando a senha que você já utilizava/i);
  });
});

describe('Ativação — convite inutilizável', () => {
  it('convite expirado orienta a pedir um novo', async () => {
    montar(preview({ utilizavel: false, motivo: 'expirado' }));
    expect(await screen.findByText(/convite expirou/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ativar meu acesso/i })).not.toBeInTheDocument();
  });

  it('convite indisponível não pede senha nenhuma', async () => {
    montar(preview({ utilizavel: false, motivo: 'indisponivel' }));
    expect(await screen.findByText(/não está mais disponível/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/senha/i)).not.toBeInTheDocument();
  });
});
