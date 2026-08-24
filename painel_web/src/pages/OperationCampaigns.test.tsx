import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OperationCampaigns } from './OperationCampaigns';

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), defaults: { baseURL: '' } },
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

// Fixture-base da projeção de progresso (GET /operation-campaigns/:id/progress). Cada teste
// sobrescreve só os campos relevantes ao cenário — o formato completo espelha o tipo `Progress`
// consumido por CampaignExecution em OperationCampaigns.tsx.
function buildProgress(overrides: Record<string, unknown> = {}) {
  return {
    approved_plan: { id: 'plan-1', version_number: 1 },
    progress: {
      trips: { planned_total: 1, not_materialized: 0, materialized: 1, in_execution: 0, completed: 0, cancelled: 0, blocked: 0, unknown: 0 },
      quantity: { unit: 'ton', target: 10, planned: 10, materialized: 10, completed: 0, cancelled: 0, remaining: 10, coverage: { quantity_source: 'planned', measured_actual_available: true, trips_with_quantity: 1, trips_total: 1, incompatible_units: false } },
    },
    trips_detail: [],
    readiness: { total_operational_needs: 1, ready_direct: 0, ready_offer: 0, blocked: 0, already_assigned: 0, executing: 0, completed: 0 },
    health: { state: 'ON_TRACK', reason_code: 'ON_TRACK', reason_text: 'Execução dentro do esperado.' },
    exceptions: [],
    replan: { status: 'REPLAN_NOT_NEEDED', reason_code: 'NOT_NEEDED', suggested_next_step: null, remaining_quantity: 0, quantity_unit: 'ton' },
    window: null,
    updated_at: '2026-08-24T10:00:00.000Z',
    ...overrides,
  };
}

function mockCampaignList() {
  return (url: string) => {
    if (url === '/operation-campaigns') return Promise.resolve({ data: { itens: [campaign] } });
    if (url === '/operation-campaigns/context') return Promise.resolve({ data: { unidades: [] } });
    return Promise.resolve({ data: {} });
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // O hook de realtime (useLancamentosRealtime) chama fetch() real para o SSE. Sem isto, o
  // teste tenta uma conexão de rede de verdade (jsdom) e trava até o timeout — não é uma
  // falha de implementação, é ausência de mock do limite de I/O (mesmo princípio já aplicado
  // ao axios via vi.mock('../api')). Cada teste de realtime sobrescreve com seu próprio mock.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('sse indisponível em teste'))));
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
  vi.unstubAllGlobals();
});

describe('OperationCampaigns materializacao', () => {
  test('exige preview antes de materializar fretes de plano aprovado', async () => {
    render(<MemoryRouter><OperationCampaigns /></MemoryRouter>);

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
  }, 15000); // fluxo de várias interações/renders — folga acima do default de 5s (ambiente jsdom variável)
});

describe('CampaignExecution', () => {
  test('estado de carregamento aparece antes da resposta do progresso', async () => {
    let liberar: (v: unknown) => void = () => {};
    mockApi.get.mockImplementation((url: string) => {
      if (url.endsWith('/progress')) return new Promise((resolve) => { liberar = resolve; });
      return mockCampaignList()(url);
    });

    render(<MemoryRouter><OperationCampaigns /></MemoryRouter>);
    expect(await screen.findByText('Carregando execução da campanha…')).toBeInTheDocument();

    liberar({ data: buildProgress() });
    await waitFor(() => expect(screen.queryByText('Carregando execução da campanha…')).not.toBeInTheDocument());
  }, 10000);

  test('mostra "sem execução ainda" e nenhuma barra de progresso quando não há viagens/meta', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.endsWith('/progress')) {
        return Promise.resolve({
          data: buildProgress({
            health: { state: 'NO_EXECUTION_YET', reason_code: 'NO_EXECUTION_YET', reason_text: 'Nenhuma viagem materializada ainda.' },
            progress: {
              trips: { planned_total: 0, not_materialized: 0, materialized: 0, in_execution: 0, completed: 0, cancelled: 0, blocked: 0, unknown: 0 },
              quantity: { unit: 'ton', target: 0, planned: 0, materialized: 0, completed: 0, cancelled: 0, remaining: 0, coverage: { quantity_source: 'planned', measured_actual_available: false, trips_with_quantity: 0, trips_total: 0, incompatible_units: false } },
            },
            trips_detail: [],
          }),
        });
      }
      return mockCampaignList()(url);
    });

    render(<MemoryRouter><OperationCampaigns /></MemoryRouter>);
    const region = await screen.findByRole('region', { name: /Execução da campanha/i }, { timeout: 5000 });
    const utils = within(region);

    expect(utils.getByText('Sem execução ainda')).toBeInTheDocument();
    expect(utils.getByText('Nenhuma viagem planejada neste plano.')).toBeInTheDocument();
    expect(utils.queryByRole('progressbar')).not.toBeInTheDocument();
  }, 10000);

  test('progresso misto: cards, % concluído, replanejamento recomendado, bloqueio, cancelado e link do frete', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.endsWith('/progress')) {
        return Promise.resolve({
          data: buildProgress({
            approved_plan: { id: 'plan-1', version_number: 2 },
            progress: {
              trips: { planned_total: 5, not_materialized: 1, materialized: 4, in_execution: 1, completed: 1, cancelled: 1, blocked: 1, unknown: 0 },
              quantity: { unit: 'ton', target: 100, planned: 100, materialized: 80, completed: 40, cancelled: 10, remaining: 60, coverage: { quantity_source: 'planned', measured_actual_available: true, trips_with_quantity: 5, trips_total: 5, incompatible_units: false } },
            },
            trips_detail: [
              { planned_trip_id: 'trip-1', origem: 'Fazenda Alfa', destino: 'Porto X', planned_quantity: 20, quantity_unit: 'ton', materialization: 'MATERIALIZED', frete_id: 'frete-77', execution_status: 'em_viagem', execution_bucket: 'IN_EXECUTION', readiness: 'ALREADY_EXECUTING', attention: [] },
              { planned_trip_id: 'trip-2', origem: 'Fazenda Beta', destino: 'Porto X', planned_quantity: 20, quantity_unit: 'ton', materialization: 'MATERIALIZED', frete_id: null, execution_status: 'cancelado', execution_bucket: 'CANCELLED', readiness: 'BLOCKED', attention: ['frete cancelado'] },
              { planned_trip_id: 'trip-3', origem: null, destino: null, planned_quantity: 20, quantity_unit: 'ton', materialization: 'NOT_MATERIALIZED', frete_id: null, execution_status: null, execution_bucket: null, readiness: 'BLOCKED', attention: ['sem candidato elegível'] },
            ],
            health: { state: 'CRITICAL', reason_code: 'BLOCKED_TRIPS', reason_text: 'Há viagens bloqueadas que precisam de atenção.' },
            replan: { status: 'REPLAN_RECOMMENDED', reason_code: 'PACE_BEHIND', suggested_next_step: 'Considere gerar um novo plano para cobrir a demanda restante.', remaining_quantity: 60, quantity_unit: 'ton' },
            window: { state: 'IN_WINDOW', planned_start: '2026-08-01', planned_end: '2026-09-01' },
          }),
        });
      }
      return mockCampaignList()(url);
    });

    render(<MemoryRouter><OperationCampaigns /></MemoryRouter>);
    const region = await screen.findByRole('region', { name: /Execução da campanha/i }, { timeout: 5000 });
    const utils = within(region);

    expect(utils.getByText('Crítico')).toBeInTheDocument();
    expect(utils.getByText('Plano v2')).toBeInTheDocument();
    expect(utils.getByText('Replanejamento recomendado')).toBeInTheDocument();
    expect(utils.getByText('Considere gerar um novo plano para cobrir a demanda restante.')).toBeInTheDocument();
    expect(utils.getByText(/Demanda restante: 60 ton/)).toBeInTheDocument();

    // % concluído = completed/target = 40/100 = 40%
    const bar = utils.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '40');

    expect(utils.getByText(/Bloqueado \(plano\): 1/)).toBeInTheDocument();

    const table = utils.getByRole('table');
    expect(within(table).getByText('Cancelado')).toBeInTheDocument(); // BUCKET_LABEL da trip-2
    expect(within(table).getAllByText('Bloqueado').length).toBe(2); // READINESS_LABEL da trip-2 e trip-3
    expect(utils.getByText('frete cancelado')).toBeInTheDocument();
    expect(utils.getByText('sem candidato elegível')).toBeInTheDocument();

    const freightLink = utils.getByRole('link', { name: /Frete/i });
    expect(freightLink).toHaveAttribute('href', '/relatorios/viagens?frete=frete-77');
  }, 10000);

  test('estado desconhecido de viagem é sinalizado como tal (nunca inferido como em execução/concluído)', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.endsWith('/progress')) {
        return Promise.resolve({
          data: buildProgress({
            progress: {
              trips: { planned_total: 2, not_materialized: 0, materialized: 2, in_execution: 0, completed: 0, cancelled: 0, blocked: 0, unknown: 1 },
              quantity: { unit: 'ton', target: 20, planned: 20, materialized: 20, completed: 0, cancelled: 0, remaining: 20, coverage: { quantity_source: 'planned', measured_actual_available: true, trips_with_quantity: 2, trips_total: 2, incompatible_units: false } },
            },
            trips_detail: [
              { planned_trip_id: 'trip-1', origem: 'A', destino: 'B', planned_quantity: 10, quantity_unit: 'ton', materialization: 'MATERIALIZED', frete_id: 'frete-9', execution_status: 'status_nao_mapeado', execution_bucket: 'UNKNOWN', readiness: 'READY_FOR_DIRECT_ASSIGNMENT', attention: [] },
            ],
          }),
        });
      }
      return mockCampaignList()(url);
    });

    render(<MemoryRouter><OperationCampaigns /></MemoryRouter>);
    const region = await screen.findByRole('region', { name: /Execução da campanha/i }, { timeout: 5000 });
    const utils = within(region);

    expect(utils.getByText(/Estado desconhecido: 1/)).toBeInTheDocument();
    const table = utils.getByRole('table');
    expect(within(table).getByText('Desconhecido')).toBeInTheDocument(); // BUCKET_LABEL.UNKNOWN
  }, 10000);

  test('elegibilidade: exibe candidatos, alertas e bloqueios ao clicar em "Ver elegibilidade"', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.endsWith('/progress')) {
        return Promise.resolve({
          data: buildProgress({
            trips_detail: [
              { planned_trip_id: 'trip-1', origem: 'A', destino: 'B', planned_quantity: 10, quantity_unit: 'ton', materialization: 'NOT_MATERIALIZED', frete_id: null, execution_status: null, execution_bucket: null, readiness: 'BLOCKED', attention: ['sem candidato elegível'] },
            ],
          }),
        });
      }
      if (url.endsWith('/eligibility')) {
        return Promise.resolve({
          data: {
            summary: { total_candidates: 2, eligible: 1, eligible_with_warnings: 1, ineligible: 0, has_any_eligible: true },
            candidates: [
              { driver_id: 'driver-aaaaaaaa', asset_id: 'asset-1', composition_id: null, eligibility: 'ELIGIBLE', reasons: [], warnings: [], capacity_match: 'OK', documents_status: 'OK', maintenance_status: 'OK', assignment_status: 'FREE', route_compatibility: 'UNKNOWN', capacity_kg: 12000 },
              { driver_id: 'driver-bbbbbbbb', asset_id: null, composition_id: 'comp-1', eligibility: 'ELIGIBLE_WITH_WARNINGS', reasons: [], warnings: ['documento vence em breve'], capacity_match: 'OK', documents_status: 'ATTENTION', maintenance_status: 'OK', assignment_status: 'FREE', route_compatibility: 'UNKNOWN', capacity_kg: 8000 },
            ],
            truncated: false,
          },
        });
      }
      return mockCampaignList()(url);
    });

    render(<MemoryRouter><OperationCampaigns /></MemoryRouter>);
    const region = await screen.findByRole('region', { name: /Execução da campanha/i }, { timeout: 5000 });
    fireEvent.click(within(region).getByRole('button', { name: /Ver elegibilidade/i }));

    expect(await within(region).findByText(/1 elegível\(is\), 1 com alertas, 0 inelegível\(is\)\./)).toBeInTheDocument();
    expect(within(region).getByText('Elegível')).toBeInTheDocument();
    expect(within(region).getByText('Elegível com alertas')).toBeInTheDocument();
    expect(within(region).getByText('Alertas: documento vence em breve')).toBeInTheDocument();
    expect(mockApi.get).toHaveBeenCalledWith('/operation-campaigns/campaign-1/plans/plan-1/trips/trip-1/eligibility');
  }, 10000);

  test('falha ao carregar progresso mostra motivo traduzido (permissão), nunca dado inventado', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.endsWith('/progress')) return Promise.reject({ response: { data: { denial: 'permission_denied' } } });
      return mockCampaignList()(url);
    });

    render(<MemoryRouter><OperationCampaigns /></MemoryRouter>);
    expect(await screen.findByText(/Execução indisponível no momento\.\s*Seu perfil não tem permissão para operar campanhas de escoamento\./, {}, { timeout: 5000 })).toBeInTheDocument();
  }, 10000);

  test('reconexão do SSE recarrega o progresso automaticamente', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    let progressCalls = 0;
    mockApi.get.mockImplementation((url: string) => {
      if (url.endsWith('/progress')) {
        progressCalls += 1;
        return Promise.resolve({ data: buildProgress({ health: { state: 'ON_TRACK', reason_code: 'X', reason_text: `carregamento ${progressCalls}` } }) });
      }
      return mockCampaignList()(url);
    });

    render(<MemoryRouter><OperationCampaigns /></MemoryRouter>);
    await screen.findByRole('region', { name: /Execução da campanha/i }, { timeout: 5000 });
    const callsAntesDoReconnect = progressCalls;

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // onSync('__reconnect__') é debounced em 600ms — aguarda o refetch subsequente.
    await waitFor(() => expect(progressCalls).toBeGreaterThan(callsAntesDoReconnect), { timeout: 3000 });
  }, 12000);

  test('desmontar encerra a assinatura SSE (sem novas chamadas de progresso após unmount)', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    let progressCalls = 0;
    mockApi.get.mockImplementation((url: string) => {
      if (url.endsWith('/progress')) { progressCalls += 1; return Promise.resolve({ data: buildProgress() }); }
      return mockCampaignList()(url);
    });

    const { unmount } = render(<MemoryRouter><OperationCampaigns /></MemoryRouter>);
    await screen.findByRole('region', { name: /Execução da campanha/i }, { timeout: 5000 });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    unmount();
    const callsNoUnmount = progressCalls;
    const fetchCallsNoUnmount = fetchMock.mock.calls.length;
    await new Promise((r) => setTimeout(r, 700));

    expect(progressCalls).toBe(callsNoUnmount);
    expect(fetchMock.mock.calls.length).toBe(fetchCallsNoUnmount);
  }, 12000);
});
