import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MinhasFaturas } from './MinhasFaturas';
import api from '../api';

// REG-001 (parte 2) — a ABA como estado navegável.
// S1-HIGH-01 — CONTRACT_ACCESS_IS_NOT_FINANCE_ACCESS.
//
// A Sidebar deixou de ter um segundo item "Contratação"; o caminho para a
// assinatura é o CTA apontando para `/minhas-faturas?aba=contratacao`. Isso obriga
// duas coisas: a aba tem de derivar da URL (deep link/reload/back), e abrir a aba
// de contratação NÃO pode disparar I/O financeiro que o usuário talvez não possa
// fazer. Devolver 403 no backend não basta — a UI não deve pedir o que sabe que
// não pode pedir.

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const authState: { user: Record<string, unknown> | null } = { user: null };
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: authState.user }) }));

const contratacaoState: Record<string, unknown> = { pendenciaObrigatoria: false };
vi.mock('../hooks/useContratacaoStatus', () => ({
  useContratacaoStatus: () => contratacaoState,
}));

// As sub-telas da aba de contratação têm rede própria; aqui interessa QUAL aba
// está montada e QUAIS chamadas a página faz — não o conteúdo delas.
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

const ENDPOINTS_FINANCEIROS = ['/pagamentos/cobrancas/', '/pagamentos/plano-status', '/pagamentos/faturas/'];

function chamadasFinanceiras() {
  const gets = mockApi.get.mock.calls.map((c) => String(c[0]));
  const posts = mockApi.post.mock.calls.map((c) => String(c[0]));
  return {
    gets: gets.filter((u) => ENDPOINTS_FINANCEIROS.some((e) => u.includes(e))),
    posts: posts.filter((u) => u.includes('/pagamentos/')),
    todos: [...gets, ...posts],
  };
}

function usuario(permissoes: Record<string, boolean>) {
  return {
    uid: 'u-1', nome: 'Fulano', role: 'admin', is_super_admin: false,
    empresa_id: 'e-1', effective_permissions: permissoes,
  };
}

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
  authState.user = usuario({ 'finance.saas.view': true });
  for (const k of Object.keys(contratacaoState)) delete contratacaoState[k];
  contratacaoState.pendenciaObrigatoria = false;
  mockApi.get.mockImplementation((url: string) => {
    if (url.includes('/pagamentos/cobrancas/')) return Promise.resolve({ data: [] });
    if (url.includes('/pagamentos/plano-status')) return Promise.resolve({ data: { status: 'ativo' } });
    return Promise.resolve({ data: {} });
  });
  mockApi.post.mockResolvedValue({ data: {} });
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
    const { unmount } = renderEm('/minhas-faturas?aba=contratacao');
    await waitFor(() => expect(screen.getByTestId('painel-contratacao')).toBeInTheDocument());
    unmount();

    renderEm('/minhas-faturas');
    await waitFor(() => expect(screen.getByText('Faturas e Regularização')).toBeInTheDocument());
    expect(screen.queryByTestId('painel-contratacao')).not.toBeInTheDocument();
  });
});

describe('S1-HIGH-01 — nenhum I/O financeiro fora da área financeira', () => {
  test('persona SÓ de contratação: aba acessível e ZERO chamada financeira', async () => {
    authState.user = usuario({ 'company.settings.manage': true }); // sem finance.saas.view
    contratacaoState.pendenciaObrigatoria = true;

    renderEm('/minhas-faturas?aba=contratacao');
    await waitFor(() => expect(screen.getByTestId('painel-contratacao')).toBeInTheDocument());
    // dá tempo de qualquer efeito atrasado disparar
    await new Promise((r) => setTimeout(r, 30));

    const chamadas = chamadasFinanceiras();
    expect(chamadas.gets, `GETs financeiros indevidos: ${chamadas.gets.join(', ')}`).toHaveLength(0);
    expect(chamadas.posts, `POSTs indevidos: ${chamadas.posts.join(', ')}`).toHaveLength(0);
  });

  test('persona só de contratação não vê a aba Faturas nem conteúdo financeiro', async () => {
    authState.user = usuario({ 'company.settings.manage': true });
    renderEm('/minhas-faturas?aba=contratacao');
    await waitFor(() => expect(screen.getByTestId('painel-contratacao')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: 'Faturas' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plano e contratação' })).toBeInTheDocument();
  });

  test('forçar ?aba=faturas sem permissão financeira não vaza conteúdo nem dispara I/O', async () => {
    authState.user = usuario({ 'company.settings.manage': true });
    renderEm('/minhas-faturas?aba=faturas');
    await waitFor(() => expect(screen.getByTestId('painel-contratacao')).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 30));

    const chamadas = chamadasFinanceiras();
    expect(chamadas.gets).toHaveLength(0);
    expect(chamadas.posts).toHaveLength(0);
    // e não existe dead-end: a assinatura continua acessível
    expect(screen.getByRole('button', { name: 'Plano e contratação' })).toBeInTheDocument();
  });

  test('persona COM finança na aba contratação: sem auto-sync (CONTRACT_TAB_AUTO_FINANCE_SYNC=false)', async () => {
    authState.user = usuario({ 'finance.saas.view': true });
    renderEm('/minhas-faturas?aba=contratacao');
    await waitFor(() => expect(screen.getByTestId('painel-contratacao')).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 30));

    expect(mockApi.post).not.toHaveBeenCalled();
    expect(chamadasFinanceiras().gets).toHaveLength(0);
  });

  test('persona COM finança na aba faturas: carrega e sincroniza normalmente', async () => {
    authState.user = usuario({ 'finance.saas.view': true });
    renderEm('/minhas-faturas');
    await waitFor(() => expect(screen.getByText('Plano ativo')).toBeInTheDocument());
    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/pagamentos/minhas-faturas/sincronizar'));

    const gets = mockApi.get.mock.calls.map((c) => String(c[0]));
    expect(gets.some((u) => u.includes('/pagamentos/cobrancas/'))).toBe(true);
    expect(gets.some((u) => u.includes('/pagamentos/plano-status'))).toBe(true);
  });
});

describe('S1-HIGH-02 — a tela usa a mesma autoridade semântica do shell', () => {
  test('plano ativo sem pendência não alarma', async () => {
    renderEm('/minhas-faturas');
    await waitFor(() => expect(screen.getByText('Plano ativo')).toBeInTheDocument());
  });

  test('plano ativo com contrato pendente revela o efeito operacional sem exagerar', async () => {
    contratacaoState.pendenciaObrigatoria = true;
    renderEm('/minhas-faturas');
    await waitFor(() => expect(screen.getByText(/Plano ativo — assinatura do contrato pendente/)).toBeInTheDocument());
    expect(screen.getByText(/algumas ações podem ficar restritas/i)).toBeInTheDocument();
    expect(screen.getByText(/consulta dos seus dados continua liberada/i)).toBeInTheDocument();
  });
});
