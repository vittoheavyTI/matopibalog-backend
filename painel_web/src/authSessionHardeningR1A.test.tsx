import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { SuperAdminRoute } from './components/SuperAdminRoute';
import { usePermissions } from './hooks/usePermissions';

// Mock do módulo api
vi.mock('./api', () => {
  const getFn = vi.fn();
  const postFn = vi.fn();
  return {
    default: {
      get: getFn,
      post: postFn,
    },
    decodificarPayloadJwt: vi.fn(),
  };
});

import api from './api';
const mockApi = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

// Componente para testar usePermissions isolado
function PermissionsTester({ requiredKey, onResult }: { requiredKey: string; onResult: (canVal: boolean) => void }) {
  const { can } = usePermissions();
  React.useEffect(() => {
    onResult(can(requiredKey));
  }, [can, requiredKey, onResult]);
  return <div data-testid="perm-tester">tested</div>;
}

// Componente para testar post-login
function PostLoginTester({ onLoginResult }: { onLoginResult: (res: any) => void }) {
  const { login, user, sessionValidationUnavailable } = useAuth();
  return (
    <div>
      <button
        data-testid="btn-login"
        onClick={async () => {
          try {
            const res = await login();
            onLoginResult({ res, user, sessionValidationUnavailable });
          } catch (e) {
            onLoginResult({ error: e });
          }
        }}
      >
        Entrar
      </button>
      {user && <div data-testid="post-login-user">{user.nome}</div>}
      {sessionValidationUnavailable && <div data-testid="post-login-unavailable">Indisponivel</div>}
    </div>
  );
}

describe('MATOPIBA LOG — AUTH SECURITY REMEDIATION R1A (Frontend Regression Battery)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  // 1. cold restore + /auth/me 500 => NO protected shell.
  test('1. cold restore + /auth/me 500 => NO protected shell, fails closed with retry UX, token preserved', async () => {
    localStorage.setItem('auth_token', 'valid-persisted-token');
    mockApi.get.mockRejectedValueOnce({ response: { status: 500, data: { error: 'Internal Server Error' } } });

    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<ProtectedRoute><div data-testid="protected-shell">PROTECTED SHELL CONTENT</div></ProtectedRoute>} />
            <Route path="/login" element={<div>LOGIN SCREEN</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    // Deve exibir o aviso de validação de sessão indisponível com botões de retry
    const retryBanner = await screen.findByTestId('session-validation-unavailable');
    expect(retryBanner).toBeInTheDocument();

    // Invariante fail-closed: conteúdo protegido NUNCA pode ser renderizado
    expect(screen.queryByTestId('protected-shell')).not.toBeInTheDocument();

    // Token NÃO pode ser destruído por erro de servidor transitório
    expect(localStorage.getItem('auth_token')).toBe('valid-persisted-token');
  });

  // 2. cold restore + /auth/me 429 => NO protected shell.
  test('2. cold restore + /auth/me 429 => NO protected shell, fails closed with retry UX, token preserved', async () => {
    localStorage.setItem('auth_token', 'valid-persisted-token');
    mockApi.get.mockRejectedValueOnce({ response: { status: 429, data: { error: 'Too Many Requests' } } });

    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<ProtectedRoute><div data-testid="protected-shell">PROTECTED SHELL CONTENT</div></ProtectedRoute>} />
            <Route path="/login" element={<div>LOGIN SCREEN</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    const retryBanner = await screen.findByTestId('session-validation-unavailable');
    expect(retryBanner).toBeInTheDocument();
    expect(screen.queryByTestId('protected-shell')).not.toBeInTheDocument();
    expect(localStorage.getItem('auth_token')).toBe('valid-persisted-token');
  });

  // 3. cold restore + network failure => NO protected shell.
  test('3. cold restore + network failure => NO protected shell, fails closed, token preserved', async () => {
    localStorage.setItem('auth_token', 'valid-persisted-token');
    mockApi.get.mockRejectedValueOnce(new Error('Network Error / Offline'));

    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<ProtectedRoute><div data-testid="protected-shell">PROTECTED SHELL CONTENT</div></ProtectedRoute>} />
            <Route path="/login" element={<div>LOGIN SCREEN</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    const retryBanner = await screen.findByTestId('session-validation-unavailable');
    expect(retryBanner).toBeInTheDocument();
    expect(screen.queryByTestId('protected-shell')).not.toBeInTheDocument();
    expect(localStorage.getItem('auth_token')).toBe('valid-persisted-token');
  });

  // 4. cold restore + canonical 401 => credential cleared + login.
  test('4. cold restore + canonical 401 => credential cleared + login', async () => {
    localStorage.setItem('auth_token', 'expired-or-revoked-token');
    mockApi.get.mockRejectedValueOnce({ response: { status: 401, data: { error: 'Unauthorized' } } });

    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<ProtectedRoute><div data-testid="protected-shell">PROTECTED SHELL CONTENT</div></ProtectedRoute>} />
            <Route path="/login" element={<div data-testid="login-screen">LOGIN SCREEN</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    // Deve redirecionar para tela de login
    const loginScreen = await screen.findByTestId('login-screen');
    expect(loginScreen).toBeInTheDocument();
    expect(screen.queryByTestId('protected-shell')).not.toBeInTheDocument();

    // Credencial inválida/revogada DEVE ser removida do localStorage
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  // 5. successful /auth/me => protected UI allowed.
  test('5. successful /auth/me => protected UI allowed', async () => {
    localStorage.setItem('auth_token', 'valid-authenticated-token');
    mockApi.get.mockResolvedValueOnce({
      data: {
        id: 'u-admin-1',
        email: 'gestor@transportadora.com.br',
        nome: 'Gestor Operacional',
        tipo: 'admin',
        status: 'ativo',
        is_super_admin: false,
        senha_temporaria: false,
        termos_pendentes: false,
        effective_permissions: { 'freight.view': true },
      },
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<ProtectedRoute><div data-testid="protected-shell">PROTECTED SHELL CONTENT</div></ProtectedRoute>} />
            <Route path="/login" element={<div>LOGIN SCREEN</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    const protectedShell = await screen.findByTestId('protected-shell');
    expect(protectedShell).toBeInTheDocument();
    expect(screen.queryByTestId('session-validation-unavailable')).not.toBeInTheDocument();
  });

  // 6. missing effective_permissions => UI capability DENIED.
  test('6. missing effective_permissions => UI capability DENIED (MISSING_EFFECTIVE_PERMISSIONS=DENY)', async () => {
    // Caso 1: Usuário é admin com role='admin', mas SEM effective_permissions
    localStorage.setItem('auth_token', 'valid-token');
    mockApi.get.mockResolvedValueOnce({
      data: {
        id: 'u-admin-legado',
        email: 'legado@transportadora.com.br',
        nome: 'Admin Legado',
        tipo: 'admin',
        status: 'ativo',
        is_super_admin: false,
        senha_temporaria: false,
        termos_pendentes: false,
        // effective_permissions ausente!
      },
    });

    let checkResult: boolean | null = null;
    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <PermissionsTester requiredKey="finance.view" onResult={(val) => { checkResult = val; }} />
        </AuthProvider>
      </MemoryRouter>,
    );

    await screen.findByTestId('perm-tester');
    // Deve ser estritamente FALSE! role='admin' não pode conceder permissão sem effective_permissions
    expect(checkResult).toBe(false);
  });

  // 7. stale/local is_super_admin claim without authoritative hydration => SuperAdminRoute denied.
  test('7. stale/local is_super_admin claim without authoritative hydration => SuperAdminRoute denied', async () => {
    // Cenário: Token local existe, mas /auth/me falha (transiente ou 500)
    // Logo, NÃO há hidratação autoritativa de is_super_admin.
    localStorage.setItem('auth_token', 'stale-fake-token');
    mockApi.get.mockRejectedValueOnce({ response: { status: 500 } });

    render(
      <MemoryRouter initialEntries={['/painel-administrativo/visao-geral']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<div data-testid="login-screen">LOGIN SCREEN</div>} />
            <Route
              path="/painel-administrativo/visao-geral"
              element={
                <ProtectedRoute>
                  <SuperAdminRoute>
                    <div data-testid="super-admin-content">SUPER ADMIN SAAS</div>
                  </SuperAdminRoute>
                </ProtectedRoute>
              }
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    // ProtectedRoute barra antes com retry banner, impedindo acesso à rota super-admin
    await screen.findByTestId('session-validation-unavailable');
    expect(screen.queryByTestId('super-admin-content')).not.toBeInTheDocument();
  });

  // 8. post-login /auth/me transient failure => protected app NOT entered.
  test('8. post-login /auth/me transient failure => protected app NOT entered', async () => {
    // Ao tentar post-login, o /auth/login salva o token mas /auth/me falha com 503
    mockApi.get.mockRejectedValueOnce({ response: { status: 503, data: { error: 'Service Unavailable' } } });

    let loginOutcome: any = null;
    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <PostLoginTester onLoginResult={(val) => { loginOutcome = val; }} />
        </AuthProvider>
      </MemoryRouter>,
    );

    const btnLogin = await screen.findByTestId('btn-login');

    await act(async () => {
      btnLogin.click();
    });

    // login() deve retornar null (não User)
    expect(loginOutcome?.res).toBeNull();
    // App protegido NÃO deve ter user hidratado
    expect(screen.queryByTestId('post-login-user')).not.toBeInTheDocument();
    // Validação indisponível deve estar ativa
    expect(screen.getByTestId('post-login-unavailable')).toBeInTheDocument();
  });
});
