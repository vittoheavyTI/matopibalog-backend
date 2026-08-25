import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Regressão dos achados da aceitação visual (VIS-01..VIS-14).
//
// Cada teste aqui existe porque um defeito concreto passou despercebido em
// revisão de código — o JSX "parecia" certo. O que se verifica é o COMPORTAMENTO
// observável, não a classe CSS: asserção sobre string de className foi
// exatamente o que deixou o VIS-01 passar (o destaque estava escrito e não
// pintava). As provas que dependem de CSS real rodam no harness visual
// (`tests-qa-portal/checks.visual.spec.ts`), com `getComputedStyle` em navegador.

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
import PortalLogin from './PortalLogin';
import { PortalAuthProvider } from './PortalAuthContext';
import { TOM_POR_SITUACAO } from './PortalUI';
import { diferencasEntreEnvios } from '../shared/comparacaoEnvios';

const clicar = (el: HTMLElement) => fireEvent.click(el);

const CONTEXTO = {
  usuario: { id: 'u1', nome: 'Contato X', email: 'x@e.test' },
  embarcador: { id: 'org-x', nome: 'Fazendas X' },
  transportadoras: [{ relationship_id: 'rel-1', nome: 'Transportadora A' }],
};

function operacaoParcial(over: Record<string, unknown> = {}) {
  return {
    request_id: 'req-parcial', reference_code: 'SOL-PARCIAL', cargo_name: 'Soja',
    destination_name: 'Porto de Itaqui', quantity_unit: 'ton', total_quantidade: 1200,
    window_start: null, window_end: null,
    status_externo: 'PARCIALMENTE_ENTREGUE', status_rotulo: 'Entrega parcial',
    comprovante_disponivel: false, tem_operacao: true,
    proxima_acao: { rotulo: 'Acompanhar operação', tipo: 'ACOMPANHAR', request_id: 'req-parcial' },
    atualizado_em: '2026-01-02T00:00:00Z', ...over,
  };
}

function comProvider(ui: React.ReactNode) {
  return render(
    <MemoryRouter><PortalAuthProvider>{ui}</PortalAuthProvider></MemoryRouter>,
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  localStorage.setItem('matopibalog_portal_token', 'token-fake');
});
afterEach(() => { localStorage.clear(); });

// ---------------------------------------------------------------------------

describe('VIS-03 · entrega parcial continua visível', () => {
  it('aparece no início, e não cai no "nenhuma ação é necessária"', async () => {
    get.mockImplementation((url: string) => {
      if (url.includes('/contexto')) return Promise.resolve({ data: CONTEXTO });
      return Promise.resolve({
        data: {
          precisam_atencao: [],
          em_andamento: [operacaoParcial()],
          comprovantes_disponiveis: [],
          contadores: { precisam_atencao: 0, em_andamento: 1, comprovantes_disponiveis: 0, total: 1 },
        },
      });
    });
    comProvider(<PortalInicio />);

    expect(await screen.findByText(/SOL-PARCIAL/)).toBeInTheDocument();
    // A frase que aparecia com metade da carga por entregar.
    expect(screen.queryByText(/nenhuma ação é necessária/i)).not.toBeInTheDocument();
    expect(screen.getByText(/parte da carga ainda está a caminho/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /acompanhar operação/i })).toBeInTheDocument();
  });

  it('aparece na aba Transportes', async () => {
    get.mockImplementation((url: string) => {
      if (url.includes('/contexto')) return Promise.resolve({ data: CONTEXTO });
      return Promise.resolve({ data: { itens: [operacaoParcial()] } });
    });
    comProvider(<PortalLista modo="transportes" />);
    expect(await screen.findByText(/SOL-PARCIAL/)).toBeInTheDocument();
  });
});

describe('VIS-10 · Pedidos e Transportes não duplicam o mesmo item', () => {
  const itens = [
    operacaoParcial({
      request_id: 'r-analise', reference_code: 'SOL-ANALISE',
      status_externo: 'EM_ANALISE', status_rotulo: 'Em análise pela transportadora',
      tem_operacao: false,
    }),
    // Aceito, mas sem operação criada ainda (§48): continua sendo pedido.
    operacaoParcial({
      request_id: 'r-aceito', reference_code: 'SOL-ACEITO',
      status_externo: 'ACEITA', status_rotulo: 'Pedido aceito', tem_operacao: false,
    }),
    operacaoParcial({ request_id: 'r-transp', reference_code: 'SOL-TRANSP', tem_operacao: true }),
  ];

  function montar(modo: 'pedidos' | 'transportes') {
    get.mockImplementation((url: string) => {
      if (url.includes('/contexto')) return Promise.resolve({ data: CONTEXTO });
      return Promise.resolve({ data: { itens } });
    });
    return comProvider(<PortalLista modo={modo} />);
  }

  it('Pedidos mostra o que ainda não virou operação, incluindo o aceito sem operação', async () => {
    montar('pedidos');
    expect(await screen.findByText(/SOL-ANALISE/)).toBeInTheDocument();
    expect(screen.getByText(/SOL-ACEITO/)).toBeInTheDocument();
    expect(screen.queryByText(/SOL-TRANSP/)).not.toBeInTheDocument();
  });

  it('Transportes mostra só o que tem operação de verdade', async () => {
    montar('transportes');
    expect(await screen.findByText(/SOL-TRANSP/)).toBeInTheDocument();
    expect(screen.queryByText(/SOL-ANALISE/)).not.toBeInTheDocument();
    expect(screen.queryByText(/SOL-ACEITO/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------

describe('Detalhe do pedido', () => {
  type Doc = {
    id: string; origem: string; nome: string; descricao: string | null;
    enviado_em: string; mime_type?: string | null;
  };
  type Docs = { enviados_por_mim: Doc[]; da_transportadora: Doc[]; comprovantes: Doc[] };

  const semDocs: Docs = { enviados_por_mim: [], da_transportadora: [], comprovantes: [] };

  const detalheBase = {
    request_id: 'req-1', reference_code: 'SOL-1', cargo_name: 'Soja',
    destination_name: 'Porto de Itaqui', quantity_unit: 'ton',
    origens: [{ nome: 'Fazenda 1', quantidade: 1200 }],
    total_quantidade: 1200, window_start: null, window_end: null, notes: null,
    status_externo: 'PARCIALMENTE_ENTREGUE', status_rotulo: 'Entrega parcial',
    motivo_transportadora: null, versao_atual: 1, revisoes: 0,
    comprovante_disponivel: false, entrega: null,
    proxima_acao: { rotulo: 'Acompanhar operação', tipo: 'ACOMPANHAR' },
    linha_do_tempo: [], atualizado_em: '2026-01-02T00:00:00Z',
  };

  function montar(over: Record<string, unknown> = {}, docs: Docs = semDocs, rota = '/portal/embarcador/pedidos/req-1') {
    get.mockImplementation((url: string) => {
      if (url.includes('/contexto')) return Promise.resolve({ data: CONTEXTO });
      if (url.includes('/documentos')) return Promise.resolve({ data: docs });
      if (url.includes('/historico')) return Promise.resolve({ data: { itens: [] } });
      return Promise.resolve({ data: { ...detalheBase, ...over } });
    });
    return render(
      <MemoryRouter initialEntries={[rota]}>
        <PortalAuthProvider>
          <Routes>
            <Route path="/portal/embarcador/pedidos/:id" element={<PortalOperacao />} />
          </Routes>
        </PortalAuthProvider>
      </MemoryRouter>,
    );
  }

  it('VIS-02 · mostra quanto já foi entregue e quanto ainda falta', async () => {
    montar({ entrega: { unidade: 'ton', solicitado: 1200, entregue: 500, restante: 700, concluida: false } });
    expect(await screen.findByText('Já entregue')).toBeInTheDocument();
    expect(screen.getByText('Ainda falta')).toBeInTheDocument();
    expect(screen.getByText('500 t')).toBeInTheDocument();
    expect(screen.getByText('700 t')).toBeInTheDocument();
  });

  it('VIS-02 · sem dado do backend não inventa número nenhum', async () => {
    montar({ entrega: null });
    await screen.findByText(/Resumo/);
    expect(screen.queryByText('Já entregue')).not.toBeInTheDocument();
    expect(screen.queryByText('Ainda falta')).not.toBeInTheDocument();
  });

  it('VIS-05 · confirma o envio e diz o que acontece depois', async () => {
    montar(
      { status_externo: 'EM_ANALISE', status_rotulo: 'Em análise pela transportadora' },
      semDocs,
      '/portal/embarcador/pedidos/req-1?enviada=1',
    );
    expect(await screen.findByText(/pedido enviado com sucesso/i)).toBeInTheDocument();
    expect(screen.getByText(/vai analisar sua solicitação/i)).toBeInTheDocument();
  });

  it('VIS-05 · sem o parâmetro de envio, nenhuma confirmação aparece', async () => {
    montar({ status_externo: 'EM_ANALISE', status_rotulo: 'Em análise pela transportadora' });
    await screen.findByText(/Resumo/);
    expect(screen.queryByText(/pedido enviado com sucesso/i)).not.toBeInTheDocument();
  });

  it('VIS-07 · o seletor de arquivo é português e não o controle nativo', async () => {
    montar();
    // O rótulo visível é nosso; o input nativo continua existindo, acessível,
    // mas sem o texto "Choose File" que vinha do navegador.
    expect(await screen.findByText('Escolher arquivo')).toBeInTheDocument();
    expect(screen.getByText('Nenhum arquivo selecionado')).toBeInTheDocument();
    const input = document.getElementById('novo-doc') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.type).toBe('file');
    expect(input.className).toContain('sr-only');
  });

  it('VIS-08 · abrir documento mostra pré-visualização em vez de nova aba', async () => {
    const abrirJanela = vi.spyOn(window, 'open').mockImplementation(() => null);
    montar({}, {
      enviados_por_mim: [],
      da_transportadora: [],
      comprovantes: [{
        id: 'share-1', origem: 'COMPROVANTE', nome: 'Canhoto.jpg',
        descricao: null, enviado_em: '2026-01-06T00:00:00Z', mime_type: 'image/jpeg',
      }],
    });
    const botao = await screen.findByRole('button', { name: /ver comprovante/i });
    get.mockImplementation((url: string) => {
      if (url.includes('/url')) {
        return Promise.resolve({ data: { url: 'https://signed/x', mime_type: 'image/jpeg' } });
      }
      return Promise.resolve({ data: CONTEXTO });
    });
    clicar(botao);
    expect(await screen.findByRole('dialog', { name: /visualizar arquivo/i })).toBeInTheDocument();
    expect(abrirJanela).not.toHaveBeenCalled();
    abrirJanela.mockRestore();
  });
});

// ---------------------------------------------------------------------------

describe('VIS-09 · o embarcador vê o que mudou entre os envios', () => {
  it('descreve as diferenças em linguagem de negócio, na direção certa', () => {
    const v1 = {
      versao: 1, cargo_name: 'Milho', destination_name: 'Balsas', quantity_unit: 'ton',
      total_quantidade: 850, origens: [{ nome: 'Fazenda A', quantidade: 350 }],
    };
    const v2 = {
      versao: 2, cargo_name: 'Milho', destination_name: 'Balsas', quantity_unit: 'ton',
      total_quantidade: 800, origens: [{ nome: 'Fazenda A', quantidade: 300 }],
    };
    const mudancas = diferencasEntreEnvios(v1, v2);
    // Direção importa: quem reduziu 850 → 800 não pode ler "aumentou".
    expect(mudancas).toContain('Quantidade total: 850 t → 800 t');
    expect(mudancas).toContain('Fazenda A: 350 t → 300 t');
    // Nenhum nome de campo do banco vaza para a tela.
    for (const m of mudancas) {
      expect(m).not.toMatch(/total_quantidade|cargo_name|destination_name|quantity_unit/);
    }
  });

  it('sem par para comparar, não inventa diferença', () => {
    expect(diferencasEntreEnvios(null, { versao: 1, origens: [] })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('VIS-06 · mapa de tons das situações', () => {
  it('entrega parcial é atenção, e não se confunde com cancelada', () => {
    expect(TOM_POR_SITUACAO.PARCIALMENTE_ENTREGUE).toBe('atencao');
    expect(TOM_POR_SITUACAO.CANCELADA).toBe('encerrado');
    expect(TOM_POR_SITUACAO.PARCIALMENTE_ENTREGUE).not.toBe(TOM_POR_SITUACAO.CANCELADA);
  });

  it('estados em curso não usam o tom de encerrado', () => {
    for (const codigo of ['EM_ANALISE', 'ACEITA', 'EM_PLANEJAMENTO', 'AGENDADA', 'EM_TRANSPORTE']) {
      expect(TOM_POR_SITUACAO[codigo]).toBe('informacao');
    }
  });

  it('desfechos têm tons distintos entre si', () => {
    expect(TOM_POR_SITUACAO.ENTREGUE).toBe('sucesso');
    expect(TOM_POR_SITUACAO.COMPROVANTE_DISPONIVEL).toBe('sucesso');
    expect(TOM_POR_SITUACAO.RECUSADA).toBe('erro');
    expect(TOM_POR_SITUACAO.AJUSTES_SOLICITADOS).toBe('atencao');
  });
});

// ---------------------------------------------------------------------------

describe('VIS-12 · mostrar/ocultar senha', () => {
  it('alterna o tipo do campo e anuncia o estado', async () => {
    get.mockImplementation(() => Promise.reject({ response: { status: 401 } }));
    localStorage.clear();
    render(<MemoryRouter><PortalAuthProvider><PortalLogin /></PortalAuthProvider></MemoryRouter>);

    const senha = await screen.findByLabelText('Senha') as HTMLInputElement;
    expect(senha.type).toBe('password');

    const alternar = screen.getByRole('button', { name: /mostrar senha/i });
    expect(alternar).toHaveAttribute('aria-pressed', 'false');
    clicar(alternar);

    expect((screen.getByLabelText('Senha') as HTMLInputElement).type).toBe('text');
    expect(screen.getByRole('button', { name: /ocultar senha/i })).toHaveAttribute('aria-pressed', 'true');
  });
});

// ---------------------------------------------------------------------------

describe('VIS-13 · foco de teclado visível', () => {
  it('a ação primária declara estilo de foco próprio', async () => {
    get.mockImplementation(() => Promise.reject({ response: { status: 401 } }));
    localStorage.clear();
    render(<MemoryRouter><PortalAuthProvider><PortalLogin /></PortalAuthProvider></MemoryRouter>);
    const entrar = await screen.findByRole('button', { name: /entrar/i });
    // O anel padrão do navegador some contra o verde escuro; o estilo próprio
    // precisa estar declarado, não herdado.
    expect(entrar.className).toMatch(/focus-visible:ring/);
  });
});
