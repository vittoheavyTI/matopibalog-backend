import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api', () => ({
  default: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
  newClientRequestId: () => 'req-test',
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

import api from '../api';
import { useAuth } from '../contexts/AuthContext';
import { Dashboard } from './Dashboard';

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> };
const mockUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>;

const superAdminUser = {
  uid: 'u1',
  email: 'super@matopiba.test',
  nome: 'Super Admin',
  role: 'admin',
  status: 'ativo',
  is_super_admin: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAuth.mockReturnValue({ user: superAdminUser, loading: false, login: vi.fn(), logout: vi.fn() });
  mockApi.get.mockImplementation((url: string) => {
    if (url === '/admin/motoristas') {
      return Promise.resolve({
        data: [{
          id: 'm1',
          usuarios: { nome: 'Ana Motorista', empresa_id: 'e1' },
          empresas: { nome: 'Transportadora Alfa', tipo: 'transportadora' },
          placa_veiculo: 'ABC-1234',
          percentual_comissao: 10,
          status_cadastro: 'ativo',
        }],
      });
    }
    if (url === '/admin/motoristas/em-viagem') {
      return Promise.resolve({ data: [{ id: 'm1' }] });
    }
    return Promise.resolve({ data: [] });
  });
});

describe('Dashboard operacional (F-04)', () => {
  test('nao renderiza KPIs SaaS nem busca a fonte SaaS removida', async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);

    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/admin/motoristas'));
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();

    expect(screen.queryByText(/MRR por Empresa/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Empresas em Trial/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/suspensa\(s\)\/bloqueada\(s\)/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/mensalidades recorrentes|assinatura ativa|MRR contratado/i)).not.toBeInTheDocument();
    expect(mockApi.get).not.toHaveBeenCalledWith('/painel-admin/empresas');
  });
});
