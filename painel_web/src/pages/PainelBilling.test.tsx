import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

import api from '../api';
import { PainelBilling } from './PainelBilling';

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

const empresas = [{ id: 'e1', nome: 'Empresa Alfa' }, { id: 'e2', nome: 'Autônomo Beta' }];
const overview = {
  overview: {
    empresa_id: 'e1', empresa_nome: 'Empresa Alfa', plano_nome: 'Empresa Start', situacao_comercial: 'trial_ativo',
    trial_ends_at: '2026-08-20T00:00:00.000Z', asaas_customer: null, tem_customer: false, asaas_subscription: null,
    tem_assinatura: false, billing_status: null, proxima_cobranca: '2026-08-20', ultima_cobranca: null,
    inadimplente: false, suspender: false, em_graca: false, dias_atraso: 0, trial_protege: true,
    ultimo_webhook: null, billing_updated_at: null,
  },
  policy: { implantacao_timing: 'nao_cobrar', grace_period_days: 5, provider_mode: 'fake' },
};

beforeEach(() => { vi.clearAllMocks(); });

function setup() {
  mockApi.get.mockImplementation((url: string) => {
    if (url === '/painel-admin/empresas') return Promise.resolve({ data: empresas });
    if (url === '/pagamentos/billing/overview/e1') return Promise.resolve({ data: overview });
    return Promise.resolve({ data: {} });
  });
}

describe('PainelBilling (página real, API mockada)', () => {
  test('1. carrega empresas e mostra estado inicial (nenhuma selecionada)', async () => {
    setup();
    render(<PainelBilling />);
    await waitFor(() => expect(screen.getByText(/selecione uma empresa para ver o billing/i)).toBeInTheDocument());
    expect(screen.getByRole('combobox', { name: /empresa/i })).toBeInTheDocument();
  });

  test('2. selecionar empresa carrega overview (situação/plano/trial protege)', async () => {
    setup();
    render(<PainelBilling />);
    await waitFor(() => expect(screen.getByText('Empresa Alfa')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox', { name: /empresa/i }), { target: { value: 'e1' } });
    await waitFor(() => expect(screen.getByText('trial_ativo')).toBeInTheDocument());
    expect(screen.getByText('Empresa Start')).toBeInTheDocument();
    expect(screen.getByText(/trial protege/i)).toBeInTheDocument();
  });

  test('3. erro no overview mostra retry', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/painel-admin/empresas') return Promise.resolve({ data: empresas });
      return Promise.reject(new Error('falha'));
    });
    render(<PainelBilling />);
    await waitFor(() => expect(screen.getByText('Empresa Alfa')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox', { name: /empresa/i }), { target: { value: 'e1' } });
    await waitFor(() => expect(screen.getByText(/não foi possível carregar o billing/i)).toBeInTheDocument());
  });

  test('4. botão "Ver plano (dry)" chama ensure-plan e exibe o plano', async () => {
    setup();
    mockApi.post.mockResolvedValue({ data: { plano: { acoes: [{ tipo: 'garantir_customer' }], motivo: 'planejado:trial_ativo' }, executado: false } });
    render(<PainelBilling />);
    await waitFor(() => expect(screen.getByText('Empresa Alfa')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox', { name: /empresa/i }), { target: { value: 'e1' } });
    await waitFor(() => expect(screen.getByText('trial_ativo')).toBeInTheDocument());
    fireEvent.click(screen.getByText(/ver plano \(dry\)/i));
    await waitFor(() => expect(screen.getByText(/plano de billing \(dry-run\)/i)).toBeInTheDocument());
    expect(mockApi.post).toHaveBeenCalledWith('/pagamentos/billing/ensure-plan/e1', {});
  });
});
