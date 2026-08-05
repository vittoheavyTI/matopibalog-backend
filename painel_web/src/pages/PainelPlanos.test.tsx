import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock do cliente HTTP (substitui o axios real — sem rede).
vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  avaliarErroResposta: vi.fn(() => ({ sessaoExpirada: false, rateLimited: false })),
  newClientRequestId: () => 'test-id',
}));

import api from '../api';
import { PainelPlanos } from './PainelPlanos';

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> };
const plano = { id: 'p1', nome: 'Plano X', preco_mensal: 100, categoria: 'empresa', ativo: true, recursos: [], dias_trial: 7, limite_motoristas: 5 };

// api.get atende a lista de planos com `planosFactory` e devolve modelos vazios.
function setGet(planosFactory: () => Promise<any>) {
  mockApi.get.mockImplementation((url: string) => {
    if (url === '/painel-admin/planos') return planosFactory();
    return Promise.resolve({ data: { planos: [] } }); // /admin/contrato-modelos/overview
  });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('PainelPlanos (página real, API mockada)', () => {
  test('1. loading é exibido durante a requisição', async () => {
    let resolver: (v: any) => void = () => {};
    setGet(() => new Promise((r) => { resolver = r; }));
    render(<PainelPlanos />);
    expect(screen.getByText(/carregando planos/i)).toBeInTheDocument();
    resolver({ data: [plano] });
    await waitFor(() => expect(screen.queryByText(/carregando planos/i)).toBeNull());
  });

  test('2. sucesso com dados renderiza ao menos um plano', async () => {
    setGet(() => Promise.resolve({ data: [plano] }));
    render(<PainelPlanos />);
    await waitFor(() => expect(screen.getByText('Plano X')).toBeInTheDocument());
  });

  test('3. resposta vazia mostra "Nenhum plano cadastrado"', async () => {
    setGet(() => Promise.resolve({ data: [] }));
    render(<PainelPlanos />);
    await waitFor(() => expect(screen.getByText(/nenhum plano cadastrado/i)).toBeInTheDocument());
  });

  test('4/5. falha mostra erro e NÃO mostra "Nenhum plano cadastrado"', async () => {
    setGet(() => Promise.reject({ response: { status: 403 } }));
    render(<PainelPlanos />);
    await waitFor(() => expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument());
    expect(screen.queryByText(/nenhum plano cadastrado/i)).toBeNull();
  });

  test('6/7. "Tentar novamente" após falha renderiza os planos', async () => {
    let n = 0;
    setGet(() => { n += 1; return n === 1 ? Promise.reject({ response: { status: 403 } }) : Promise.resolve({ data: [plano] }); });
    render(<PainelPlanos />);
    await waitFor(() => expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    await waitFor(() => expect(screen.getByText('Plano X')).toBeInTheDocument());
  });

  test('8. cancelamento no unmount não gera erro/toast', async () => {
    setGet(() => new Promise(() => {})); // nunca resolve
    const { unmount } = render(<PainelPlanos />);
    expect(screen.getByText(/carregando planos/i)).toBeInTheDocument();
    expect(() => unmount()).not.toThrow(); // aborta a request; sem erro/toast
  });
});
