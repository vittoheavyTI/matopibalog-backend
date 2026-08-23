import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OperationCampaigns } from './OperationCampaigns';

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

import api from '../api';

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
};

const campaign = {
  id: 'campaign-1',
  reference_code: 'CAMP-B',
  name: 'Campanha B',
  cargo_name: 'Soja',
  status: 'APPROVED',
  planning_status: 'APPROVED',
};

const approvedPlan = {
  plan: { id: 'plan-1', version_number: 1, status: 'APPROVED', result_summary: { planned_trips: 1 } },
  planned_trips: [
    {
      id: 'trip-1',
      planned_quantity: 10,
      quantity_unit: 'ton',
      required_capacity_kg: 10000,
      status: 'PLANNED',
      candidate_asset_id: 'asset-1',
    },
  ],
  exceptions: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.get.mockImplementation((url: string) => {
    if (url === '/operation-campaigns') return Promise.resolve({ data: { itens: [campaign] } });
    if (url === '/operation-campaigns/context') return Promise.resolve({ data: { unidades: [] } });
    if (url.endsWith('/materialization-preview')) {
      return Promise.resolve({
        data: {
          summary: { requested: 1, already_materialized: 0, ready: 1, blocked: 0 },
          items: [{ planned_trip_id: 'trip-1', status: 'READY' }],
        },
      });
    }
    return Promise.resolve({ data: {} });
  });
  mockApi.post.mockImplementation((url: string) => {
    if (url.endsWith('/plans')) return Promise.resolve({ data: approvedPlan });
    if (url.endsWith('/materialize')) {
      return Promise.resolve({
        data: {
          summary: { requested: 1, already_materialized: 0, ready: 1, created: 1, blocked: 0, failed: 0 },
          items: [{ planned_trip_id: 'trip-1', status: 'MATERIALIZED', frete_id: 'frete-1' }],
        },
      });
    }
    return Promise.resolve({ data: {} });
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('OperationCampaigns materializacao', () => {
  test('exige preview antes de materializar fretes de plano aprovado', async () => {
    render(<OperationCampaigns />);

    expect((await screen.findAllByText('CAMP-B')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Gerar plano/i }));

    const materializeButton = await screen.findByRole('button', { name: /Materializar fretes/i });
    expect(materializeButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Valor por frete/i), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /Preview/i }));

    expect(await screen.findByText('Prontos')).toBeInTheDocument();
    await waitFor(() => expect(materializeButton).not.toBeDisabled());

    fireEvent.click(materializeButton);

    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith(
      '/operation-campaigns/campaign-1/plans/plan-1/materialize',
      expect.objectContaining({ modalidade_calculo: 'valor_fixo', valor_frete: 500 }),
    ));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Materializar 1 frete'));
    expect(await screen.findByText('1 frete(s) materializado(s).')).toBeInTheDocument();
  });
});
