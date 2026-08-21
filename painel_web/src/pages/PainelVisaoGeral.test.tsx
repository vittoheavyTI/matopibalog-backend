import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../api', () => ({
  default: { get: vi.fn() },
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="responsive-container">{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

import api from '../api';
import { PainelVisaoGeral } from './PainelVisaoGeral';

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.get.mockImplementation((url: string) => {
    if (url === '/painel-admin/dashboard') {
      return Promise.resolve({ data: { totalMotoristas: 7, totalFretes: 3 } });
    }
    if (url === '/painel-admin/empresas') {
      return Promise.resolve({
        data: [
          { id: 'e1', nome: 'Empresa Ativa', status: 'ativo', billing_status: 'ativo', asaas_subscription_id: 'sub_1', planos: { preco_mensal: 250 } },
          { id: 'e2', nome: 'Empresa Trial', status: 'trial', billing_status: null, asaas_subscription_id: null, planos: { preco_mensal: 100 } },
          { id: 'e3', nome: 'Empresa Suspensa', status: 'suspenso' },
          { id: 'e4', nome: 'Empresa Bloqueada', status: 'bloqueado' },
          { id: 'e5', nome: 'Empresa Expirada', status: 'expirado' },
        ],
      });
    }
    return Promise.resolve({ data: [] });
  });
});

describe('PainelVisaoGeral SaaS (F-04)', () => {
  test('preserva MRR, Trial e inadimplencia migrada com a regra historica', async () => {
    render(<PainelVisaoGeral />);

    await waitFor(() => expect(screen.getByText('MRR por Empresa')).toBeInTheDocument());

    expect(screen.getAllByText('Empresas em Trial').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Empresa Trial')).toBeInTheDocument();
    expect(screen.getAllByText('Trial').length).toBeGreaterThan(0);
    expect(screen.getByText('3 suspensa(s)/bloqueada(s)')).toBeInTheDocument();
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    expect(mockApi.get).toHaveBeenCalledWith('/painel-admin/empresas');
  });
});
