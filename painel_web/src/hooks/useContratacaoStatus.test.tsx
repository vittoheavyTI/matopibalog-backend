import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import {
  useContratacaoStatus, ESTADO_CONTRATACAO_NEUTRO, _resetDedupeContratacao,
} from './useContratacaoStatus';
import api from '../api';

// S1-HIGH-06 — CONTRACT_STATUS_MUST_RESET_WHEN_AUTHORITY_CHANGES.
//
// O `enabled` da rodada anterior apenas deixava de BUSCAR. O estado já carregado
// continuava em memória — então um ator que perdesse `company.settings.manage`
// seguiria vendo banner, badge e CTA de um contrato que ele já não pode tratar.
// E o dedupe, chaveado só por `uid`, podia entregar a resposta de um tenant a
// outro contexto do mesmo usuário.
//
// Estes testes exercitam o hook de verdade num componente, porque o defeito é de
// CICLO DE VIDA: só aparece quando algo muda depois do primeiro render.

vi.mock('../api', () => ({ default: { get: vi.fn() } }));

const authState: { user: Record<string, unknown> | null } = { user: null };
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: authState.user }) }));

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> };

function Sonda({ enabled }: { enabled: boolean }) {
  const estado = useContratacaoStatus({ enabled });
  return (
    <div>
      <span data-testid="pendencia">{String(estado.pendenciaObrigatoria)}</span>
      <span data-testid="plano">{estado.planoId ?? 'null'}</span>
      <span data-testid="dias">{estado.diasRestantes ?? 'null'}</span>
    </div>
  );
}

const RESPOSTA_PENDENTE = {
  pendencia_obrigatoria: true, plano_id: 'plano-A', dias_restantes: 5,
  trial_ativo: true, assinatura_pendente: true,
};

function usuario(uid = 'u-1', empresaId = 'emp-A') {
  return { uid, empresa_id: empresaId, is_super_admin: false, role: 'admin' };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetDedupeContratacao();
  authState.user = usuario();
  mockApi.get.mockResolvedValue({ data: RESPOSTA_PENDENTE });
});

describe('S1-HIGH-06 — perder autoridade zera o estado', () => {
  test('A: enabled true → false volta ao neutro imediatamente', async () => {
    const { rerender } = render(<Sonda enabled />);
    await waitFor(() => expect(screen.getByTestId('pendencia')).toHaveTextContent('true'));
    expect(screen.getByTestId('plano')).toHaveTextContent('plano-A');

    rerender(<Sonda enabled={false} />);

    // Sem esperar requisição nenhuma: o estado já tem de estar neutro.
    expect(screen.getByTestId('pendencia')).toHaveTextContent('false');
    expect(screen.getByTestId('plano')).toHaveTextContent('null');
    expect(screen.getByTestId('dias')).toHaveTextContent('null');
  });

  test('desabilitado não dispara nova requisição', async () => {
    const { rerender } = render(<Sonda enabled />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(1));
    rerender(<Sonda enabled={false} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(mockApi.get).toHaveBeenCalledTimes(1);
  });

  test('sair da sessão (user=null) zera o estado', async () => {
    const { rerender } = render(<Sonda enabled />);
    await waitFor(() => expect(screen.getByTestId('pendencia')).toHaveTextContent('true'));

    authState.user = null;
    rerender(<Sonda enabled />);
    expect(screen.getByTestId('pendencia')).toHaveTextContent('false');
  });

  test('virar super-admin zera o estado (não é persona de contratação)', async () => {
    const { rerender } = render(<Sonda enabled />);
    await waitFor(() => expect(screen.getByTestId('pendencia')).toHaveTextContent('true'));

    authState.user = { ...usuario(), is_super_admin: true };
    rerender(<Sonda enabled />);
    expect(screen.getByTestId('pendencia')).toHaveTextContent('false');
  });

  test('trocar de tenant zera antes de a resposta nova chegar', async () => {
    const { rerender } = render(<Sonda enabled />);
    await waitFor(() => expect(screen.getByTestId('plano')).toHaveTextContent('plano-A'));

    // Nova empresa: enquanto a resposta não vem, o dado da anterior não pode ficar.
    let resolver: (v: unknown) => void = () => {};
    mockApi.get.mockReturnValueOnce(new Promise((res) => { resolver = res; }));
    authState.user = usuario('u-1', 'emp-B');
    rerender(<Sonda enabled />);

    expect(screen.getByTestId('plano')).toHaveTextContent('null');

    await act(async () => {
      resolver({ data: { pendencia_obrigatoria: false, plano_id: 'plano-B' } });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId('plano')).toHaveTextContent('plano-B'));
  });
});

describe('S1-HIGH-06 — resposta obsoleta é ignorada', () => {
  test('C: resposta do tenant A não repopula depois da troca para B', async () => {
    let resolverA: (v: unknown) => void = () => {};
    mockApi.get.mockReturnValueOnce(new Promise((res) => { resolverA = res; }));

    const { rerender } = render(<Sonda enabled />);
    // A requisição de A está em voo; troca de contexto antes de resolver.
    authState.user = usuario('u-1', 'emp-B');
    mockApi.get.mockResolvedValueOnce({ data: { pendencia_obrigatoria: false, plano_id: 'plano-B' } });
    rerender(<Sonda enabled />);
    await waitFor(() => expect(screen.getByTestId('plano')).toHaveTextContent('plano-B'));

    // Só AGORA a resposta antiga chega. Ela não pode vencer o contexto atual.
    await act(async () => {
      resolverA({ data: RESPOSTA_PENDENTE });
      await Promise.resolve();
    });

    expect(screen.getByTestId('plano')).toHaveTextContent('plano-B');
    expect(screen.getByTestId('pendencia')).toHaveTextContent('false');
  });

  test('resposta em voo não repopula depois de perder a autoridade', async () => {
    let resolver: (v: unknown) => void = () => {};
    mockApi.get.mockReturnValueOnce(new Promise((res) => { resolver = res; }));

    const { rerender } = render(<Sonda enabled />);
    rerender(<Sonda enabled={false} />);

    await act(async () => {
      resolver({ data: RESPOSTA_PENDENTE });
      await Promise.resolve();
    });

    expect(screen.getByTestId('pendencia')).toHaveTextContent('false');
  });
});

describe('S1-HIGH-06 — dedupe é por CONTEXTO', () => {
  test('D: três consumidores do mesmo contexto = 1 requisição em voo', async () => {
    render(
      <div>
        <Sonda enabled />
        <Sonda enabled />
        <Sonda enabled />
      </div>,
    );
    await waitFor(() => expect(screen.getAllByTestId('pendencia')[0]).toHaveTextContent('true'));
    expect(mockApi.get).toHaveBeenCalledTimes(1);
  });

  test('E: mesmo uid em empresas diferentes NÃO compartilha a promessa', async () => {
    // Duas montagens em contextos distintos precisam de duas requisições — senão o
    // tenant B receberia a resposta do tenant A.
    const { unmount } = render(<Sonda enabled />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(1));
    unmount();

    authState.user = usuario('u-1', 'emp-B');
    render(<Sonda enabled />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(2));
  });

  test('falha da requisição mantém o estado neutro (fail-open)', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('403'));
    render(<Sonda enabled />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('pendencia')).toHaveTextContent('false');
  });

  test('o estado neutro exportado é de fato todo vazio', () => {
    for (const [chave, valor] of Object.entries(ESTADO_CONTRATACAO_NEUTRO)) {
      expect([false, null], `${chave} deveria ser neutro`).toContain(valor);
    }
  });
});
