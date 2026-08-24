import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RotaInteligente } from './RotaInteligente';
import api from '../api';

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const mockApi = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

beforeEach(() => { vi.clearAllMocks(); });

describe('RotaInteligente', () => {
  test('estimativa por provedor mostra distância, fonte e combustível', async () => {
    mockApi.post.mockResolvedValue({ data: {
      ok: true, origin: 'A', destination: 'B', route_source: 'PROVIDER', provider: 'fake', availability: 'AVAILABLE',
      distance_km: 200, duration_minutes: 200, tolls_amount: null, truck_restrictions_status: 'UNAVAILABLE',
      fuel: { status: 'KNOWN', liters: 80, cost: 480 },
      cost: { fuel_cost: 480, tolls_cost: null, estimated_route_cost: 480, partial: true },
      warnings: [],
    } });
    render(<RotaInteligente />);
    fireEvent.change(screen.getByLabelText('Origem'), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('Destino'), { target: { value: 'B' } });
    fireEvent.click(screen.getByText('Estimar rota'));
    await waitFor(() => expect(screen.getByText('200 km')).toBeInTheDocument());
    expect(screen.getByText(/Fonte: Provedor/)).toBeInTheDocument();
    expect(screen.getByText(/80 L/)).toBeInTheDocument();
    expect(screen.getByText(/parcial/)).toBeInTheDocument();
  });

  test('provedor indisponível mostra fallback manual e nada de zero', async () => {
    mockApi.post.mockResolvedValue({ data: {
      ok: true, origin: 'A', destination: 'B', route_source: 'UNAVAILABLE', availability: 'UNAVAILABLE',
      distance_km: null, duration_minutes: null, tolls_amount: null, truck_restrictions_status: 'UNAVAILABLE',
      fuel: { status: 'UNAVAILABLE', liters: null, cost: null },
      cost: { fuel_cost: null, tolls_cost: null, estimated_route_cost: null, partial: true },
      warnings: [],
    } });
    render(<RotaInteligente />);
    fireEvent.change(screen.getByLabelText('Origem'), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('Destino'), { target: { value: 'B' } });
    fireEvent.click(screen.getByText('Estimar rota'));
    await waitFor(() => expect(screen.getByText(/não está habilitado/i)).toBeInTheDocument());
    expect(screen.getAllByText('Indisponível').length).toBeGreaterThan(0);
  });

  test('exige origem e destino', async () => {
    render(<RotaInteligente />);
    fireEvent.click(screen.getByText('Estimar rota'));
    await waitFor(() => expect(screen.getByText('Informe origem e destino.')).toBeInTheDocument());
    expect(mockApi.post).not.toHaveBeenCalled();
  });
});
