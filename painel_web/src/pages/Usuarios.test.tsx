import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  avaliarErroResposta: vi.fn(() => ({ sessaoExpirada: false, rateLimited: false })),
  newClientRequestId: () => 'test-id',
}));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'admin1', is_super_admin: true } }),
}));

import api from '../api';
import { Usuarios } from './Usuarios';

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> };
const usuario = { id: 'u1', nome: 'Fulano de Teste', email: 'f@x.com', tipo: 'admin', empresa_id: null, status: 'ativo' };

function setGet(usuariosFactory: () => Promise<any>) {
  mockApi.get.mockImplementation((url: string) => {
    if (url === '/admin/usuarios') return usuariosFactory();
    return Promise.resolve({ data: [] }); // /painel-admin/empresas (seletor)
  });
}
const renderPage = () => render(<MemoryRouter><Usuarios /></MemoryRouter>);
beforeEach(() => { vi.clearAllMocks(); });

describe('Usuarios (página real, API mockada)', () => {
  test('1. durante loading mostra carregando (contadores não são resultado final)', async () => {
    let resolver: (v: any) => void = () => {};
    setGet(() => new Promise((r) => { resolver = r; }));
    renderPage();
    expect(screen.getByText(/carregando usuários/i)).toBeInTheDocument();
    resolver({ data: [usuario] });
    await waitFor(() => expect(screen.queryByText(/carregando usuários/i)).toBeNull());
  });

  test('2. sucesso renderiza usuário', async () => {
    setGet(() => Promise.resolve({ data: [usuario] }));
    renderPage();
    await waitFor(() => expect(screen.getByText('Fulano de Teste')).toBeInTheDocument());
  });

  test('3/4/5. falha encerra loading, mostra erro e NÃO lista vazia silenciosa', async () => {
    setGet(() => Promise.reject({ response: { status: 403 } }));
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument());
    expect(screen.queryByText(/carregando usuários/i)).toBeNull();
    expect(screen.queryByText(/nenhum usuário neste grupo/i)).toBeNull();
  });

  test('6. "Tentar novamente" dispara nova carga', async () => {
    let n = 0;
    setGet(() => { n += 1; return n === 1 ? Promise.reject({ response: { status: 403 } }) : Promise.resolve({ data: [usuario] }); });
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    await waitFor(() => expect(screen.getByText('Fulano de Teste')).toBeInTheDocument());
  });

  test('7. cancelamento no unmount não gera erro/toast', async () => {
    setGet(() => new Promise(() => {}));
    const { unmount } = renderPage();
    expect(screen.getByText(/carregando usuários/i)).toBeInTheDocument();
    expect(() => unmount()).not.toThrow();
  });

  test('8. contadores mostram "—" na falha (nunca 0 falso)', async () => {
    setGet(() => Promise.reject({ response: { status: 403 } }));
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument());
    const todos = screen.getByRole('button', { name: /Todos/ });
    expect(todos.textContent).toContain('—');
    expect(todos.textContent).not.toContain('(0)');
  });

  test('9. contadores mostram número após resposta válida', async () => {
    setGet(() => Promise.resolve({ data: [usuario] }));
    renderPage();
    await waitFor(() => expect(screen.getByText('Fulano de Teste')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Todos/ }).textContent).toContain('(1)');
  });

  // A partir do TEAM_USER_PROVISIONING_V1, `tipo` é classe de conta e vale
  // 'admin' para TODO usuário interno (D-069). Se a lista continuasse derivando o
  // rótulo de `tipo`, um Operador apareceria como "Administrador" — exatamente a
  // confusão que a frente veio eliminar. A autoridade exibida é o perfil.
  test('10. a lista mostra o PERFIL DE ACESSO, não a classe da conta', async () => {
    const operador = { ...usuario, id: 'u2', nome: 'Operadora Teste', tipo: 'admin', perfil_acesso_nome: 'Operador' };
    setGet(() => Promise.resolve({ data: [operador] }));
    renderPage();
    await waitFor(() => expect(screen.getByText('Operadora Teste')).toBeInTheDocument());
    expect(screen.getByText('Operador')).toBeInTheDocument();
    expect(screen.queryByText('Administrador')).toBeNull();
  });

  test('11. sem perfil atribuído, cai na classe da conta em vez de mostrar vazio', async () => {
    setGet(() => Promise.resolve({ data: [{ ...usuario, perfil_acesso_nome: null }] }));
    renderPage();
    await waitFor(() => expect(screen.getByText('Fulano de Teste')).toBeInTheDocument());
    expect(screen.getByText('Administrador')).toBeInTheDocument();
  });

  // TEAM-UX-001 — a lista de equipe não é lugar de chave técnica de permissão.
  // As chaves abaixo vinham do campo legado `usuarios.permissoes`, que desde a
  // migration 072 nem descreve mais o acesso real: o efetivo vem de template +
  // overrides. Era dado obsoleto com aparência de autoridade.
  test('12. a lista NÃO expõe chaves técnicas de permissão', async () => {
    const comLegado = {
      ...usuario,
      perfil_acesso_nome: 'Operador',
      permissoes: { dashboard: true, motoristas: true, relatorios: true, usuarios: false, configuracoes: true },
    };
    setGet(() => Promise.resolve({ data: [comLegado] }));
    renderPage();
    await waitFor(() => expect(screen.getByText('Fulano de Teste')).toBeInTheDocument());
    for (const chave of ['DASHBOARD', 'MOTORISTAS', 'RELATORIOS', 'CONFIGURACOES', 'USUARIOS']) {
      expect(screen.queryByText(chave)).toBeNull();
    }
    // A informação de acesso da lista é o perfil — e ele continua lá.
    expect(screen.getByText('Operador')).toBeInTheDocument();
  });

  test('13. exceção individual aparece como indicador humano, sem citar chave', async () => {
    setGet(() => Promise.resolve({
      data: [{ ...usuario, perfil_acesso_nome: 'Operador', ajustes_de_acesso: 2 }],
    }));
    renderPage();
    await waitFor(() => expect(screen.getByText('Fulano de Teste')).toBeInTheDocument());
    expect(screen.getByText('2 ajustes de acesso')).toBeInTheDocument();
  });

  test('14. um único ajuste é dito no singular', async () => {
    setGet(() => Promise.resolve({
      data: [{ ...usuario, perfil_acesso_nome: 'Operador', ajustes_de_acesso: 1 }],
    }));
    renderPage();
    await waitFor(() => expect(screen.getByText('Fulano de Teste')).toBeInTheDocument());
    expect(screen.getByText('1 ajuste de acesso')).toBeInTheDocument();
  });

  test('15. sem override, nenhum selo de acesso personalizado', async () => {
    setGet(() => Promise.resolve({
      data: [{ ...usuario, perfil_acesso_nome: 'Operador', ajustes_de_acesso: 0 }],
    }));
    renderPage();
    await waitFor(() => expect(screen.getByText('Fulano de Teste')).toBeInTheDocument());
    expect(screen.queryByText(/ajustes? de acesso/i)).toBeNull();
  });
});
