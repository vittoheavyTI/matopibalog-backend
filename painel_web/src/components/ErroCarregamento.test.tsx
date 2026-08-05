import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErroCarregamento } from './ErroCarregamento';

describe('ErroCarregamento', () => {
  test('mostra a mensagem e o botão de retry', () => {
    render(<ErroCarregamento mensagem="Falha ao carregar X" onTentar={() => {}} />);
    expect(screen.getByText('Falha ao carregar X')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
  });

  test('clicar em "Tentar novamente" chama onTentar', () => {
    const onTentar = vi.fn();
    render(<ErroCarregamento mensagem="Erro" onTentar={onTentar} />);
    fireEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    expect(onTentar).toHaveBeenCalledTimes(1);
  });

  test('usa mensagem padrão quando não informada', () => {
    render(<ErroCarregamento onTentar={() => {}} />);
    expect(screen.getByText(/não foi possível carregar/i)).toBeInTheDocument();
  });
});
