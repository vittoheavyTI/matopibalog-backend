import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import api from '../api';

// Regressão REG-001 — DUPLICATE_FINANCIAL_NAV_AND_ACTIVE_STATE.
//
// O produto tinha DOIS itens de navegação apontando para o mesmo pathname
// (`/minhas-faturas` e `/minhas-faturas?aba=contratacao`). O `isActive` do
// react-router compara PATHNAME, ignorando a query string — então os dois
// acendiam ao mesmo tempo e o usuário via duas seções "onde estou".
//
// Estes testes não guardam a cor: guardam a INVARIANTE de navegação
// `ONE_PRIMARY_NAV_ITEM_ACTIVE` e a decisão de produto
// `FINANCIAL_SIDEBAR_SINGLE_ENTRY`. Servem para qualquer item futuro.

vi.mock('../api', () => ({ default: { get: vi.fn(), put: vi.fn() } }));

const authState: { user: Record<string, unknown> | null } = { user: null };
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: authState.user }),
}));

const contratacaoState = { pendenciaObrigatoria: false };
vi.mock('../hooks/useContratacaoStatus', () => ({
  useContratacaoStatus: () => contratacaoState,
}));

vi.mock('../hooks/usePortalGovernanca', () => ({
  usePortalGovernanca: () => ({ governanca: null, loading: false }),
}));

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> };

const CLASSE_ATIVA = 'bg-green-700';

/** Todos os links primários da Sidebar que estão marcados como ativos. */
function itensAtivos(): HTMLAnchorElement[] {
  return Array.from(document.querySelectorAll('a'))
    .filter((a) => a.className.includes(CLASSE_ATIVA)) as HTMLAnchorElement[];
}

function renderSidebar(rota: string) {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

function adminComFinanceiro(over: Record<string, unknown> = {}) {
  return {
    uid: 'u-1',
    nome: 'Admin',
    role: 'admin',
    is_super_admin: false,
    empresa_id: 'emp-1',
    effective_permissions: { 'finance.saas.view': true },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockApi.get.mockResolvedValue({ data: {} });
  authState.user = adminComFinanceiro();
  contratacaoState.pendenciaObrigatoria = false;
});

describe('REG-001 — um único item de navegação ativo', () => {
  test('/minhas-faturas acende exatamente 1 item', () => {
    renderSidebar('/minhas-faturas');
    expect(itensAtivos()).toHaveLength(1);
  });

  test('/minhas-faturas?aba=contratacao acende exatamente 1 item', () => {
    contratacaoState.pendenciaObrigatoria = true;
    renderSidebar('/minhas-faturas?aba=contratacao');
    // Antes da correção: 2 (Faturas / Regularização + Contratação), porque o
    // isActive do react-router compara pathname e ignora `?aba=`.
    expect(itensAtivos()).toHaveLength(1);
  });

  test('nenhuma rota do cliente acende dois itens ao mesmo tempo', () => {
    contratacaoState.pendenciaObrigatoria = true;
    authState.user = adminComFinanceiro({
      effective_permissions: {
        'finance.saas.view': true,
        'fleet.view': true,
        'campaign.view': true,
        'partner_network.view': true,
        'reports.operational.view': true,
        'reports.financial.view': true,
        'freight.view': true,
        'drivers.view': true,
        'users.view': true,
        'permissions.manage': true,
        'company.settings.view': true,
        'shipper_portal.requests.review': true,
      },
    });
    const rotas = [
      '/', '/relatorios', '/relatorios/viagens', '/relatorios/resumo',
      '/relatorios/rentabilidade', '/relatorios/acerto-motoristas',
      '/relatorios/torre-controle', '/rota', '/frota', '/campanhas-escoamento',
      '/rede-parceiros', '/solicitacoes-embarcadores', '/motoristas', '/admins',
      '/perfis-permissoes', '/minhas-faturas', '/minhas-faturas?aba=contratacao',
      '/configuracoes',
    ];
    for (const rota of rotas) {
      const { unmount } = renderSidebar(rota);
      const ativos = itensAtivos().map((a) => a.getAttribute('href'));
      expect(ativos.length, `${rota} acendeu ${ativos.length} itens: ${ativos.join(', ')}`).toBeLessThanOrEqual(1);
      unmount();
    }
  });

  test('rota sem item de menu correspondente não acende nada', () => {
    renderSidebar('/rota-que-nao-existe');
    expect(itensAtivos()).toHaveLength(0);
  });
});

describe('REG-001 — entrada financeira única na Sidebar', () => {
  test('com contratação pendente existe UM item financeiro, com badge de ação', () => {
    contratacaoState.pendenciaObrigatoria = true;
    renderSidebar('/minhas-faturas');

    const financeiros = Array.from(document.querySelectorAll('a'))
      .filter((a) => (a.getAttribute('href') || '').startsWith('/minhas-faturas'));
    expect(financeiros).toHaveLength(1);

    expect(screen.getByText('Faturas / Regularização')).toBeInTheDocument();
    expect(screen.queryByText('Contratação')).not.toBeInTheDocument();
    expect(screen.getByText('Ação necessária')).toBeInTheDocument();
  });

  test('sem contratação pendente o badge não aparece', () => {
    contratacaoState.pendenciaObrigatoria = false;
    renderSidebar('/minhas-faturas');

    expect(screen.getByText('Faturas / Regularização')).toBeInTheDocument();
    expect(screen.queryByText('Ação necessária')).not.toBeInTheDocument();
  });

  test('sem finance.saas.view não aparece item financeiro nenhum (banner global conduz)', () => {
    contratacaoState.pendenciaObrigatoria = true;
    authState.user = adminComFinanceiro({ effective_permissions: {} });
    renderSidebar('/');

    const financeiros = Array.from(document.querySelectorAll('a'))
      .filter((a) => (a.getAttribute('href') || '').startsWith('/minhas-faturas'));
    expect(financeiros).toHaveLength(0);
    expect(screen.queryByText('Contratação')).not.toBeInTheDocument();
  });

  test('super-admin não recebe item de contratação do cliente', () => {
    contratacaoState.pendenciaObrigatoria = true;
    authState.user = { uid: 's-1', nome: 'Super', role: 'admin', is_super_admin: true };
    renderSidebar('/');

    expect(screen.queryByText('Contratação')).not.toBeInTheDocument();
    expect(screen.queryByText('Faturas / Regularização')).not.toBeInTheDocument();
    expect(itensAtivos()).toHaveLength(1); // Dashboard
  });
});
