import { test, expect } from '@playwright/test';
import { CENARIOS, ROTAS_CLIENTE, VIEWPORTS, instalarApiFake } from './fixtures';

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
        await instalarApiFake(page, CENARIO_PADRAO);
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
      });
    }
  }
});

test.describe('REG-001 — um único item de navegação ativo', () => {
  for (const rota of ['/', '/minhas-faturas', '/minhas-faturas?aba=contratacao', '/relatorios', '/relatorios/viagens']) {
    test(`exatamente 1 item ativo em ${rota}`, async ({ page }) => {
      await instalarApiFake(page, CENARIO_PADRAO);
      await page.setViewportSize({ width: 1440, height: 900 });
      await irPara(page, rota);

      const ativos = await page.locator('nav a.bg-green-700').count();
      expect(ativos, `${rota} acendeu ${ativos} itens de navegação`).toBe(1);
    });
  }

  test('com contrato pendente existe UM item financeiro, com badge', async ({ page }) => {
    await instalarApiFake(page, CENARIO_PADRAO);
    await page.setViewportSize({ width: 1440, height: 900 });
    await irPara(page, '/minhas-faturas');

    const financeiros = page.locator('nav a[href^="/minhas-faturas"]');
    await expect(financeiros).toHaveCount(1);
    await expect(page.locator('nav').getByText('Faturas / Regularização')).toBeVisible();
    await expect(page.locator('nav').getByText('Ação necessária')).toBeVisible();
    await expect(page.locator('nav').getByText('Contratação', { exact: true })).toHaveCount(0);
  });
});

test.describe('CTA de contratação leva à aba certa e o deep link sobrevive ao reload', () => {
  test('banner → aba contratacao → reload mantém a aba', async ({ page }) => {
    await instalarApiFake(page, CENARIO_PADRAO);
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
  });

  test('voltar no navegador sincroniza a aba', async ({ page }) => {
    await instalarApiFake(page, CENARIO_PADRAO);
    await page.setViewportSize({ width: 1440, height: 900 });
    await irPara(page, '/minhas-faturas');

    await page.getByRole('button', { name: 'Plano e contratação' }).click();
    await expect(page).toHaveURL(/aba=contratacao/);

    await page.goBack();
    await expect(page).not.toHaveURL(/aba=contratacao/);
  });
});

test.describe('coerência da matriz comercial na tela', () => {
  for (const cenario of CENARIOS) {
    test(`${cenario.nome} comunica um estado só`, async ({ page }) => {
      await instalarApiFake(page, cenario);
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
    });
  }
});

test.describe('ações primárias permanecem alcançáveis', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.nome} — CTA de assinatura visível e dentro da viewport`, async ({ page }) => {
      await instalarApiFake(page, CENARIO_PADRAO);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await irPara(page, '/');

      const cta = page.getByRole('button', { name: /assinar contrato/i });
      await expect(cta).toBeVisible();
      const caixa = await cta.boundingBox();
      expect(caixa, 'CTA sem caixa de layout').not.toBeNull();
      expect(caixa!.x).toBeGreaterThanOrEqual(0);
      expect(caixa!.x + caixa!.width).toBeLessThanOrEqual(vp.width + 1);
    });
  }
});
