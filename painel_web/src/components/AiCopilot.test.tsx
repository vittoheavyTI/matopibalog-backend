import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AiCopilot } from './AiCopilot';
import api from '../api';

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

beforeEach(() => { vi.clearAllMocks(); });

describe('AiCopilot', () => {
  test('capabilities desabilitado: mostra estado verdadeiro e sem input', async () => {
    mockApi.get.mockResolvedValue({ data: { enabled: false, provider_available: false, read_only: true } });
    render(<AiCopilot />);
    fireEvent.click(screen.getByLabelText('Abrir assistente'));
    await waitFor(() => expect(screen.getByText(/ainda não está habilitado/i)).toBeInTheDocument());
    expect(screen.queryByLabelText('Mensagem para o assistente')).not.toBeInTheDocument();
  });

  test('habilitado: sugestões, pergunta, resposta e evidência', async () => {
    mockApi.get.mockResolvedValue({ data: { enabled: true, provider_available: true, read_only: true, capabilities: [] } });
    mockApi.post.mockResolvedValue({ data: { enabled: true, answer: 'Você tem 3 fretes ativos.', evidence: [{ label: 'Baseado em 3 fretes' }], warnings: [] } });
    render(<AiCopilot />);
    fireEvent.click(screen.getByLabelText('Abrir assistente'));
    await waitFor(() => expect(screen.getByText('Quais fretes precisam de atenção?')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Quais fretes precisam de atenção?'));
    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/ai/chat', expect.objectContaining({ message: 'Quais fretes precisam de atenção?' })));
    await waitFor(() => expect(screen.getByText('Você tem 3 fretes ativos.')).toBeInTheDocument());
    expect(screen.getByText('Baseado em 3 fretes')).toBeInTheDocument();
  });

  test('habilitado: erro de provider mostra mensagem segura', async () => {
    mockApi.get.mockResolvedValue({ data: { enabled: true, provider_available: true, read_only: true } });
    mockApi.post.mockRejectedValue(new Error('boom'));
    render(<AiCopilot />);
    fireEvent.click(screen.getByLabelText('Abrir assistente'));
    await waitFor(() => expect(screen.getByLabelText('Mensagem para o assistente')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Mensagem para o assistente'), { target: { value: 'oi' } });
    fireEvent.click(screen.getByLabelText('Enviar'));
    await waitFor(() => expect(screen.getByText(/indisponível no momento/i)).toBeInTheDocument());
  });

  test('nova conversa limpa as mensagens', async () => {
    mockApi.get.mockResolvedValue({ data: { enabled: true, provider_available: true, read_only: true } });
    mockApi.post.mockResolvedValue({ data: { answer: 'resposta', evidence: [], warnings: [] } });
    render(<AiCopilot />);
    fireEvent.click(screen.getByLabelText('Abrir assistente'));
    await waitFor(() => expect(screen.getByLabelText('Mensagem para o assistente')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Mensagem para o assistente'), { target: { value: 'oi' } });
    fireEvent.click(screen.getByLabelText('Enviar'));
    await waitFor(() => expect(screen.getByText('resposta')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Nova conversa'));
    await waitFor(() => expect(screen.queryByText('resposta')).not.toBeInTheDocument());
  });
});
