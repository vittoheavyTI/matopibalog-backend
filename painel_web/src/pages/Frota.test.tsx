import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Frota } from './Frota';

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

const mockCan = vi.fn();
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ can: mockCan, canAny: () => false, isSuper: false, template: null }),
}));

import api from '../api';

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> };

const overview = {
  summary: {
    assets_total: 1,
    assets_active: 1,
    assets_available: 0,
    compositions_active: 1,
    tires_installed: 1,
    tires_stock: 0,
    maintenance_open: 1,
    documents_attention: 1,
    active_freight_assignments: 0,
  },
  attention: [{ code: 'maintenance_open', label: 'Manutencoes abertas ou agendadas', count: 1 }],
  assets: [{ id: 'asset-1', asset_type: 'tractor', internal_identifier: 'CAV-01', plate: 'ABC1D23', brand: 'Volvo', model: 'FH', status: 'active' }],
  compositions: [{ id: 'comp-1', code: 'COMP-01', name: 'Bitrem graos', status: 'active', vehicle_composition_members: [{ id: 'm1', asset_id: 'asset-1', member_role: 'primary_power' }] }],
  tires: [{ id: 'tire-1', fire_number: 'PN-001', brand: 'Michelin', model: 'X', size: '295', status: 'installed', current_asset_id: 'asset-1' }],
  maintenance: [{ id: 'mnt-1', asset_id: 'asset-1', maintenance_type: 'preventive', category: 'oil', status: 'open', supplier: 'Oficina Central', notes: 'Troca programada' }],
  documents: [{ id: 'doc-1', asset_id: 'asset-1', document_type: 'CRLV', storage_path: 'https://example.test/doc.pdf', status: 'active', expires_at: '2026-09-01' }],
  driver_assignments: [{ id: 'drv-1', driver_id: 'driver-1', composition_id: 'comp-1' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCan.mockImplementation((key: string) => key === 'fleet.manage');
  mockApi.get.mockImplementation((url: string) => {
    if (url === '/fleet/overview') return Promise.resolve({ data: overview });
    if (url === '/admin/motoristas') return Promise.resolve({ data: [{ id: 'driver-1', usuarios: { nome: 'Ana Motorista' } }] });
    return Promise.resolve({ data: [] });
  });
});

describe('Frota operacional', () => {
  test('renderiza resumo, pendencias, composicoes, ativos, pneus e manutencoes', async () => {
    render(<Frota />);

    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/fleet/overview', expect.any(Object)));

    expect(screen.getByRole('heading', { name: 'Frota' })).toBeInTheDocument();
    expect(screen.getByText('Ativos operando')).toBeInTheDocument();
    expect(screen.getByText('Manutencoes abertas ou agendadas')).toBeInTheDocument();
    expect(screen.getByText('COMP-01')).toBeInTheDocument();
    expect(screen.getAllByText(/ABC1D23 - CAV-01/).length).toBeGreaterThan(0);
    expect(screen.getByText('PN-001')).toBeInTheDocument();
    expect(screen.getByText('Troca programada')).toBeInTheDocument();
    expect(screen.getByText('Cadastrar ativo')).toBeInTheDocument();
  });

  test('mostra empty state e oculta acoes de escrita sem fleet.manage', async () => {
    mockCan.mockReturnValue(false);
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/fleet/overview') return Promise.resolve({ data: undefined });
      return Promise.resolve({ data: [] });
    });

    render(<Frota />);

    expect(await screen.findByText('Cadastre o primeiro ativo')).toBeInTheDocument();
    expect(screen.getByText('Depois monte uma composicao para transformar a base da Fleet Foundation em operacao diaria.')).toBeInTheDocument();
    expect(screen.queryByText('Cadastrar ativo')).not.toBeInTheDocument();
  });
});
