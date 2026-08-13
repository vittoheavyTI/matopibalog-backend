import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import api from '../api';
import { PainelContratos } from './PainelContratos';

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> };

const listaResp = {
  data: {
    contratos: [
      { contrato_id: 'c1', empresa_id: 'e1', cliente: 'Empresa Alfa', empresa_tipo: 'transportadora', plano_nome: 'Empresa Start', valor_mensal: 299.9, valor_implantacao: 0, status: 'plenamente_assinado', obrigatorio: true, assinado: true, versao: 'v3', hash: 'a'.repeat(64), hash_curto: 'aaaaaaaaaaaa', criado_em: '2026-08-01T10:00:00.000Z', assinado_em: '2026-08-02T12:00:00.000Z' },
      { contrato_id: 'c2', empresa_id: 'e2', cliente: 'Autônomo Beta', empresa_tipo: 'autonomo', plano_nome: 'Autônomo Solo', valor_mensal: 99.9, valor_implantacao: 0, status: 'aguardando_assinatura_cliente', obrigatorio: true, assinado: false, versao: 'v3', hash: 'b'.repeat(64), hash_curto: 'bbbbbbbbbbbb', criado_em: '2026-08-05T10:00:00.000Z', assinado_em: null },
    ],
    resumo: { total: 2, assinados: 1, pendentes: 1, cancelados: 0, obrigatorios_pendentes: 1 },
    total_sem_filtro: 2,
  },
};

const detalheResp = {
  data: {
    contrato_id: 'c1', empresa_id: 'e1', cliente: 'Empresa Alfa', empresa_tipo: 'transportadora', plano_nome: 'Empresa Start',
    valor_mensal: 299.9, valor_implantacao: 0, status: 'plenamente_assinado', obrigatorio: true, assinado: true, versao: 'v3',
    hash: 'a'.repeat(64), hash_curto: 'aaaaaaaaaaaa', criado_em: '2026-08-01T10:00:00.000Z', assinado_em: '2026-08-02T12:00:00.000Z',
    tipo: 'contrato_adesao', proposta_id: 'p1', atualizado_em: null, hash_documento_original: 'a'.repeat(64), hash_assinado: null,
    trial_dias: 14, capacidade_inclusa: 5, preco_motorista_extra: 100,
    snapshot: { plano_nome: 'Empresa Start', valor_mensal: 299.9 },
    documentos: { contrato_assinado_disponivel: true, certificado_disponivel: false },
    signatarios: [{ id: 's1', papel: 'cliente', nome: 'Fulano', status: 'assinado', assinado: true, assinado_em: '2026-08-02T11:00:00.000Z', metodo_assinatura: 'interno_otp', email_mascarado: 'f***@x.com' }],
    eventos: [{ id: 'e1', tipo: 'contrato_criado', detalhe: {}, actor_papel: 'matopiba', criado_em: '2026-08-01T10:00:00.000Z' }],
  },
};

beforeEach(() => { vi.clearAllMocks(); });

describe('PainelContratos (página real, API mockada)', () => {
  test('1. loading é exibido durante a requisição', async () => {
    let resolver: (v: unknown) => void = () => {};
    mockApi.get.mockImplementation(() => new Promise((r) => { resolver = r; }));
    render(<PainelContratos />);
    expect(screen.getByText(/carregando contratos/i)).toBeInTheDocument();
    resolver(listaResp);
    await waitFor(() => expect(screen.queryByText(/carregando contratos/i)).toBeNull());
  });

  test('2. sucesso renderiza contratos e resumo', async () => {
    mockApi.get.mockResolvedValue(listaResp);
    render(<PainelContratos />);
    await waitFor(() => expect(screen.getByText('Empresa Alfa')).toBeInTheDocument());
    expect(screen.getByText('Autônomo Beta')).toBeInTheDocument();
    // resumo: rótulo único (o rótulo "Assinados" colide com a opção do filtro)
    expect(screen.getByText('Obrigatórios pendentes')).toBeInTheDocument();
  });

  test('3. empty state quando lista vazia', async () => {
    mockApi.get.mockResolvedValue({ data: { contratos: [], resumo: { total: 0, assinados: 0, pendentes: 0, cancelados: 0, obrigatorios_pendentes: 0 }, total_sem_filtro: 0 } });
    render(<PainelContratos />);
    await waitFor(() => expect(screen.getByText(/nenhum contrato encontrado/i)).toBeInTheDocument());
  });

  test('4. erro exibe retry e refaz a busca', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('falha'));
    render(<PainelContratos />);
    await waitFor(() => expect(screen.getByText(/não foi possível carregar/i)).toBeInTheDocument());
    mockApi.get.mockResolvedValueOnce(listaResp);
    fireEvent.click(screen.getByText(/tentar novamente/i));
    await waitFor(() => expect(screen.getByText('Empresa Alfa')).toBeInTheDocument());
  });

  test('5. abrir detalhe busca /contratos/:id e mostra snapshot/signatários', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/painel-admin/contratos') return Promise.resolve(listaResp);
      if (url === '/painel-admin/contratos/c1') return Promise.resolve(detalheResp);
      return Promise.resolve({ data: {} });
    });
    render(<PainelContratos />);
    await waitFor(() => expect(screen.getByText('Empresa Alfa')).toBeInTheDocument());
    fireEvent.click(screen.getAllByText('Detalhes')[0]);
    await waitFor(() => expect(screen.getByText(/snapshot comercial congelado/i)).toBeInTheDocument());
    expect(screen.getByText('cliente')).toBeInTheDocument(); // signatário papel
  });

  test('6. migration_pendente mostra aviso amigável', async () => {
    mockApi.get.mockResolvedValue({ data: { contratos: [], resumo: null, migration_pendente: true } });
    render(<PainelContratos />);
    await waitFor(() => expect(screen.getByText(/estrutura comercial ainda não disponível/i)).toBeInTheDocument());
  });
});
