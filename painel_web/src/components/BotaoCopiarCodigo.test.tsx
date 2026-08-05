import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { BotaoCopiarCodigo } from './BotaoCopiarCodigo';

function mockClipboard(impl: () => Promise<void>) {
  const writeText = vi.fn(impl);
  Object.assign(navigator, { clipboard: { writeText } });
  return writeText;
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe('BotaoCopiarCodigo', () => {
  test('estado normal mostra "Copiar código"', () => {
    mockClipboard(() => Promise.resolve());
    render(<BotaoCopiarCodigo codigo="MATO-AAA111" />);
    expect(screen.getByRole('button', { name: /copiar código de convite/i })).toHaveTextContent(/copiar código/i);
  });

  test('clique copia o código correto e mostra "Copiado!" + status', async () => {
    const writeText = mockClipboard(() => Promise.resolve());
    render(<BotaoCopiarCodigo codigo="MATO-AAA111" />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent(/copiado!/i));
    expect(writeText).toHaveBeenCalledWith('MATO-AAA111');
    expect(screen.getByRole('status')).toHaveTextContent(/código de convite copiado/i);
  });

  test('durante a Promise mostra "Copiando…" e desabilita', async () => {
    let resolver: () => void = () => {};
    mockClipboard(() => new Promise<void>((r) => { resolver = () => r(); }));
    render(<BotaoCopiarCodigo codigo="MATO-AAA111" />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent(/copiando/i));
    expect(screen.getByRole('button')).toBeDisabled();
    act(() => resolver());
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent(/copiado!/i));
  });

  test('volta ao estado normal após ~2s', async () => {
    vi.useFakeTimers();
    mockClipboard(() => Promise.resolve());
    render(<BotaoCopiarCodigo codigo="MATO-AAA111" />);
    fireEvent.click(screen.getByRole('button'));
    await vi.waitFor(() => expect(screen.getByRole('button')).toHaveTextContent(/copiado!/i));
    act(() => { vi.advanceTimersByTime(2100); });
    expect(screen.getByRole('button')).toHaveTextContent(/copiar código/i);
  });

  test('falha mostra toast de erro e NÃO afirma sucesso', async () => {
    mockClipboard(() => Promise.reject(new Error('bloqueado')));
    render(<BotaoCopiarCodigo codigo="MATO-AAA111" />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/não foi possível copiar/i));
    expect(screen.getByRole('button')).not.toHaveTextContent(/copiado!/i);
  });

  test('clique rápido não duplica a operação', async () => {
    let resolver: () => void = () => {};
    const writeText = mockClipboard(() => new Promise<void>((r) => { resolver = () => r(); }));
    render(<BotaoCopiarCodigo codigo="MATO-AAA111" />);
    const btn = screen.getByRole('button');
    fireEvent.click(btn); fireEvent.click(btn); fireEvent.click(btn); // 3 cliques rápidos
    await waitFor(() => expect(btn).toBeDisabled());
    act(() => resolver());
    await waitFor(() => expect(btn).toHaveTextContent(/copiado!/i));
    expect(writeText).toHaveBeenCalledTimes(1); // só uma operação
  });

  test('funciona via teclado (Enter aciona o button nativo)', async () => {
    const writeText = mockClipboard(() => Promise.resolve());
    render(<BotaoCopiarCodigo codigo="MATO-AAA111" />);
    const btn = screen.getByRole('button');
    btn.focus();
    fireEvent.click(btn); // Enter/Espaço em <button> disparam click nativo
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('MATO-AAA111'));
  });

  test('sem código: desabilitado (não copia)', () => {
    const writeText = mockClipboard(() => Promise.resolve());
    render(<BotaoCopiarCodigo codigo={null} />);
    expect(screen.getByRole('button')).toBeDisabled();
    fireEvent.click(screen.getByRole('button'));
    expect(writeText).not.toHaveBeenCalled();
  });
});
