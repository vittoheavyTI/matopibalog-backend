import { test, expect, type Page } from '@playwright/test';
import * as F from './fixtures';
import {
  instalarFixtures, estabelecerSessao, assentar, caminhoDeSaida, registrar, gravarRegistro,
  DESKTOP, MOBILE, TABLET, type Cenario,
} from './harness';

// Pacote de aceitação visual — LADO TRANSPORTADORA (caixa de entrada interna).

const TOKEN_INTERNO = 'token-fixture-interno-nao-e-real';

// Endpoints que o shell do painel carrega em toda navegação. Respostas mínimas:
// o pacote é sobre o Portal, não sobre o resto do painel.
const SHELL = {
  'GET /ai/capabilities': { enabled: false, provider_available: false, read_only: true },
  'GET /configuracoes': {},
  'GET /configuracoes/empresa': { logomarca: null },
  'GET /notificacoes': [],
  'GET /notificacoes/nao-lidas/count': { count: 0 },
  'GET /operacional/contexto': { unidades: [], grupos: [] },
};

type Cena = {
  arquivo: string;
  descricao: string;
  rotas: Cenario['rotas'];
  antesDaCaptura?: (page: Page) => Promise<void>;
  tambemTablet?: boolean;
};

async function capturar(page: Page, cena: Cena) {
  const cenario: Cenario = {
    rotas: { ...SHELL, ...cena.rotas },
    tokenInterno: TOKEN_INTERNO,
  };
  const sessao = await instalarFixtures(page, cenario);
  await estabelecerSessao(page, cenario);

  const viewports: [string, { width: number; height: number }][] = [
    ['desktop', DESKTOP],
    ['mobile', MOBILE],
  ];
  if (cena.tambemTablet) viewports.splice(1, 0, ['tablet', TABLET]);

  for (const [nome, vp] of viewports) {
    await page.setViewportSize(vp);
    await page.goto('/solicitacoes-embarcadores');
    await assentar(page);
    if (cena.antesDaCaptura) {
      await cena.antesDaCaptura(page);
      await assentar(page, 350);
    }
    const arquivo = `${cena.arquivo}-${nome}.png`;
    const pasta = nome === 'mobile' ? 'mobile' : 'carrier';
    await page.screenshot({ path: caminhoDeSaida(pasta, arquivo), fullPage: true });
    registrar(`${pasta}/${arquivo}`, cena.descricao, `${vp.width}x${vp.height}`);
  }

  expect(sessao.escapes, `escapes: ${JSON.stringify(sessao.escapes)}`).toEqual([]);
}

const ROTAS_DETALHE_0002 = {
  'GET /shipper-inbox/solicitacoes/req-fixture-0002/historico': F.HISTORICO_INTERNO,
  'GET /shipper-inbox/solicitacoes/req-fixture-0002/documentos-embarcador': F.DOCS_EMBARCADOR_INTERNO,
};

test.describe('Portal do Embarcador — caixa de entrada da transportadora', () => {
  test('60 caixa vazia', async ({ page }) => {
    await capturar(page, {
      arquivo: '60-inbox-vazia',
      descricao: 'Nenhuma solicitação recebida. Verificar: vazio explica quando algo aparece aqui.',
      rotas: {
        'GET /auth/me': F.USUARIO_INTERNO_COM_SHARE,
        'GET /shipper-inbox/solicitacoes': F.CAIXA_VAZIA,
      },
    });
  });

  test('61 caixa com os seis grupos', async ({ page }) => {
    await capturar(page, {
      arquivo: '61-inbox-grupos',
      descricao: 'Ajustes reenviados, novas, aceitas sem operação, aguardando embarcador, convertidas e encerradas. Verificar: a hierarquia é compreensível ou vira uma parede? O que exige decisão está no topo?',
      rotas: {
        'GET /auth/me': F.USUARIO_INTERNO_COM_SHARE,
        'GET /shipper-inbox/solicitacoes': F.CAIXA_ATIVA,
      },
      tambemTablet: true,
    });
  });

  test('62 detalhe da solicitação', async ({ page }) => {
    await capturar(page, {
      arquivo: '62-inbox-detalhe',
      descricao: 'Detalhe aberto: 3 origens, observações, 2 versões de envio, documento do embarcador, documento de frete elegível e comprovante aprovado elegível.',
      rotas: {
        'GET /auth/me': F.USUARIO_INTERNO_COM_SHARE,
        'GET /shipper-inbox/solicitacoes': F.CAIXA_ATIVA,
        ...ROTAS_DETALHE_0002,
        'GET /shipper-inbox/solicitacoes/req-fixture-0002/compartilhaveis': F.COMPARTILHAVEIS,
      },
      antesDaCaptura: async (page) => {
        await page.locator('button:has-text("Ver detalhes e documentos")').first().click();
        await page.waitForSelector('text=Documentos da operação');
      },
      tambemTablet: true,
    });
  });

  test('63 pedir ajustes — motivo obrigatório', async ({ page }) => {
    await capturar(page, {
      arquivo: '63-inbox-pedir-ajustes',
      descricao: 'Caixa de motivo aberta. Verificar: diz que o texto vai para o embarcador; o exemplo do placeholder orienta.',
      rotas: {
        'GET /auth/me': F.USUARIO_INTERNO_COM_SHARE,
        'GET /shipper-inbox/solicitacoes': F.CAIXA_ATIVA,
      },
      antesDaCaptura: async (page) => {
        await page.locator('button:has-text("Pedir ajustes")').first().click();
        await page.waitForSelector('text=O que precisa ser ajustado?');
      },
    });
  });

  test('64 não atender — motivo obrigatório', async ({ page }) => {
    await capturar(page, {
      arquivo: '64-inbox-nao-atender',
      descricao: 'Recusa com motivo. Verificar: mesma clareza do pedido de ajustes.',
      rotas: {
        'GET /auth/me': F.USUARIO_INTERNO_COM_SHARE,
        'GET /shipper-inbox/solicitacoes': F.CAIXA_ATIVA,
      },
      antesDaCaptura: async (page) => {
        await page.locator('button:has-text("Não atender")').first().click();
        await page.waitForSelector('text=Por que não é possível atender?');
      },
    });
  });

  test('65 sem permissão de compartilhar documento', async ({ page }) => {
    await capturar(page, {
      arquivo: '65-inbox-sem-permissao-share',
      descricao: 'Usuário revisa mas NÃO tem shipper_portal.documents.share. Verificar: a tela EXPLICA por que as ações de documento não aparecem — não pode ser só um ícone desabilitado sem motivo.',
      rotas: {
        'GET /auth/me': F.USUARIO_INTERNO_SEM_SHARE,
        'GET /shipper-inbox/solicitacoes': F.CAIXA_ATIVA,
        ...ROTAS_DETALHE_0002,
        'GET /shipper-inbox/solicitacoes/req-fixture-0002/compartilhaveis': 403,
      },
      antesDaCaptura: async (page) => {
        await page.locator('button:has-text("Ver detalhes e documentos")').first().click();
        await page.waitForSelector('text=não tem permissão para disponibilizar');
      },
      tambemTablet: true,
    });
  });

  test('66 sem permissão de revisar (acesso à área)', async ({ page }) => {
    await capturar(page, {
      arquivo: '66-inbox-sem-permissao-review',
      descricao: 'Usuário sem shipper_portal.requests.review. Verificar: explica o que fazer para obter acesso.',
      rotas: {
        'GET /auth/me': {
          ...F.USUARIO_INTERNO_SEM_SHARE,
          effective_permissions: { 'shipper_portal.requests.review': false },
        },
        'GET /shipper-inbox/solicitacoes': 403,
      },
    });
  });

  test('67 conteúdo longo na caixa de entrada', async ({ page }) => {
    const caixaLonga = {
      ...F.CAIXA_ATIVA,
      grupos: {
        ...F.CAIXA_ATIVA.grupos,
        ajustes_reenviados: [],
        novas_solicitacoes: [{
          ...F.CAIXA_ATIVA.grupos.novas_solicitacoes[0],
          cargo_name: 'Soja em grãos a granel safra 2025/2026 classificação tipo exportação',
          destination_name: 'Terminal Portuário de Uso Privativo do Complexo de Itaqui — Berço 108, Pátio de Granéis Sólidos',
          origins: [
            { nome: 'Fazenda Nossa Senhora Aparecida do Riacho Fundo — Gleba 14, Setor Norte, Rodovia BR-135 km 287', quantidade: 500 },
            { nome: 'Armazém Coletor Intermediário da Cooperativa — Unidade de Recebimento 03', quantidade: 450 },
          ],
          notes: 'A portaria da fazenda opera de segunda a sexta das 6h às 17h e aos sábados apenas até as 12h; fora desse horário o acesso depende de autorização prévia do responsável pela unidade, que precisa ser solicitada com no mínimo 24 horas de antecedência.',
        }],
      },
    };
    await capturar(page, {
      arquivo: '67-inbox-conteudo-longo',
      descricao: 'Nomes e observações longos. Verificar: sem overflow, sem botão cortado, sem rolagem horizontal no celular.',
      rotas: {
        'GET /auth/me': F.USUARIO_INTERNO_COM_SHARE,
        'GET /shipper-inbox/solicitacoes': caixaLonga,
      },
    });
  });

  test.afterAll(() => { gravarRegistro(); });
});
