import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Testes do Portal do Embarcador (web).
//
// O que estes testes protegem é o produto, não só o código: que o embarcador
// entenda o que fazer sem saber o que é Campaign/Dispatch/ePOD, que uma correção
// não recomece do zero, e que a tela nunca fique em branco.

const get = vi.fn();
const post = vi.fn();

vi.mock('./portalApi', async () => {
  const real = await vi.importActual<typeof import('./portalApi')>('./portalApi');
  return {
    ...real,
    default: {
      get: (...args: unknown[]) => get(...args),
      post: (...args: unknown[]) => post(...args),
    },
  };
});

import PortalInicio from './PortalInicio';
import PortalLista from './PortalLista';
import PortalOperacao from './PortalOperacao';
import PortalNovaSolicitacao from './PortalNovaSolicitacao';
import { PortalAuthProvider } from './PortalAuthContext';

const clicar = (el: HTMLElement) => fireEvent.click(el);
const digitar = (el: HTMLElement, valor: string) => fireEvent.change(el, { target: { value: valor } });

const CONTEXTO = {
  usuario: { id: 'u1', nome: 'Contato X', email: 'x@e.test' },
  embarcador: { id: 'org-x', nome: 'Fazendas X' },
  transportadoras: [{ relationship_id: 'rel-1', nome: 'Transportadora A' }],
};

function operacao(over: Record<string, unknown> = {}) {
  return {
    request_id: 'req-1', reference_code: 'SOL-1', cargo_name: 'Soja',
    destination_name: 'Porto de Itaqui', quantity_unit: 'ton', total_quantidade: 120,
    window_start: null, window_end: null,
    status_externo: 'EM_ANALISE', status_rotulo: 'Em análise pela transportadora',
    comprovante_disponivel: false,
    proxima_acao: { rotulo: 'No momento, nenhuma ação é necessária.', tipo: 'NENHUMA' },
    atualizado_em: '2026-01-02T00:00:00Z', ...over,
  };
}

function comProvider(ui: React.ReactNode) {
  return render(
    <MemoryRouter>
      <PortalAuthProvider>{ui}</PortalAuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  localStorage.setItem('matopibalog_portal_token', 'token-fake');
});

afterEach(() => { localStorage.clear(); });

describe('Início do portal', () => {
  it('estado vazio explica o que fazer, em vez de "nenhum registro"', async () => {
    get.mockImplementation((url: string) => {
      if (url.includes('/contexto')) return Promise.resolve({ data: CONTEXTO });
      return Promise.resolve({
        data: {
          precisam_atencao: [], em_andamento: [], comprovantes_disponiveis: [], recentes: [],
          contadores: { precisam_atencao: 0, em_andamento: 0, comprovantes_disponiveis: 0, total: 0 },
        },
      });
    });
    comProvider(<PortalInicio />);
    expect(await screen.findByText(/ainda não pediu nenhum transporte/i)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /pedir um transporte/i }).length).toBeGreaterThan(0);
  });

  it('erro é acionável: mostra mensagem e botão de tentar novamente', async () => {
    get.mockImplementation((url: string) => {
      if (url.includes('/contexto')) return Promise.resolve({ data: CONTEXTO });
      return Promise.reject({ response: { data: { message: 'Falha ao carregar.' } } });
    });
    comProvider(<PortalInicio />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao carregar.');
    expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
  });

  it('o que precisa de atenção aparece com a ação em português, não com o código do status', async () => {
    get.mockImplementation((url: string) => {
      if (url.includes('/contexto')) return Promise.resolve({ data: CONTEXTO });
      return Promise.resolve({
        data: {
          precisam_atencao: [operacao({
            status_externo: 'AJUSTES_SOLICITADOS', status_rotulo: 'Ajustes solicitados',
            proxima_acao: { rotulo: 'Corrigir', tipo: 'REVISAR' },
          })],
          em_andamento: [], comprovantes_disponiveis: [], recentes: [],
          contadores: { precisam_atencao: 1, em_andamento: 0, comprovantes_disponiveis: 0, total: 1 },
        },
      });
    });
    comProvider(<PortalInicio />);
    expect(await screen.findByText(/precisa da sua atenção/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Corrigir' })).toBeInTheDocument();
    expect(screen.queryByText(/CHANGES_REQUESTED/)).not.toBeInTheDocument();
  });

  it('não expõe conceito interno (Campaign, Dispatch, ePOD) em lugar nenhum da tela', async () => {
    get.mockImplementation((url: string) => {
      if (url.includes('/contexto')) return Promise.resolve({ data: CONTEXTO });
      return Promise.resolve({
        data: {
          precisam_atencao: [operacao({
            status_externo: 'EM_TRANSPORTE', status_rotulo: 'Em transporte', tem_operacao: true,
            proxima_acao: { rotulo: 'Acompanhar operação', tipo: 'ACOMPANHAR' },
          })],
          em_andamento: [operacao()], comprovantes_disponiveis: [], recentes: [],
          contadores: { precisam_atencao: 1, em_andamento: 1, comprovantes_disponiveis: 0, total: 2 },
        },
      });
    });
    const { container } = comProvider(<PortalInicio />);
    await screen.findByText(/precisa da sua atenção/i);
    const texto = container.textContent || '';
    for (const proibido of ['Campaign', 'Campanha', 'Dispatch', 'ePOD', 'EPOD', 'planned_trip', 'empresa_id']) {
      expect(texto).not.toContain(proibido);
    }
  });
});

describe('Lista', () => {
  it('usa cartões e não depende de tabela larga (usável em tela estreita)', async () => {
    get.mockImplementation((url: string) => {
      if (url.includes('/contexto')) return Promise.resolve({ data: CONTEXTO });
      return Promise.resolve({
        data: { itens: [operacao(), operacao({ request_id: 'req-2', reference_code: 'SOL-2' })] },
      });
    });
    const { container } = comProvider(<PortalLista modo="pedidos" />);
    await screen.findByText(/SOL-1/);
    expect(container.querySelector('table')).toBeNull();
  });

  it('separa pedidos ainda em análise de transportes com operação criada', async () => {
    get.mockImplementation((url: string) => {
      if (url.includes('/contexto')) return Promise.resolve({ data: CONTEXTO });
      return Promise.resolve({
        data: {
          itens: [
            operacao({ request_id: 'r-analise', reference_code: 'SOL-ANALISE', status_externo: 'EM_ANALISE' }),
            operacao({
              request_id: 'r-transporte', reference_code: 'SOL-TRANSP',
              status_externo: 'EM_TRANSPORTE', status_rotulo: 'Em transporte', tem_operacao: true,
            }),
          ],
        },
      });
    });
    comProvider(<PortalLista modo="transportes" />);
    expect(await screen.findByText(/SOL-TRANSP/)).toBeInTheDocument();
    expect(screen.queryByText(/SOL-ANALISE/)).not.toBeInTheDocument();
  });

  it('vazio da lista de transportes explica quando algo aparece ali', async () => {
    get.mockImplementation((url: string) => {
      if (url.includes('/contexto')) return Promise.resolve({ data: CONTEXTO });
      return Promise.resolve({ data: { itens: [] } });
    });
    comProvider(<PortalLista modo="transportes" />);
    expect(await screen.findByText(/nenhum transporte em andamento/i)).toBeInTheDocument();
  });
});

describe('Detalhe da operação', () => {
  type Doc = { id: string; origem: string; nome: string; descricao: string | null; enviado_em: string };
  type Docs = { enviados_por_mim: Doc[]; da_transportadora: Doc[]; comprovantes: Doc[] };

  const detalhe = {
    request_id: 'req-1', reference_code: 'SOL-1', cargo_name: 'Soja',
    destination_name: 'Porto de Itaqui', quantity_unit: 'ton',
    origens: [{ nome: 'Fazenda 1', quantidade: 70 }, { nome: 'Fazenda 2', quantidade: 50 }],
    total_quantidade: 120, window_start: null, window_end: null, notes: null,
    status_externo: 'AJUSTES_SOLICITADOS', status_rotulo: 'Ajustes solicitados',
    motivo_transportadora: 'A janela de coleta não é viável.',
    versao_atual: 1, revisoes: 0, comprovante_disponivel: false,
    proxima_acao: { rotulo: 'Corrigir', tipo: 'REVISAR' },
    linha_do_tempo: [{ chave: 'SOLICITACAO_ENVIADA', rotulo: 'Solicitação enviada', em: '2026-01-01T00:00:00Z' }],
    atualizado_em: '2026-01-02T00:00:00Z',
  };
  const semDocs: Docs = { enviados_por_mim: [], da_transportadora: [], comprovantes: [] };

  function montarDetalhe(over: Record<string, unknown> = {}, docs: Docs = semDocs) {
    get.mockImplementation((url: string) => {
      if (url.includes('/contexto')) return Promise.resolve({ data: CONTEXTO });
      if (url.includes('/documentos')) return Promise.resolve({ data: docs });
      if (url.includes('/historico')) return Promise.resolve({ data: { itens: [] } });
      return Promise.resolve({ data: { ...detalhe, ...over } });
    });
    return render(
      <MemoryRouter initialEntries={['/portal/embarcador/operacoes/req-1']}>
        <PortalAuthProvider>
          <Routes>
            <Route path="/portal/embarcador/operacoes/:id" element={<PortalOperacao />} />
          </Routes>
        </PortalAuthProvider>
      </MemoryRouter>,
    );
  }

  it('mostra o motivo da transportadora junto do botão de correção', async () => {
    montarDetalhe();
    expect(await screen.findByText('A janela de coleta não é viável.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Corrigir pedido' })).toBeInTheDocument();
  });

  it('a correção abre JÁ PREENCHIDA com o que foi enviado antes', async () => {
    montarDetalhe();
    clicar(await screen.findByRole('button', { name: 'Corrigir pedido' }));
    // Corrigir não é recomeçar: os valores anteriores estão lá.
    expect(await screen.findByDisplayValue('Soja')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Fazenda 1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('70')).toBeInTheDocument();
    // E o motivo continua visível enquanto se corrige.
    expect(screen.getByText('A janela de coleta não é viável.')).toBeInTheDocument();
  });

  it('o reenvio manda a versão que a tela estava exibindo', async () => {
    post.mockResolvedValue({ data: {} });
    montarDetalhe();
    clicar(await screen.findByRole('button', { name: 'Corrigir pedido' }));
    clicar(await screen.findByRole('button', { name: 'Enviar correção' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [url, corpo] = post.mock.calls[0];
    expect(String(url)).toContain('/revisar');
    expect((corpo as { expected_version: number }).expected_version).toBe(1);
  });

  it('comprovante disponível abre em pré-visualização, sem sair da tela', async () => {
    montarDetalhe(
      {
        status_externo: 'COMPROVANTE_DISPONIVEL', status_rotulo: 'Comprovante disponível',
        motivo_transportadora: null, comprovante_disponivel: true,
        proxima_acao: { rotulo: 'Ver comprovante', tipo: 'VER_COMPROVANTE' },
      },
      {
        enviados_por_mim: [], da_transportadora: [],
        comprovantes: [{ id: 'share-1', origem: 'COMPROVANTE', nome: 'Comprovante de entrega', descricao: null, enviado_em: '2026-01-06T00:00:00Z' }],
      },
    );
    const botao = await screen.findByRole('button', { name: /ver comprovante/i });
    get.mockImplementation((url: string) => {
      if (url.includes('/url')) return Promise.resolve({ data: { url: 'https://signed/x', expira_em_segundos: 300 } });
      return Promise.resolve({ data: CONTEXTO });
    });
    clicar(botao);
    // Pré-visualização embutida (VIS-08): o comprovante aparece na própria
    // tela, em vez de virar um download que a pessoa abre em outro programa.
    expect(await screen.findByRole('dialog', { name: /visualizar arquivo/i })).toBeInTheDocument();
  });

  it('falha ao abrir arquivo vira mensagem acionável, não exceção crua', async () => {
    montarDetalhe(
      { motivo_transportadora: null },
      {
        enviados_por_mim: [{ id: 'doc-1', origem: 'ENVIADO_POR_MIM', nome: 'Nota.pdf', descricao: null, enviado_em: '2026-01-02T00:00:00Z' }],
        da_transportadora: [], comprovantes: [],
      },
    );
    const botao = await screen.findByRole('button', { name: 'Ver' });
    get.mockImplementation((url: string) => {
      if (url.includes('/url')) return Promise.reject({ response: { data: { message: 'Documento não encontrado.' } } });
      return Promise.resolve({ data: CONTEXTO });
    });
    clicar(botao);
    expect(await screen.findByRole('alert')).toHaveTextContent('Documento não encontrado.');
  });

  it('a linha do tempo mostra marcos em linguagem externa', async () => {
    montarDetalhe({ motivo_transportadora: null });
    expect(await screen.findByText('Solicitação enviada')).toBeInTheDocument();
  });
});

describe('Novo pedido', () => {
  function montarNovo() {
    get.mockImplementation(() => Promise.resolve({ data: CONTEXTO }));
    return render(
      <MemoryRouter initialEntries={['/portal/embarcador/solicitacoes/nova']}>
        <PortalAuthProvider>
          <Routes>
            <Route path="/portal/embarcador/solicitacoes/nova" element={<PortalNovaSolicitacao />} />
            <Route path="/portal/embarcador/operacoes/:id" element={<div>detalhe</div>} />
          </Routes>
        </PortalAuthProvider>
      </MemoryRouter>,
    );
  }

  it('pergunta em linguagem de quem tem carga, não em campos do sistema', async () => {
    montarNovo();
    expect(await screen.findByLabelText(/o que será transportado/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/para onde vai/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^local de coleta 1$/i)).toBeInTheDocument();
  });

  it('multi-origem soma o total sozinho — o usuário nunca redigita', async () => {
    montarNovo();
    digitar(await screen.findByLabelText(/^local de coleta 1$/i), 'Fazenda A');
    digitar(screen.getByLabelText(/^quantidade$/i), '70');
    clicar(screen.getByRole('button', { name: /adicionar outro local/i }));
    digitar(await screen.findByLabelText(/^local de coleta 2$/i), 'Fazenda B');
    const quantidades = screen.getAllByLabelText(/^quantidade$/i);
    digitar(quantidades[1], '50');
    expect(screen.getByText(/^Total:/)).toHaveTextContent('120');
  });

  it('exige conferência antes de enviar, e reusa o mesmo identificador em retentativas', async () => {
    montarNovo();
    digitar(await screen.findByLabelText(/o que será transportado/i), 'Soja');
    digitar(screen.getByLabelText(/para onde vai/i), 'Porto');
    digitar(screen.getByLabelText(/^local de coleta 1$/i), 'Fazenda A');
    digitar(screen.getByLabelText(/^quantidade$/i), '70');
    clicar(screen.getByRole('button', { name: /conferir pedido/i }));
    expect(await screen.findByText(/confira antes de enviar/i)).toBeInTheDocument();

    // Primeira tentativa falha; a segunda precisa reusar o MESMO
    // client_request_id, senão o retry criaria uma segunda solicitação.
    post.mockRejectedValueOnce({ response: { data: { message: 'Falha temporária.' } } });
    clicar(screen.getByRole('button', { name: /enviar pedido/i }));
    await screen.findByRole('alert');
    clicar(screen.getByRole('button', { name: /conferir pedido/i }));
    post.mockResolvedValueOnce({ data: { id: 'req-novo' } });
    clicar(await screen.findByRole('button', { name: /enviar pedido/i }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    const primeiro = (post.mock.calls[0][1] as { client_request_id: string }).client_request_id;
    const segundo = (post.mock.calls[1][1] as { client_request_id: string }).client_request_id;
    expect(segundo).toBe(primeiro);
  });

  it('recusa quantidade zero antes de chegar ao servidor', async () => {
    montarNovo();
    digitar(await screen.findByLabelText(/o que será transportado/i), 'Soja');
    digitar(screen.getByLabelText(/para onde vai/i), 'Porto');
    digitar(screen.getByLabelText(/^local de coleta 1$/i), 'Fazenda A');
    digitar(screen.getByLabelText(/^quantidade$/i), '0');
    clicar(screen.getByRole('button', { name: /conferir pedido/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/quantidade/i);
    expect(post).not.toHaveBeenCalled();
  });

  it('a unidade é da solicitação inteira — não há escolha por local', async () => {
    montarNovo();
    await screen.findByLabelText(/o que será transportado/i);
    expect(screen.getAllByLabelText(/unidade das quantidades/i)).toHaveLength(1);
  });
});
