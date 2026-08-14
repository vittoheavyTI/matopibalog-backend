import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OperationalContextSelector } from './OperationalContextSelector';
import api from '../api';
import {
  OPERATIONAL_GROUP_CONTEXT_KEY,
  OPERATIONAL_UNIT_CONTEXT_KEY,
} from '../utils/operationalContextStorage';

vi.mock('../api', () => ({
  default: { get: vi.fn() },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      uid: 'admin-a',
      role: 'admin',
      status: 'ativo',
      empresa_id: 'empresa-a',
      is_super_admin: false,
    },
  }),
}));

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> };

const unidades = [
  { id: 'unit-a', nome: 'Unidade A', codigo: 'A' },
  { id: 'unit-b', nome: 'Unidade B', codigo: 'B' },
];

const grupos = [{ id: 'grupo-x', nome: 'Grupo X', status: 'ativo' }];

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('OperationalContextSelector', () => {
  test('sem membership corporativa nao mostra opcao de grupo', async () => {
    mockApi.get.mockResolvedValue({ data: { unidades, grupos: [] } });

    render(<OperationalContextSelector />);

    await waitFor(() => expect(screen.getByRole('combobox', { name: /contexto operacional/i })).toBeInTheDocument());
    expect(screen.queryByRole('combobox', { name: /contexto corporativo/i })).toBeNull();
  });

  test('membership corporativa mostra grupo e selecao grava contexto de grupo', async () => {
    mockApi.get.mockResolvedValue({ data: { unidades, grupos } });

    render(<OperationalContextSelector />);

    const groupSelect = await screen.findByRole('combobox', { name: /contexto corporativo/i });
    fireEvent.change(groupSelect, { target: { value: 'grupo-x' } });

    expect(localStorage.getItem(OPERATIONAL_GROUP_CONTEXT_KEY)).toBe('grupo-x');
    expect(localStorage.getItem(OPERATIONAL_UNIT_CONTEXT_KEY)).toBeNull();
  });

  test('seleciona unidade dentro do grupo e mantem os dois contextos', async () => {
    mockApi.get.mockResolvedValue({ data: { unidades, grupos } });

    render(<OperationalContextSelector />);

    const groupSelect = await screen.findByRole('combobox', { name: /contexto corporativo/i });
    fireEvent.change(groupSelect, { target: { value: 'grupo-x' } });
    const unitSelect = await screen.findByRole('combobox', { name: /unidade operacional/i });
    fireEvent.change(unitSelect, { target: { value: 'unit-b' } });

    expect(localStorage.getItem(OPERATIONAL_GROUP_CONTEXT_KEY)).toBe('grupo-x');
    expect(localStorage.getItem(OPERATIONAL_UNIT_CONTEXT_KEY)).toBe('unit-b');
  });

  test('grupo salvo revogado vira stale, limpa contexto e informa sem trocar silenciosamente', async () => {
    localStorage.setItem(OPERATIONAL_GROUP_CONTEXT_KEY, 'grupo-x');
    localStorage.setItem(OPERATIONAL_UNIT_CONTEXT_KEY, 'unit-b');
    mockApi.get
      .mockRejectedValueOnce({ response: { status: 403 } })
      .mockResolvedValueOnce({ data: { unidades: [unidades[0]], grupos: [] } });

    render(<OperationalContextSelector />);

    await waitFor(() => expect(screen.getByText(/contexto corporativo removido/i)).toBeInTheDocument());
    expect(localStorage.getItem(OPERATIONAL_GROUP_CONTEXT_KEY)).toBeNull();
    expect(localStorage.getItem(OPERATIONAL_UNIT_CONTEXT_KEY)).toBeNull();
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(2));
  });
});
