import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import api from '../api';
import { PainelFuncionalidades } from './PainelFuncionalidades';

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };

const FUNC = { id: 'f1', codigo: 'feat_um', nome: 'Feat Um', status_ciclo_vida: 'disponivel', modelo_cobranca: 'incluso', ativo: true, visivel_publicamente: false, ordem_exibicao: 0 };
const PLANO = { id: 'p1', nome: 'Plano X', matriz_funcionalidades_versao: 3 };

function mockGet(overrides: Record<string, any> = {}) {
  mockApi.get.mockImplementation((url: string) => {
    if (url === '/painel-admin/funcionalidades') return Promise.resolve({ data: { funcionalidades: [FUNC] } });
    if (url === '/painel-admin/planos') return Promise.resolve({ data: { planos: [PLANO] } });
    if (url === '/painel-admin/funcionalidades-matriz') return Promise.resolve({ data: { matriz: [] } });
    if (url === '/painel-admin/funcionalidades-auditoria') return Promise.resolve({ data: { auditoria: [] } });
    if (url === '/painel-admin/empresas/buscar') return overrides.buscar ? overrides.buscar() : Promise.resolve({ data: { empresas: [], total: 0 } });
    if (url.includes('/entitlements')) return Promise.resolve({ data: { empresa: { nome: 'Empresa Alfa' }, plano_funcionalidades: [], overrides: [] } });
    return Promise.resolve({ data: {} });
  });
}

beforeEach(() => { vi.clearAllMocks(); });

async function irParaMatriz() {
  render(<PainelFuncionalidades />);
  fireEvent.click(screen.getByRole('button', { name: /matriz por plano/i }));
  await waitFor(() => expect(screen.getByText('Plano X')).toBeInTheDocument());
}

describe('PainelFuncionalidades — matriz (versão esperada + 409)', () => {
  test('exibe a versão atual do plano e publica enviando versoes_esperadas', async () => {
    mockGet();
    mockApi.put.mockResolvedValue({ data: { alterado: true } });
    await irParaMatriz();
    expect(screen.getByText('v3')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'incluida' } });
    fireEvent.click(screen.getByRole('button', { name: /publicar matriz/i }));
    await waitFor(() => expect(mockApi.put).toHaveBeenCalled());
    const [url, body] = mockApi.put.mock.calls[0];
    expect(url).toBe('/painel-admin/funcionalidades-matriz');
    expect(body.versoes_esperadas).toEqual({ p1: 3 });
    expect(body.itens[0]).toMatchObject({ plano_id: 'p1', funcionalidade_id: 'f1', disponibilidade: 'incluida' });
  });

  test('409 → alerta de conflito, rascunho preservado, publish bloqueado, sem sobrescrita', async () => {
    mockGet();
    mockApi.put.mockRejectedValue({ response: { status: 409, data: { plano_id: 'p1', versao_esperada: 3, versao_atual: 5 } } });
    await irParaMatriz();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'incluida' } });
    fireEvent.click(screen.getByRole('button', { name: /publicar matriz/i }));
    // alerta de conflito com versões
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent(/alterada por outro administrador/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/3/);
    expect(screen.getByRole('alert')).toHaveTextContent(/5/);
    // rascunho preservado (a célula continua no valor escolhido)
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('incluida');
    // publish bloqueado (não reenvia com versão obsoleta)
    expect(screen.getByRole('button', { name: /publicar matriz/i })).toBeDisabled();
    // apenas 1 PUT ocorreu (sem sobrescrita silenciosa)
    expect(mockApi.put).toHaveBeenCalledTimes(1);
  });

  test('409 → "Recarregar" refaz o carregamento e limpa o conflito', async () => {
    mockGet();
    mockApi.put.mockRejectedValue({ response: { status: 409, data: { plano_id: 'p1', versao_esperada: 3, versao_atual: 5 } } });
    await irParaMatriz();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'incluida' } });
    fireEvent.click(screen.getByRole('button', { name: /publicar matriz/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    const getsAntes = mockApi.get.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /recarregar matriz atual/i }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(mockApi.get.mock.calls.length).toBeGreaterThan(getsAntes);
  });
});

describe('PainelFuncionalidades — busca de clientes', () => {
  test('termo curto (<2) não busca; ≥2 busca (debounce) e lista resultados', async () => {
    mockGet({ buscar: () => Promise.resolve({ data: { empresas: [{ id: 'e1', nome: 'Alfa Transportes', documento: '12345678000190', email: 'a@x.com', status: 'ativa', arquivada: false, plano_nome: 'Plano X' }], total: 1 } }) });
    render(<PainelFuncionalidades />);
    fireEvent.click(screen.getByRole('button', { name: /clientes/i }));
    const input = screen.getByLabelText(/buscar cliente/i);
    fireEvent.change(input, { target: { value: 'a' } });         // curto → não busca
    await new Promise((r) => setTimeout(r, 400));
    expect(mockApi.get).not.toHaveBeenCalledWith('/painel-admin/empresas/buscar', expect.anything());
    fireEvent.change(input, { target: { value: 'alfa' } });      // ≥2 → busca
    await waitFor(() => expect(screen.getByText('Alfa Transportes')).toBeInTheDocument());
    expect(mockApi.get).toHaveBeenCalledWith('/painel-admin/empresas/buscar', expect.objectContaining({ params: expect.objectContaining({ q: 'alfa' }) }));
  });

  test('selecionar empresa busca entitlements (somente após seleção)', async () => {
    mockGet({ buscar: () => Promise.resolve({ data: { empresas: [{ id: 'e1', nome: 'Alfa Transportes', status: 'ativa' }], total: 1 } }) });
    render(<PainelFuncionalidades />);
    fireEvent.click(screen.getByRole('button', { name: /clientes/i }));
    fireEvent.change(screen.getByLabelText(/buscar cliente/i), { target: { value: 'alfa' } });
    await waitFor(() => expect(screen.getByText('Alfa Transportes')).toBeInTheDocument());
    expect(mockApi.get).not.toHaveBeenCalledWith(expect.stringContaining('/entitlements'));
    fireEvent.click(screen.getByText('Alfa Transportes'));
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/painel-admin/empresas/e1/entitlements'));
  });
});

describe('PainelFuncionalidades — catálogo (confirmação de arquivamento)', () => {
  const mockApiPost = api as unknown as { post: ReturnType<typeof vi.fn> };
  test('arquivar exige confirmação; só posta após confirmar', async () => {
    mockGet();
    mockApiPost.post.mockResolvedValue({ data: {} });
    render(<PainelFuncionalidades />);              // aba catálogo é a default
    await waitFor(() => expect(screen.getByText('Feat Um')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Arquivar'));
    const dialog = screen.getByRole('dialog');                // confirmação aberta
    expect(mockApiPost.post).not.toHaveBeenCalled();          // ainda não postou
    fireEvent.click(within(dialog).getByRole('button', { name: /^arquivar$/i }));
    await waitFor(() => expect(mockApiPost.post).toHaveBeenCalledWith('/painel-admin/funcionalidades/f1/arquivar', { arquivar: true }));
  });
});

describe('PainelFuncionalidades — auditoria (modal before/after/diff)', () => {
  test('abre modal com diff e versões formatados', async () => {
    const evento = {
      id: 'a1', entidade: 'plano_funcionalidade', acao: 'publicar', origem: 'painel_admin', request_id: 'req-9',
      ator_id: 'u-super', criado_em: new Date().toISOString(),
      detalhe: { celulas_alteradas: 1, versao_anterior: { p1: 1 }, versao_nova: { p1: 2 }, motivo: 'ajuste',
        diff: [{ plano_id: 'p1', funcionalidade_id: 'f1', antes: null, depois: { disponibilidade: 'incluida' } }] },
    };
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/painel-admin/funcionalidades-auditoria') return Promise.resolve({ data: { auditoria: [evento] } });
      return Promise.resolve({ data: {} });
    });
    render(<PainelFuncionalidades />);
    fireEvent.click(screen.getByRole('button', { name: /auditoria/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /ver detalhe/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /ver detalhe/i }));
    const modal = await screen.findByRole('dialog');
    expect(modal).toHaveTextContent(/before → after|Alterações/i);
    expect(modal).toHaveTextContent(/req-9/);
    expect(modal).toHaveTextContent(/incluida/);
    expect(modal).toHaveTextContent(/ajuste/);
  });
});
