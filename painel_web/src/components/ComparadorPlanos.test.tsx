import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ComparadorPlanos } from './ComparadorPlanos';
import api from '../api';

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1', role: 'admin', empresa_tipo: 'empresa', is_super_admin: false } }),
}));

vi.mock('../hooks/useLoginConfig', () => ({
  useLoginConfig: () => ({ contactEmail: 'x@y.com', contactPhone: '', whatsappSuporte: '' }),
}));

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

const planos = [
  { id: 'plano-start', nome: 'Empresa Start', descricao: 'Base', preco_mensal: 299.9, modelo_cobranca: 'fixo', preco_por_motorista: null, limite_motoristas: 5, dias_trial: 14, recursos: [], requer_negociacao: false },
  { id: 'plano-growth', nome: 'Empresa Growth', descricao: 'Cresce', preco_mensal: 799.9, modelo_cobranca: 'fixo', preco_por_motorista: null, limite_motoristas: 20, dias_trial: 14, recursos: [], requer_negociacao: false },
];

function mockGet(planoAtual: string | null) {
  mockApi.get.mockImplementation((url: string) => {
    if (url.startsWith('/planos/publicos')) return Promise.resolve({ data: { planos } });
    if (url.startsWith('/contratacao/status')) return Promise.resolve({ data: { plano_id: planoAtual } });
    return Promise.resolve({ data: {} });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: o preview de simulação (POST /contratacao/plano-preview) resolve vazio.
  mockApi.post.mockResolvedValue({ data: {} });
});

describe('ComparadorPlanos', () => {
  test('destaca o plano atual e escolher outro chama /contratacao/iniciar sem cobrança', async () => {
    mockGet('plano-start');
    mockApi.post.mockResolvedValue({ data: { proposta_id: 'p1' } });

    render(<ComparadorPlanos />);

    // Copy honesta de "sem cobrança agora"
    await waitFor(() => expect(screen.getByText(/Nenhuma cobrança é feita agora/i)).toBeInTheDocument());
    // Plano atual destacado (botão do card selecionado)
    expect(screen.getByRole('button', { name: /Plano atual/i })).toBeInTheDocument();

    // Escolher o Growth (não é o atual) → POST /contratacao/iniciar
    const botoes = await screen.findAllByRole('button', { name: /Escolher este plano/i });
    fireEvent.click(botoes[0]);

    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/contratacao/iniciar', { plano_id: 'plano-growth' }));
    await waitFor(() => expect(screen.getByText(/nenhuma cobrança foi feita e seu teste segue ativo/i)).toBeInTheDocument());
  }, 15000);

  test('ERP/SSO sem preço aprovado aparecem como "Sob proposta" — nunca R$149,90 fabricado', async () => {
    mockGet('plano-start');
    const snapshot = {
      plano_atual: { id: 'plano-start', nome: 'Empresa Start', valor_mensal: 299.9, capacidade_inclusa: 5 },
      plano_alvo: null,
      add_ons: [
        { codigo: 'integracoes_erp', nome: 'Integrações ERP', em_breve: true, technical_status: 'PREPARING', selecionado: true,
          atual: { situacao: 'sob_proposta', valor_mensal: null, price_status: 'UNDER_PROPOSAL', commercial_status: 'UNDER_PROPOSAL' }, alvo: null },
      ],
      add_on_valor_padrao: 149.9,
      subtotal_plano_atual: 299.9, subtotal_addons_atual: 0, total_atual: null, total_atual_incompleto: true,
      subtotal_plano_alvo: null, subtotal_addons_alvo: null, total_alvo: null,
      diferenca_mensal: null,
      recomendacao: { tipo: 'sob_proposta', mensagem: 'É necessário falar com o comercial para comparar o valor final.' },
      proxima_fatura: { texto: 'Nenhuma cobrança é gerada agora.' },
    };
    mockApi.post.mockImplementation((url: string) => {
      if (url === '/contratacao/plano-preview') return Promise.resolve({ data: snapshot });
      return Promise.resolve({ data: {} });
    });

    render(<ComparadorPlanos />);

    await waitFor(() => expect(screen.getByText('Integrações ERP')).toBeInTheDocument());
    // Mostra "Sob proposta" e NÃO um valor fabricado de R$ 149,90 na linha do add-on/total.
    expect(screen.getAllByText(/Sob proposta/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/149,90\/mês/)).not.toBeInTheDocument();
  }, 15000);

  test('nao chama /contratacao/iniciar ao clicar no proprio plano atual', async () => {
    // Nenhum plano atual destacado → ambos clicáveis; simulamos atual = growth e clicamos nele.
    mockGet('plano-growth');
    render(<ComparadorPlanos />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Plano atual/i })).toBeInTheDocument());
    // O card do plano atual mostra "✓ Plano atual" e não dispara POST ao clicar.
    fireEvent.click(screen.getByRole('button', { name: /Plano atual/i }));
    // A simulação faz POST /contratacao/plano-preview; o que NÃO pode acontecer é
    // iniciar a aquisição do próprio plano atual.
    expect(mockApi.post).not.toHaveBeenCalledWith('/contratacao/iniciar', expect.anything());
    await waitFor(() => expect(screen.getByText(/já é o seu plano atual/i)).toBeInTheDocument());
  });
});
