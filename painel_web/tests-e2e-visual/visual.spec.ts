import { test, expect } from '@playwright/test';
import { CENARIOS, ROTAS_CLIENTE, VIEWPORTS, instalarApiFake, PERMISSOES_SO_CONTRATACAO, PERMISSOES_SO_FINANCAS } from './fixtures';

// PRODUCT REGRESSION PACK — verificações MEDIDAS, não capturas de tela.
//
// REG-001 sobreviveu a um CI verde porque nada media a navegação renderizada.
// Cada asserção aqui é um número que a máquina consegue conferir:
//   - scrollWidth <= clientWidth  (sem rolagem horizontal)
//   - contagem de itens de nav ativos  (exatamente 1)
//   - CTA primário visível e clicável
//   - diálogos dentro da viewport
//
// A captura de tela é anexada apenas como EVIDÊNCIA para o owner; ela nunca é a
// prova. Nenhuma escrita, nenhuma chamada externa: a API está toda interceptada.

const CENARIO_PADRAO = CENARIOS.find((c) => c.nome === 'plano-ativo-contrato-pendente')!;

async function irPara(page: import('@playwright/test').Page, rota: string) {
  await page.goto(rota, { waitUntil: 'domcontentloaded' });
  // A sidebar é o esqueleto do painel autenticado: sua presença marca o app pronto.
  await page.waitForSelector('nav a', { timeout: 20_000 });
}

test.describe('sem rolagem horizontal em nenhuma viewport', () => {
  for (const vp of VIEWPORTS) {
    for (const rota of ROTAS_CLIENTE) {
      test(`${vp.nome} ${vp.width}x${vp.height} — ${rota}`, async ({ page }) => {
        const rede = await instalarApiFake(page, CENARIO_PADRAO);
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await irPara(page, rota);

        const medida = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(
          medida.scrollWidth,
          `${rota} em ${vp.nome} rola horizontalmente (${medida.scrollWidth} > ${medida.clientWidth})`,
        ).toBeLessThanOrEqual(medida.clientWidth + 1);
        rede.assertSemRedeExterna();
      });
    }
  }
});

test.describe('REG-001 — um único item de navegação ativo', () => {
  for (const rota of ['/', '/minhas-faturas', '/minhas-faturas?aba=contratacao', '/relatorios', '/relatorios/viagens']) {
    test(`exatamente 1 item ativo em ${rota}`, async ({ page }) => {
      const rede = await instalarApiFake(page, CENARIO_PADRAO);
      await page.setViewportSize({ width: 1440, height: 900 });
      await irPara(page, rota);

      const ativos = await page.locator('nav a.bg-green-700').count();
      expect(ativos, `${rota} acendeu ${ativos} itens de navegação`).toBe(1);
      rede.assertSemRedeExterna();
    });
  }

  test('com contrato pendente existe UM item financeiro, com badge', async ({ page }) => {
    const rede = await instalarApiFake(page, CENARIO_PADRAO);
    await page.setViewportSize({ width: 1440, height: 900 });
    await irPara(page, '/minhas-faturas');

    const financeiros = page.locator('nav a[href^="/minhas-faturas"]');
    await expect(financeiros).toHaveCount(1);
    await expect(page.locator('nav').getByText('Faturas / Regularização')).toBeVisible();
    await expect(page.locator('nav').getByText('Ação necessária')).toBeVisible();
    await expect(page.locator('nav').getByText('Contratação', { exact: true })).toHaveCount(0);
    rede.assertSemRedeExterna();
  });
});

test.describe('CTA de contratação leva à aba certa e o deep link sobrevive ao reload', () => {
  test('banner → aba contratacao → reload mantém a aba', async ({ page }) => {
    const rede = await instalarApiFake(page, CENARIO_PADRAO);
    await page.setViewportSize({ width: 1440, height: 900 });
    await irPara(page, '/');

    const cta = page.getByRole('button', { name: /assinar contrato/i });
    await expect(cta).toBeVisible();
    await cta.click();

    await expect(page).toHaveURL(/aba=contratacao/);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/aba=contratacao/);
    // A aba continua sendo a de contratação após o reload (deriva da URL).
    await expect(page.getByRole('button', { name: 'Plano e contratação' })).toBeVisible();
    rede.assertSemRedeExterna();
  });

  test('voltar no navegador sincroniza a aba', async ({ page }) => {
    const rede = await instalarApiFake(page, CENARIO_PADRAO);
    await page.setViewportSize({ width: 1440, height: 900 });
    await irPara(page, '/minhas-faturas');

    await page.getByRole('button', { name: 'Plano e contratação' }).click();
    await expect(page).toHaveURL(/aba=contratacao/);

    await page.goBack();
    await expect(page).not.toHaveURL(/aba=contratacao/);
    rede.assertSemRedeExterna();
  });
});

test.describe('coerência da matriz comercial na tela', () => {
  for (const cenario of CENARIOS) {
    test(`${cenario.nome} comunica um estado só`, async ({ page }) => {
      const rede = await instalarApiFake(page, cenario);
      await page.setViewportSize({ width: 1440, height: 900 });
      await irPara(page, '/minhas-faturas');

      const corpo = (await page.locator('main').innerText()).toLowerCase();
      const pendente = cenario.contratacaoStatus.pendencia_obrigatoria === true;

      if (pendente) {
        // BUG-005: com contrato obrigatório pendente, a tela não pode afirmar que
        // está tudo liberado. A frase exata que fazia isso não pode voltar.
        expect(corpo, `${cenario.nome} afirmou liberação com contrato pendente`)
          .not.toContain('seu plano está ativo.');
      }
      // Sempre há uma comunicação de estado — nunca uma tela muda.
      expect(corpo.length).toBeGreaterThan(0);
      rede.assertSemRedeExterna();
    });
  }
});

test.describe('ações primárias permanecem alcançáveis', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.nome} — CTA de assinatura visível e dentro da viewport`, async ({ page }) => {
      const rede = await instalarApiFake(page, CENARIO_PADRAO);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await irPara(page, '/');

      const cta = page.getByRole('button', { name: /assinar contrato/i });
      await expect(cta).toBeVisible();
      const caixa = await cta.boundingBox();
      expect(caixa, 'CTA sem caixa de layout').not.toBeNull();
      expect(caixa!.x).toBeGreaterThanOrEqual(0);
      expect(caixa!.x + caixa!.width).toBeLessThanOrEqual(vp.width + 1);
      rede.assertSemRedeExterna();
    });
  }
});

test.describe('S1-HIGH-01 — a aba de contratação não faz I/O financeiro', () => {
  test('persona sem finance.saas.view assina sem tocar em endpoint financeiro', async ({ page }) => {
    const financeiros: string[] = [];
    page.on('request', (r) => {
      const u = r.url();
      if (u.includes('/pagamentos/')) financeiros.push(`${r.method()} ${u}`);
    });

    const rede = await instalarApiFake(page, CENARIO_PADRAO, { permissoes: PERMISSOES_SO_CONTRATACAO });
    await page.setViewportSize({ width: 1440, height: 900 });
    await irPara(page, '/minhas-faturas?aba=contratacao');
    await page.waitForTimeout(1200);

    // A área de contratação está acessível...
    await expect(page.getByRole('button', { name: 'Plano e contratação' })).toBeVisible();
    // ...a aba financeira não é oferecida...
    await expect(page.getByRole('button', { name: 'Faturas', exact: true })).toHaveCount(0);
    // ...e nenhum endpoint financeiro foi chamado. 403 do backend não bastaria:
    // a UI não deve pedir o que sabe que não pode pedir.
    expect(financeiros, `I/O financeiro indevido: ${financeiros.join(', ')}`).toHaveLength(0);
    rede.assertSemRedeExterna();
  });
});

test.describe('§15 — a sentinela de rede realmente detecta vazamento', () => {
  test('uma request externa deliberada FALHA a asserção (controle negativo)', async ({ page }) => {
    const rede = await instalarApiFake(page, CENARIO_PADRAO);
    await irPara(page, '/');
    // O host precisa ser um dos permitidos pela CSP do app (), senão o
    // navegador barra antes de virar requisição e a sentinela nem é exercitada — a
    // CSP é, aliás, uma terceira camada de contenção. Este é exatamente o host que
    // vazou na primeira execução do pack.
    await page.evaluate(() => fetch('https://api.matopibalog.com.br/ping').catch(() => {}));
    await page.waitForTimeout(300);

    expect(rede.violacoes.length).toBeGreaterThan(0);
    expect(() => rede.assertSemRedeExterna()).toThrow(/EXTERNAL_NETWORK_REQUESTS_ALLOWED=0/);
  });
});

test.describe('S1-HIGH-04 — a fronteira vale nos dois sentidos', () => {
  test('persona só de FINANÇAS não vê nem chama contratação', async ({ page }) => {
    const contratuais: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/contratacao')) contratuais.push(`${r.method()} ${r.url()}`);
    });

    const rede = await instalarApiFake(page, CENARIO_PADRAO, { permissoes: PERMISSOES_SO_FINANCAS });
    await page.setViewportSize({ width: 1440, height: 900 });
    // Força o deep link da área que ela NÃO pode acessar.
    await irPara(page, '/minhas-faturas?aba=contratacao');
    await page.waitForTimeout(1200);

    await expect(page.getByRole('button', { name: 'Faturas' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Plano e contratação' })).toHaveCount(0);
    expect(contratuais, `I/O de contratação indevido: ${contratuais.join(', ')}`).toHaveLength(0);
    // E o banner global de contratação não oferece um CTA que terminaria em 403.
    await expect(page.getByRole('button', { name: /assinar contrato/i })).toHaveCount(0);
    rede.assertSemRedeExterna();
  });
});

test.describe('S1-MEDIUM-01 — super-admin não opera o hub de tenant', () => {
  test('/minhas-faturas redireciona para o financeiro de plataforma, sem I/O de tenant', async ({ page }) => {
    const tenantIO: string[] = [];
    page.on('request', (r) => {
      const u = r.url();
      if (!u.includes('/pagamentos/') && !u.includes('/contratacao')) return;
      let origem = '';
      try {
        origem = r.frame().url();
      } catch {
        origem = page.url();
      }
      if (origem.includes('/minhas-faturas')) tenantIO.push(`${r.method()} ${u} via ${origem}`);
    });

    const rede = await instalarApiFake(page, CENARIO_PADRAO, { superAdmin: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/minhas-faturas', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    await expect(page).toHaveURL(/painel-administrativo\/financeiro/);
    await expect(page.getByRole('button', { name: 'Plano e contratação' })).toHaveCount(0);
    expect(tenantIO, `I/O de tenant indevido: ${tenantIO.join(', ')}`).toHaveLength(0);
    rede.assertSemRedeExterna();
  });
});

test.describe('S4 — fronteira do portal externo de parceiros', () => {
  test('403 no portal do parceiro limpa só a sessão externa, preservando tokens internos/embarcador', async ({ page }) => {
    const rede = await instalarApiFake(page, CENARIO_PADRAO);
    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'internal-token-nao-usado-pelo-portal');
      localStorage.setItem('matopibalog_portal_token', 'shipper-token-nao-usado-pelo-parceiro');
      localStorage.setItem('matopibalog_partner_token', 'partner-token-revogado');
    });

    await page.route('**/api/portal/parceiro/oportunidades', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Acesso do parceiro revogado.' }),
      });
    });

    await page.goto('/portal/parceiro/oportunidades', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('Matopiba Log · Parceiros')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Acesso do parceiro revogado.');
    await expect(page.locator('nav a')).toHaveCount(0);

    await expect.poll(async () => page.evaluate(() => ({
      interno: localStorage.getItem('auth_token'),
      embarcador: localStorage.getItem('matopibalog_portal_token'),
      parceiro: localStorage.getItem('matopibalog_partner_token'),
    }))).toEqual({
      interno: 'internal-token-nao-usado-pelo-portal',
      embarcador: 'shipper-token-nao-usado-pelo-parceiro',
      parceiro: null,
    });
    rede.assertSemRedeExterna();
  });
});
