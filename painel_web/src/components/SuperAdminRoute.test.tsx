import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SuperAdminRoute } from './SuperAdminRoute';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '../contexts/AuthContext';

const mockUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>;

function renderProtected() {
  return render(
    <MemoryRouter initialEntries={['/painel-administrativo/visao-geral']}>
      <Routes>
        <Route path="/" element={<div>HOME OPERACIONAL</div>} />
        <Route path="/login" element={<div>LOGIN</div>} />
        <Route
          path="/painel-administrativo/visao-geral"
          element={<SuperAdminRoute><div>SUPER ADMIN SAAS</div></SuperAdminRoute>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SuperAdminRoute', () => {
  test('super-admin acessa a superficie SaaS', () => {
    mockUseAuth.mockReturnValue({ user: { uid: 'u1', is_super_admin: true }, loading: false, login: vi.fn(), logout: vi.fn() });
    renderProtected();
    expect(screen.getByText('SUPER ADMIN SAAS')).toBeInTheDocument();
  });

  test('admin comum permanece sem acesso a superficie SaaS', () => {
    mockUseAuth.mockReturnValue({ user: { uid: 'u2', is_super_admin: false }, loading: false, login: vi.fn(), logout: vi.fn() });
    renderProtected();
    expect(screen.getByText('HOME OPERACIONAL')).toBeInTheDocument();
    expect(screen.queryByText('SUPER ADMIN SAAS')).not.toBeInTheDocument();
  });
});
