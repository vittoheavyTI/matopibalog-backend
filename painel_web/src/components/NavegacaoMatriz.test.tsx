import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import { Sidebar } from './Sidebar';
import api from '../api';

// MATRIZ NAVEGAÇÃO × PERMISSÃO × ROTA.
//
// REG-001 passou por CI verde porque ninguém exercitava a navegação como um
// CONTRATO. Estes testes tratam menu e rotas como duas metades da mesma coisa e
// falham quando elas divergem — que é a classe inteira do achado, não o caso dele.
//
// O backend continua sendo a autoridade real de permissão; nada aqui afrouxa
// autorização. O que se prova é COERÊNCIA: o que o menu oferece, a rota aceita; o
// que o menu esconde por permissão, a rota não entrega por URL.

vi.mock('../api', () => ({ default: { get: vi.fn(), put: vi.fn() } }));

const authState: { user: Record<string, unknown> | null } = { user: null };
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: authState.user }) }));
vi.mock('../hooks/useContratacaoStatus', () => ({
  useContratacaoStatus: () => ({ pendenciaObrigatoria: false }),
}));
vi.mock('../hooks/usePortalGovernanca', () => ({
  usePortalGovernanca: () => ({ governanca: null, loading: false }),
}));

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> };

const APP_TSX = fs.readFileSync(
  path.resolve(__dirname, '..', 'App.tsx'),
  'utf8',
);

/** Rotas absolutas declaradas em App.tsx, com a permissão que as guarda (se houver). */
function rotasDeclaradas(): Map<string, string | null> {
  const rotas = new Map<string, string | null>();
  let prefixo = '';
  for (const linha of APP_TSX.split(/\r?\n/)) {
    const aninhada = linha.match(/<Route path="([^"]+)">\s*$/);
    if (aninhada) { prefixo = '/' + aninhada[1].replace(/^\//, ''); continue; }
    if (/^\s*<\/Route>/.test(linha)) { prefixo = ''; continue; }
    const m = linha.match(/path="([^"]+)"/);
    if (!m) continue;
    const bruto = m[1];
    if (bruto === '*' || bruto === 'index') continue;
    const absoluta = (bruto.startsWith('/') ? bruto : `${prefixo}/${bruto}`).replace(/\/+/g, '/');
    const guarda = linha.match(/PermissionRoute permission="([^"]+)"/);
    rotas.set(absoluta, guarda ? guarda[1] : null);
  }
  return rotas;
}

function renderSidebar(rota = '/') {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

function destinosVisiveis(): string[] {
  return Array.from(document.querySelectorAll('a'))
    .map((a) => a.getAttribute('href') || '')
    .filter(Boolean);
}

// Personas por PERMISSÃO EFETIVA (a autoridade V9), não por `role` legado.
const PERSONAS: Record<string, Record<string, boolean>> = {
  Administrador: {
    'fleet.view': true, 'campaign.view': true, 'partner_network.view': true,
    'reports.operational.view': true, 'reports.financial.view': true, 'freight.view': true,
    'drivers.view': true, 'users.view': true, 'permissions.manage': true,
    'company.settings.view': true, 'finance.saas.view': true,
    'shipper_portal.requests.review': true,
  },
  'Gerente de Frota': {
    'fleet.view': true, 'campaign.view': true, 'freight.view': true,
    'reports.operational.view': true, 'drivers.view': true,
  },
  Operador: { 'freight.view': true, 'drivers.view': true },
  Financeiro: { 'finance.saas.view': true, 'reports.financial.view': true },
  Motorista: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockApi.get.mockResolvedValue({ data: {} });
  authState.user = null;
});

describe('coerência menu × rota', () => {
  test('todo item de menu do cliente aponta para uma rota declarada', () => {
    const rotas = rotasDeclaradas();
    authState.user = {
      uid: 'u-1', role: 'admin', is_super_admin: false, empresa_id: 'e-1',
      effective_permissions: PERSONAS.Administrador,
    };
    renderSidebar();
    for (const destino of destinosVisiveis()) {
      const pathname = destino.split('?')[0];
      expect(rotas.has(pathname) || pathname === '/', `menu aponta para rota inexistente: ${pathname}`).toBe(true);
    }
  });

  test('todo item de menu do super-admin aponta para uma rota declarada', () => {
    const rotas = rotasDeclaradas();
    authState.user = { uid: 's-1', role: 'admin', is_super_admin: true };
    renderSidebar();
    for (const destino of destinosVisiveis()) {
      const pathname = destino.split('?')[0];
      expect(rotas.has(pathname) || pathname === '/', `menu super aponta para rota inexistente: ${pathname}`).toBe(true);
    }
  });

  test('nenhum destino de menu se repete (nem por pathname)', () => {
    for (const [nome, permissoes] of Object.entries(PERSONAS)) {
      authState.user = {
        uid: 'u-1', role: 'admin', is_super_admin: false, empresa_id: 'e-1',
        effective_permissions: permissoes,
      };
      const { unmount } = renderSidebar();
      const pathnames = destinosVisiveis().map((d) => d.split('?')[0]);
      const repetidos = pathnames.filter((p, i) => pathnames.indexOf(p) !== i);
      expect(repetidos, `${nome} tem destino repetido: ${repetidos.join(', ')}`).toHaveLength(0);
      unmount();
    }
  });
});

describe('coerência permissão × visibilidade', () => {
  test('item visível para uma persona nunca é guardado por permissão que ela não tem', () => {
    const rotas = rotasDeclaradas();
    for (const [nome, permissoes] of Object.entries(PERSONAS)) {
      authState.user = {
        uid: 'u-1', role: 'operador', is_super_admin: false, empresa_id: 'e-1',
        effective_permissions: permissoes,
      };
      const { unmount } = renderSidebar();
      for (const destino of destinosVisiveis()) {
        const guarda = rotas.get(destino.split('?')[0]);
        if (!guarda) continue;
        expect(
          permissoes[guarda] === true,
          `${nome}: menu mostra ${destino}, mas a rota exige "${guarda}" — item visível que sempre daria acesso restrito`,
        ).toBe(true);
      }
      unmount();
    }
  });

  test('persona sem permissão nenhuma não vê áreas privilegiadas', () => {
    authState.user = {
      uid: 'u-1', role: 'motorista', is_super_admin: false, empresa_id: 'e-1',
      effective_permissions: PERSONAS.Motorista,
    };
    renderSidebar();
    const destinos = destinosVisiveis();
    for (const proibido of [
      '/perfis-permissoes', '/admins', '/frota', '/rede-parceiros',
      '/minhas-faturas', '/relatorios/rentabilidade', '/relatorios/acerto-motoristas',
      '/solicitacoes-embarcadores', '/campanhas-escoamento', '/relatorios/torre-controle',
    ]) {
      expect(destinos, `motorista não deveria ver ${proibido}`).not.toContain(proibido);
    }
  });

  test('super-admin não recebe o menu do cliente e vice-versa', () => {
    authState.user = { uid: 's-1', role: 'admin', is_super_admin: true };
    const { unmount } = renderSidebar();
    const destinosSuper = destinosVisiveis();
    expect(destinosSuper).not.toContain('/minhas-faturas');
    expect(destinosSuper.some((d) => d.startsWith('/painel-administrativo/'))).toBe(true);
    unmount();

    authState.user = {
      uid: 'u-1', role: 'admin', is_super_admin: false, empresa_id: 'e-1',
      effective_permissions: PERSONAS.Administrador,
    };
    renderSidebar();
    const destinosCliente = destinosVisiveis();
    expect(destinosCliente.some((d) => d.startsWith('/painel-administrativo/'))).toBe(false);
    expect(destinosCliente).toContain('/minhas-faturas');
  });
});

describe('regra de active state', () => {
  test('itens que são prefixo de outros declaram `end` (senão o pai acende junto)', () => {
    authState.user = {
      uid: 'u-1', role: 'admin', is_super_admin: false, empresa_id: 'e-1',
      effective_permissions: PERSONAS.Administrador,
    };
    // `/relatorios` é prefixo de `/relatorios/viagens`: navegar ao filho não pode
    // acender o pai. Sem `end`, acenderia — a mesma família do REG-001.
    const { unmount } = renderSidebar('/relatorios/viagens');
    const ativos = Array.from(document.querySelectorAll('a'))
      .filter((a) => a.className.includes('bg-green-700'))
      .map((a) => a.getAttribute('href'));
    expect(ativos).toEqual(['/relatorios/viagens']);
    unmount();
  });
});
