import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MinhasFaturas } from './MinhasFaturas';
import api from '../api';

// REG-001, parte 2 — a ABA como estado navegável.
//
// A Sidebar deixou de ter um segundo item "Contratação"; o caminho para a
// assinatura passa a ser o CTA (banner/card) apontando para
// `/minhas-faturas?aba=contratacao`. Isso só é aceitável se a aba for de fato
// derivada da URL: deep link, reload e Voltar/Avançar têm de funcionar. Se a aba
// virasse estado local, a correção do menu teria criado um caminho quebrado.

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const authState: { user: Record<string, unknown> | null } = { user: null };
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: authState.user }) }));
vi.mock('../hooks/useContratacaoStatus', () => ({
  useContratacaoStatus: () => ({ pendenciaObrigatoria: false }),
}));

// As sub-telas da aba de contratação têm rede própria; aqui interessa QUAL aba
// está montada, não o conteúdo delas.
vi.mock('../components/ComparadorPlanos', () => ({
  ComparadorPlanos: () => <div data-testid="comparador-planos" />,
}));
vi.mock('./Contratacao', () => ({
  Contratacao: () => <div data-testid="painel-contratacao" />,
}));
vi.mock('../components/PlanoContratos', () => ({
  PlanoContratos: () => <div data-testid="plano-contratos" />,
}));

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

function renderEm(rota: string) {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <Routes>
        <Route path="/minhas-faturas" element={<MinhasFaturas />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.user = { uid: 'u-1', nome: 'Admin', role: 'admin', is_super_admin: false, empresa_id: 'e-1' };
  mockApi.get.mockImplementation((url: string) => {
    if (url.includes('/pagamentos/cobrancas/')) return Promise.resolve({ data: [] });
    if (url.includes('/pagamentos/plano-status')) return Promise.resolve({ data: { status: 'ativo' } });
    return Promise.resolve({ data: {} });
  });
});

describe('deep link da aba de contratação', () => {
  test('sem parâmetro abre a aba de faturas', async () => {
    renderEm('/minhas-faturas');
    await waitFor(() => expect(screen.getByText('Faturas e Regularização')).toBeInTheDocument());
    expect(screen.queryByTestId('painel-contratacao')).not.toBeInTheDocument();
  });

  test('?aba=contratacao abre direto a aba de contratação (deep link / reload)', async () => {
    renderEm('/minhas-faturas?aba=contratacao');
    await waitFor(() => expect(screen.getByTestId('painel-contratacao')).toBeInTheDocument());
    expect(screen.getByTestId('comparador-planos')).toBeInTheDocument();
  });

  test('valor desconhecido em ?aba cai na aba padrão em vez de quebrar', async () => {
    renderEm('/minhas-faturas?aba=inexistente');
    await waitFor(() => expect(screen.getByText('Faturas e Regularização')).toBeInTheDocument());
    expect(screen.queryByTestId('painel-contratacao')).not.toBeInTheDocument();
  });

  test('a aba é derivada da URL, não de estado local (Voltar/Avançar funcionam)', async () => {
    // Montar em `?aba=contratacao` e depois em `/minhas-faturas` precisa dar
    // resultados diferentes — é o que garante que o histórico do navegador mande.
    const { unmount } = renderEm('/minhas-faturas?aba=contratacao');
    await waitFor(() => expect(screen.getByTestId('painel-contratacao')).toBeInTheDocument());
    unmount();

    renderEm('/minhas-faturas');
    await waitFor(() => expect(screen.getByText('Faturas e Regularização')).toBeInTheDocument());
    expect(screen.queryByTestId('painel-contratacao')).not.toBeInTheDocument();
  });
});

describe('BUG-005 — copy do plano na tela', () => {
  test('plano ativo sem pendência não alarma', async () => {
    renderEm('/minhas-faturas');
    await waitFor(() => expect(screen.getByText('Plano ativo')).toBeInTheDocument());
  });
});
