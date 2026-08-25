import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import * as F from './fixtures';
import {
  instalarFixtures, estabelecerSessao, assentar, PASTA_SAIDA_AFTER,
  DESKTOP, MOBILE, type Cenario,
} from './harness';

// Pacote "depois" da correção da aceitação visual.
//
// Deliberadamente ENXUTO (§69): recaptura só as cenas afetadas pelos achados,
// mais as duas telas que passaram a existir. Regerar as 85 capturas originais
// não provaria nada além de gastar o tempo de quem vai revisar — o pacote
// original continua no PR #479 como evidência do estado anterior.
//
// Além das imagens, este arquivo produz MEDIDAS: cor de fundo computada,
// largura de rolagem e presença de elementos. Um "corrigido" que dependa de
// alguém olhar a imagem e concordar não é prova.

const TOKEN = 'token-fixture-portal-nao-e-real';
const TOKEN_INTERNO = 'token-fixture-interno-nao-e-real';

const SHELL = {
  'GET /ai/capabilities': { enabled: false, provider_available: false, read_only: true },
  'GET /configuracoes': {},
  'GET /configuracoes/empresa': { logomarca: null },
  'GET /notificacoes': [],
  'GET /notificacoes/nao-lidas/count': { count: 0 },
  'GET /operacional/contexto': { unidades: [], grupos: [] },
};

const ROTAS_BASE = { 'GET /portal/embarcador/contexto': F.CONTEXTO };

type Medicao = {
  cena: string;
  viewport: string;
  scrollWidth: number;
  clientWidth: number;
  estouraLargura: boolean;
  destaquesSemanticos: { texto: string; background: string }[];
  elementosQueEstouram: string[];
};

const medicoes: Medicao[] = [];

async function medir(page: Page, cena: string, viewport: string) {
  const r = await page.evaluate(() => {
    const doc = document.documentElement;
    const largura = doc.clientWidth;

    const estouram: string[] = [];
    document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) return;
      if (b.right > largura + 1 || b.left < -1) {
        const cls = typeof el.className === 'string' ? `.${el.className.split(' ').slice(0, 2).join('.')}` : '';
        estouram.push(`${el.tagName.toLowerCase()}${cls} :: "${(el.textContent || '').trim().slice(0, 40)}"`);
      }
    });

    // Cartões que o produto marca como semânticos. A pergunta é se o fundo
    // realmente difere do branco — foi exatamente isso que falhava.
    const destaques: { texto: string; background: string }[] = [];
    document.querySelectorAll<HTMLElement>('[class*="bg-amber-50"], [class*="bg-red-50"], [class*="bg-emerald-50"], [class*="bg-sky-50"]')
      .forEach((el) => {
        destaques.push({
          texto: (el.textContent || '').trim().slice(0, 60),
          background: getComputedStyle(el).backgroundColor,
        });
      });

    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: largura,
      estouram: estouram.slice(0, 10),
      destaques: destaques.slice(0, 6),
    };
  });

  medicoes.push({
    cena, viewport,
    scrollWidth: r.scrollWidth,
    clientWidth: r.clientWidth,
    estouraLargura: r.scrollWidth > r.clientWidth + 1,
    destaquesSemanticos: r.destaques,
    elementosQueEstouram: r.estouram,
  });
}

function caminho(sub: string, arquivo: string) {
  const dir = path.join(PASTA_SAIDA_AFTER, sub);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, arquivo);
}

type Cena = {
  arquivo: string;
  url: string;
  rotas: Cenario['rotas'];
  interno?: boolean;
  comSessao?: boolean;
  antesDaCaptura?: (page: Page) => Promise<void>;
};

async function capturar(page: Page, cena: Cena) {
  const cenario: Cenario = {
    rotas: cena.interno ? { ...SHELL, ...cena.rotas } : cena.rotas,
    tokenPortal: cena.interno || cena.comSessao === false ? undefined : TOKEN,
    tokenInterno: cena.interno ? TOKEN_INTERNO : undefined,
  };
  const sessao = await instalarFixtures(page, cenario);
  await estabelecerSessao(page, cenario);

  for (const [nome, vp] of [['desktop', DESKTOP], ['mobile', MOBILE]] as const) {
    await page.setViewportSize(vp);
    await page.goto(cena.url);
    await assentar(page);
    if (cena.antesDaCaptura) {
      await cena.antesDaCaptura(page);
      await assentar(page, 350);
    }
    await medir(page, cena.arquivo, `${vp.width}x${vp.height}`);
    await page.screenshot({ path: caminho(nome, `${cena.arquivo}-${nome}.png`), fullPage: true });
  }

  expect(sessao.escapes, `escapes: ${JSON.stringify(sessao.escapes)}`).toEqual([]);
}

test.describe('Portal V1 — depois da correção', () => {
  test('07 início com atividade', async ({ page }) => {
    await capturar(page, {
      arquivo: '07-inicio-ativo',
      url: '/portal/embarcador',
      rotas: { ...ROTAS_BASE, 'GET /portal/embarcador/inicio': F.INICIO_ATIVO },
    });
  });

  test('07b início só com entrega parcial', async ({ page }) => {
    await capturar(page, {
      arquivo: '07b-inicio-entrega-parcial',
      url: '/portal/embarcador',
      rotas: { ...ROTAS_BASE, 'GET /portal/embarcador/inicio': F.INICIO_SO_ENTREGA_PARCIAL },
    });
  });

  test('13 pedido enviado', async ({ page }) => {
    await capturar(page, {
      arquivo: '13-pedido-enviado',
      url: '/portal/embarcador/pedidos/req-fixture-0003?enviada=1',
      rotas: {
        ...ROTAS_BASE,
        'GET /portal/embarcador/operacoes/req-fixture-0003': {
          ...F.DETALHE_PLANEJAMENTO,
          status_externo: 'EM_ANALISE',
          status_rotulo: 'Em análise pela transportadora',
          linha_do_tempo: [
            { chave: 'ENVIADA', rotulo: 'Pedido enviado', em: '2026-08-25T12:00:00.000Z' },
          ],
        },
        'GET /portal/embarcador/solicitacoes/req-fixture-0003/documentos': F.DOCUMENTOS_VAZIOS,
      },
    });
  });

  test('20 ajustes solicitados', async ({ page }) => {
    await capturar(page, {
      arquivo: '20-ajustes-solicitados',
      url: '/portal/embarcador/pedidos/req-fixture-0002',
      rotas: {
        ...ROTAS_BASE,
        'GET /portal/embarcador/operacoes/req-fixture-0002': F.DETALHE_AJUSTES,
        'GET /portal/embarcador/solicitacoes/req-fixture-0002/documentos': F.DOCUMENTOS_VAZIOS,
      },
    });
  });

  test('22 histórico com comparativo', async ({ page }) => {
    await capturar(page, {
      arquivo: '22-historico-envios',
      url: '/portal/embarcador/pedidos/req-fixture-0002',
      rotas: {
        ...ROTAS_BASE,
        'GET /portal/embarcador/operacoes/req-fixture-0002': F.DETALHE_COM_HISTORICO,
        'GET /portal/embarcador/solicitacoes/req-fixture-0002/documentos': F.DOCUMENTOS_VAZIOS,
        'GET /portal/embarcador/solicitacoes/req-fixture-0002/historico': F.HISTORICO_CRESCENTE,
      },
      antesDaCaptura: async (p) => {
        await p.click('button:has-text("Ver histórico de envios")');
        await p.waitForSelector('text=O que mudou neste envio');
      },
    });
  });

  test('33 entrega parcial', async ({ page }) => {
    await capturar(page, {
      arquivo: '33-tracking-entrega-parcial',
      url: '/portal/embarcador/pedidos/req-fixture-0003',
      rotas: {
        ...ROTAS_BASE,
        'GET /portal/embarcador/operacoes/req-fixture-0003': F.DETALHE_PARCIAL,
        'GET /portal/embarcador/solicitacoes/req-fixture-0003/documentos': F.DOCUMENTOS_VAZIOS,
      },
    });
  });

  test('34 entrega concluída com progresso', async ({ page }) => {
    await capturar(page, {
      arquivo: '34-tracking-entregue',
      url: '/portal/embarcador/pedidos/req-fixture-0003',
      rotas: {
        ...ROTAS_BASE,
        'GET /portal/embarcador/operacoes/req-fixture-0003': F.DETALHE_ENTREGUE_COM_PROGRESSO,
        'GET /portal/embarcador/solicitacoes/req-fixture-0003/documentos': F.DOCUMENTOS_VAZIOS,
      },
    });
  });

  test('35 comprovante em pré-visualização', async ({ page }) => {
    await capturar(page, {
      arquivo: '35-comprovante-preview',
      url: '/portal/embarcador/pedidos/req-fixture-0004',
      rotas: {
        ...ROTAS_BASE,
        'GET /portal/embarcador/operacoes/req-fixture-0004': F.DETALHE_COMPROVANTE,
        'GET /portal/embarcador/solicitacoes/req-fixture-0004/documentos': F.DOCUMENTOS_SO_COMPROVANTE,
        'GET /portal/embarcador/documentos/doc-fixture-0020/url': {
          url: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iMzAwIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iI2VlZSIvPjx0ZXh0IHg9IjIwMCIgeT0iMTUwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSIyMCIgZmlsbD0iIzMzMyI+Q2FuaG90byAoZXhlbXBsbyk8L3RleHQ+PC9zdmc+',
          mime_type: 'image/svg+xml',
          expira_em_segundos: 300,
        },
      },
      antesDaCaptura: async (p) => {
        await p.click('button:has-text("Ver comprovante")');
        await p.waitForSelector('[role="dialog"]');
      },
    });
  });

  test('40 documentos do pedido', async ({ page }) => {
    await capturar(page, {
      arquivo: '40-documentos-do-pedido',
      url: '/portal/embarcador/pedidos/req-fixture-0003',
      rotas: {
        ...ROTAS_BASE,
        'GET /portal/embarcador/operacoes/req-fixture-0003': F.DETALHE_ENTREGUE_COM_PROGRESSO,
        'GET /portal/embarcador/solicitacoes/req-fixture-0003/documentos': F.DOCUMENTOS_COMPLETOS,
      },
    });
  });

  test('43 duas transportadoras', async ({ page }) => {
    await capturar(page, {
      arquivo: '43-duas-transportadoras',
      url: '/portal/embarcador',
      rotas: {
        'GET /portal/embarcador/contexto': F.CONTEXTO_DUAS_TRANSPORTADORAS,
        'GET /portal/embarcador/inicio': F.INICIO_ATIVO,
      },
    });
  });

  test('50 conteúdo longo', async ({ page }) => {
    await capturar(page, {
      arquivo: '50-conteudo-longo',
      url: '/portal/embarcador/pedidos/req-fixture-0003',
      rotas: {
        'GET /portal/embarcador/contexto': F.CONTEXTO_LONGO,
        'GET /portal/embarcador/operacoes/req-fixture-0003': F.DETALHE_LONGO,
        'GET /portal/embarcador/solicitacoes/req-fixture-0003/documentos': F.DOCUMENTOS_LONGOS,
      },
    });
  });

  // Telas novas -------------------------------------------------------------

  test('70 aba Pedidos', async ({ page }) => {
    await capturar(page, {
      arquivo: '70-aba-pedidos',
      url: '/portal/embarcador/pedidos',
      rotas: { ...ROTAS_BASE, 'GET /portal/embarcador/operacoes': F.LISTA_COM_PARCIAL },
    });
  });

  test('71 aba Transportes', async ({ page }) => {
    await capturar(page, {
      arquivo: '71-aba-transportes',
      url: '/portal/embarcador/transportes',
      rotas: { ...ROTAS_BASE, 'GET /portal/embarcador/operacoes': F.LISTA_COM_PARCIAL },
    });
  });

  test('72 aba Documentos', async ({ page }) => {
    await capturar(page, {
      arquivo: '72-aba-documentos',
      url: '/portal/embarcador/documentos',
      rotas: { ...ROTAS_BASE, 'GET /portal/embarcador/documentos': F.DOCUMENTOS_AGREGADOS },
    });
  });

  // Lado da transportadora — o preview passou a valer aqui também ------------

  test('62 detalhe na caixa de entrada', async ({ page }) => {
    await capturar(page, {
      arquivo: '62-inbox-detalhe',
      url: '/solicitacoes-embarcadores',
      interno: true,
      rotas: {
        'GET /auth/me': F.USUARIO_INTERNO_COM_SHARE,
        'GET /shipper-inbox/solicitacoes': F.CAIXA_ATIVA,
        'GET /shipper-inbox/solicitacoes/req-fixture-0002/historico': F.HISTORICO_INTERNO,
        'GET /shipper-inbox/solicitacoes/req-fixture-0002/documentos-embarcador': F.DOCS_EMBARCADOR_INTERNO,
        'GET /shipper-inbox/solicitacoes/req-fixture-0002/compartilhaveis': F.COMPARTILHAVEIS,
      },
      antesDaCaptura: async (p) => {
        await p.locator('button:has-text("Ver detalhes e documentos")').first().click();
        await p.waitForSelector('text=Documentos da operação');
      },
    });
  });

  test.afterAll(() => {
    fs.mkdirSync(PASTA_SAIDA_AFTER, { recursive: true });
    fs.writeFileSync(
      path.join(PASTA_SAIDA_AFTER, 'medidas-after.json'),
      JSON.stringify(medicoes, null, 2),
      'utf8',
    );
    for (const m of medicoes) {
      const alerta = m.estouraLargura ? '  ⚠ ESTOURA' : '';
      console.log(`\n### ${m.cena} (${m.viewport}) scroll=${m.scrollWidth} client=${m.clientWidth}${alerta}`);
      m.elementosQueEstouram.forEach((e) => console.log('   OVERFLOW ' + e));
      m.destaquesSemanticos.forEach((d) => console.log(`   DESTAQUE bg=${d.background} :: "${d.texto}"`));
    }
  });
});
