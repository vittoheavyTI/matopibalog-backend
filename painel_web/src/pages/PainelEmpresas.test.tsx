import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  avaliarErroResposta: vi.fn(() => ({ sessaoExpirada: false, rateLimited: false })),
  newClientRequestId: () => 'test-id',
}));

import api from '../api';
import { PainelEmpresas } from './PainelEmpresas';

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> };
const empresa = { id: 'e1', nome: 'Empresa Teste', tipo: 'transportadora', status: 'ativo', plano_id: null, planos: null };

function setGet(empresasFactory: () => Promise<any>) {
  mockApi.get.mockImplementation((url: string) => {
    if (url === '/painel-admin/empresas' || url === '/painel-admin/empresas?includeArchived=true') return empresasFactory();
    return Promise.resolve({ data: [] }); // planos, admins, etc.
  });
}
const renderPage = () => render(<MemoryRouter><PainelEmpresas /></MemoryRouter>);
beforeEach(() => { vi.clearAllMocks(); });

describe('PainelEmpresas (página real, API mockada)', () => {
  test('1. sucesso renderiza a empresa', async () => {
    setGet(() => Promise.resolve({ data: [empresa] }));
    renderPage();
    await waitFor(() => expect(screen.getByText('Empresa Teste')).toBeInTheDocument());
  });

  test('2. sucesso vazio mostra estado vazio legítimo', async () => {
    setGet(() => Promise.resolve({ data: [] }));
    renderPage();
    await waitFor(() => expect(screen.getByText(/nenhuma empresa/i)).toBeInTheDocument());
  });

  test('3. falha mostra erro, NÃO estado vazio', async () => {
    setGet(() => Promise.reject({ response: { status: 500 } }));
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument());
    expect(screen.queryByText(/nenhuma empresa/i)).toBeNull();
  });

  test('4. "Tentar novamente" recarrega', async () => {
    let n = 0;
    setGet(() => { n += 1; return n === 1 ? Promise.reject({ response: { status: 500 } }) : Promise.resolve({ data: [empresa] }); });
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    await waitFor(() => expect(screen.getByText('Empresa Teste')).toBeInTheDocument());
  });

  test('7. cancelamento no unmount não gera erro/toast', async () => {
    setGet(() => new Promise(() => {}));
    const { unmount } = renderPage();
    expect(screen.getByText(/carregando…/i)).toBeInTheDocument();
    expect(() => unmount()).not.toThrow();
  });
});
