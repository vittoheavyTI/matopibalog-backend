import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import * as F from './fixtures';
import {
  instalarFixtures, estabelecerSessao, assentar, PASTA_SAIDA, MOBILE, type Cenario,
} from './harness';

// Verificações OBJETIVAS que sustentam os achados do pacote. Não produzem
// screenshot: produzem medidas. Um achado como "estoura a largura no celular"
// não deve depender de alguém olhar a imagem e achar que estourou.

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

type Medida = {
  cena: string;
  url: string;
  viewport: string;
  scrollWidth: number;
  clientWidth: number;
  estouraLargura: boolean;
  elementosQueEstouram: string[];
  destaques: { seletor: string; texto: string; background: string }[];
};

const medidas: Medida[] = [];

async function medir(page: import('@playwright/test').Page, nome: string, url: string, cenario: Cenario) {
  await instalarFixtures(page, cenario);
  await estabelecerSessao(page, cenario);
  await page.setViewportSize(MOBILE);
  await page.goto(url);
  await assentar(page);

  const resultado = await page.evaluate(() => {
    const doc = document.documentElement;
    const largura = doc.clientWidth;

    // Elementos que ultrapassam a largura da viewport. Filtra os invisíveis e o
    // próprio html/body para não gerar ruído.
    const estouram: string[] = [];
    document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.right > largura + 1 || r.left < -1) {
        const id = el.id ? `#${el.id}` : '';
        const cls = typeof el.className === 'string' ? `.${el.className.split(' ').slice(0, 2).join('.')}` : '';
        const texto = (el.textContent || '').trim().slice(0, 40);
        estouram.push(`${el.tagName.toLowerCase()}${id}${cls} :: "${texto}" (right=${Math.round(r.right)})`);
      }
    });

    // Cartões que o código marca como destaque (âmbar/vermelho) — a pergunta é
    // se o fundo REALMENTE aparece diferente do cartão comum.
    const destaques: { seletor: string; texto: string; background: string }[] = [];
    document.querySelectorAll<HTMLElement>('[class*="bg-amber-50"], [class*="bg-red-50"], [class*="bg-emerald-50"], [class*="bg-sky-50"]')
      .forEach((el) => {
        const estilo = getComputedStyle(el);
        destaques.push({
          seletor: (typeof el.className === 'string' ? el.className : '').slice(0, 120),
          texto: (el.textContent || '').trim().slice(0, 50),
          background: estilo.backgroundColor,
        });
      });

    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: largura,
      estouram: estouram.slice(0, 12),
      destaques: destaques.slice(0, 8),
    };
  });

  medidas.push({
    cena: nome,
    url,
    viewport: `${MOBILE.width}x${MOBILE.height}`,
    scrollWidth: resultado.scrollWidth,
    clientWidth: resultado.clientWidth,
    estouraLargura: resultado.scrollWidth > resultado.clientWidth + 1,
    elementosQueEstouram: resultado.estouram,
    destaques: resultado.destaques,
  });
}

const ROTAS_BASE = { 'GET /portal/embarcador/contexto': F.CONTEXTO };

test.describe('Medidas objetivas', () => {
  test('portal externo', async ({ page }) => {
    await medir(page, 'inicio-ativo', '/portal/embarcador', {
      rotas: { ...ROTAS_BASE, 'GET /portal/embarcador/inicio': F.INICIO_ATIVO },
      tokenPortal: TOKEN,
    });
  });

  test('portal — ajustes solicitados', async ({ page }) => {
    await medir(page, 'ajustes-solicitados', '/portal/embarcador/operacoes/req-fixture-0002', {
      rotas: {
        ...ROTAS_BASE,
        'GET /portal/embarcador/operacoes/req-fixture-0002': F.DETALHE_AJUSTES,
        'GET /portal/embarcador/solicitacoes/req-fixture-0002/documentos': F.DOCUMENTOS_VAZIOS,
      },
      tokenPortal: TOKEN,
    });
  });

  test('portal — pedido novo', async ({ page }) => {
    await medir(page, 'pedido-novo', '/portal/embarcador/solicitacoes/nova', {
      rotas: { ...ROTAS_BASE },
      tokenPortal: TOKEN,
    });
  });

  test('portal — conteúdo longo', async ({ page }) => {
    await medir(page, 'conteudo-longo', '/portal/embarcador/operacoes/req-fixture-0003', {
      rotas: {
        'GET /portal/embarcador/contexto': F.CONTEXTO_LONGO,
        'GET /portal/embarcador/operacoes/req-fixture-0003': F.DETALHE_LONGO,
        'GET /portal/embarcador/solicitacoes/req-fixture-0003/documentos': F.DOCUMENTOS_LONGOS,
      },
      tokenPortal: TOKEN,
    });
  });

  test('portal — documentos', async ({ page }) => {
    await medir(page, 'documentos', '/portal/embarcador/operacoes/req-fixture-0003', {
      rotas: {
        ...ROTAS_BASE,
        'GET /portal/embarcador/operacoes/req-fixture-0003': F.DETALHE_ENTREGUE,
        'GET /portal/embarcador/solicitacoes/req-fixture-0003/documentos': F.DOCUMENTOS_COMPLETOS,
      },
      tokenPortal: TOKEN,
    });
  });

  test('caixa de entrada da transportadora', async ({ page }) => {
    await medir(page, 'inbox-grupos', '/solicitacoes-embarcadores', {
      rotas: { ...SHELL, 'GET /auth/me': F.USUARIO_INTERNO_COM_SHARE, 'GET /shipper-inbox/solicitacoes': F.CAIXA_ATIVA },
      tokenInterno: TOKEN_INTERNO,
    });
  });

  test('caixa de entrada — conteúdo longo', async ({ page }) => {
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
          ],
        }],
      },
    };
    await medir(page, 'inbox-conteudo-longo', '/solicitacoes-embarcadores', {
      rotas: { ...SHELL, 'GET /auth/me': F.USUARIO_INTERNO_COM_SHARE, 'GET /shipper-inbox/solicitacoes': caixaLonga },
      tokenInterno: TOKEN_INTERNO,
    });
  });

  test.afterAll(() => {
    fs.mkdirSync(PASTA_SAIDA, { recursive: true });
    fs.writeFileSync(path.join(PASTA_SAIDA, 'medidas.json'), JSON.stringify(medidas, null, 2), 'utf8');
    for (const m of medidas) {
      console.log(`\n### ${m.cena} (${m.viewport}) scroll=${m.scrollWidth} client=${m.clientWidth} estoura=${m.estouraLargura}`);
      m.elementosQueEstouram.forEach((e) => console.log('   OVERFLOW ' + e));
      m.destaques.forEach((d) => console.log(`   DESTAQUE bg=${d.background} :: "${d.texto}"`));
    }
  });
});

// ---------------------------------------------------------------------------
// Contenção (§46): a prova de que este pacote não tem como falar com produção.
// ---------------------------------------------------------------------------
test.describe('Contenção de rede', () => {
  test('o app aponta para o harness local, e uma fuga para produção é bloqueada e registrada', async ({ page }) => {
    const sessao = await instalarFixtures(page, {
      rotas: { 'GET /portal/embarcador/contexto': F.CONTEXTO, 'GET /portal/embarcador/inicio': F.INICIO_VAZIO },
      tokenPortal: TOKEN,
    });
    await estabelecerSessao(page, { rotas: {}, tokenPortal: TOKEN });
    await page.goto('/portal/embarcador');
    await assentar(page);

    // 1. O app realmente carregou contra o harness (e não contra outra origem).
    expect(sessao.atendidas.length).toBeGreaterThan(0);
    expect(sessao.escapes).toEqual([]);

    // 2. Fuga deliberada para os domínios reais: precisa falhar, e precisa ficar
    //    registrada. Se algum dia o catch-all deixar passar, este teste quebra.
    const alvos = [
      'https://matopibalog-backend-production.up.railway.app/health',
      'https://api.matopibalog.com.br/portal/embarcador/contexto',
    ];
    for (const alvo of alvos) {
      const resultado = await page.evaluate(async (url) => {
        try {
          await fetch(url, { method: 'GET' });
          return 'PASSOU';
        } catch {
          return 'BLOQUEADO';
        }
      }, alvo);
      expect(resultado, `fuga para ${alvo}`).toBe('BLOQUEADO');
    }

    // As duas tentativas têm de aparecer como escape — a contabilidade é o que
    // torna a garantia auditável, não a ausência de erro.
    const fugas = sessao.escapes.filter((e) => e.motivo === 'destino fora do harness');
    expect(fugas.length).toBe(alvos.length);
    console.log('\nCONTENÇÃO: ' + fugas.length + ' fuga(s) bloqueada(s) e registrada(s):');
    fugas.forEach((f) => console.log('   ' + f.metodo + ' ' + f.url + ' → abortado'));

    // 3. Escrita sem fixture também é escape (não vira 200 silencioso).
    const escrita = await page.evaluate(async () => {
      try {
        const r = await fetch('/__api/portal/embarcador/solicitacoes', { method: 'POST', body: '{}' });
        return r.status;
      } catch { return -1; }
    });
    expect(escrita).toBe(404);
    expect(sessao.escapes.some((e) => e.motivo === 'ESCRITA sem fixture')).toBe(true);
    console.log('CONTENÇÃO: POST sem fixture → 404 + registrado como escape de escrita');
  });
});
