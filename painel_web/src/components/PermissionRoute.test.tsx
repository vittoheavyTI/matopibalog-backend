import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PermissionRoute } from './PermissionRoute';

// Mocka o hook de permissões para exercitar o guard sem AuthContext real.
const mockCan = vi.fn();
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ can: mockCan, canAny: () => false, isSuper: false, template: null }),
}));

describe('PermissionRoute', () => {
  test('sem permissão → mostra acesso restrito e NÃO renderiza o filho', () => {
    mockCan.mockReturnValue(false);
    render(<PermissionRoute permission="finance.operational.view"><div>CONTEUDO FINANCEIRO</div></PermissionRoute>);
    expect(screen.getByText(/acesso restrito/i)).toBeInTheDocument();
    expect(screen.queryByText('CONTEUDO FINANCEIRO')).not.toBeInTheDocument();
  });

  test('com permissão → renderiza o filho', () => {
    mockCan.mockReturnValue(true);
    render(<PermissionRoute permission="finance.operational.view"><div>CONTEUDO FINANCEIRO</div></PermissionRoute>);
    expect(screen.getByText('CONTEUDO FINANCEIRO')).toBeInTheDocument();
    expect(screen.queryByText(/acesso restrito/i)).not.toBeInTheDocument();
  });
});
