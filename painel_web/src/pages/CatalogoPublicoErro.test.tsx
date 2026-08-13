import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  newClientRequestId: () => 'test-id',
}));

vi.mock('../hooks/useLoginConfig', () => ({
  useLoginConfig: () => ({
    loginLogo: '',
    loginLogoScale: 100,
    loginLogoY: 0,
    configLoading: false,
    contactEmail: '',
    contactPhone: '',
    whatsappSuporte: '',
  }),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

import api from '../api';
import { CadastroPublico } from './CadastroPublico';
import { PlanosPublicos } from './PlanosPublicos';

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> };

const planoStart = {
  id: '00000000-0000-0000-0000-000000000002',
  nome: 'Empresa Start',
  descricao: 'Plano real vindo da API',
  preco_mensal: 299.9,
  modelo_cobranca: 'fixo',
  preco_por_motorista: null,
  limite_motoristas: 5,
  dias_trial: 14,
  valor_implantacao: 0,
  capacidade_inclusa: 5,
  preco_motorista_extra: 100,
  recursos: ['5 motoristas incluídos'],
  requer_negociacao: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('catálogo público sem fallback comercial hardcoded', () => {
  test('/planos: erro da API mostra retry e não renderiza card falso', async () => {
    let chamadas = 0;
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/planos/publicos?categoria=empresa') {
        chamadas += 1;
        return chamadas === 1
          ? Promise.reject(new Error('rede'))
          : Promise.resolve({ data: { planos: [planoStart] } });
      }
      return Promise.resolve({ data: {} });
    });

    render(<MemoryRouter><PlanosPublicos /></MemoryRouter>);

    await waitFor(() => expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument());
    expect(screen.queryByText('Empresa Start')).toBeNull();
    expect(screen.queryByRole('button', { name: /começar agora/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    await waitFor(() => expect(screen.getByText('Empresa Start')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /começar agora/i })).toBeInTheDocument();
  });

  test('/cadastro: erro da API mostra retry e não seleciona plano inventado', async () => {
    let chamadas = 0;
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/planos/publicos?categoria=empresa') {
        chamadas += 1;
        return chamadas === 1
          ? Promise.reject(new Error('rede'))
          : Promise.resolve({ data: { planos: [planoStart] } });
      }
      return Promise.resolve({ data: {} });
    });

    render(<MemoryRouter><CadastroPublico /></MemoryRouter>);

    await waitFor(() => expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument());
    expect(screen.queryByText('Empresa Start')).toBeNull();
    expect(screen.queryByRole('button', { name: /continuar com/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    await waitFor(() => expect(screen.getByText('Empresa Start')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /continuar com empresa start/i })).toBeInTheDocument();
  });
});
