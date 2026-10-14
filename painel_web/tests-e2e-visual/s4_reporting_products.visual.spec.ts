import { test, expect } from '@playwright/test';
import { CENARIOS, VIEWPORTS, instalarApiFake } from './fixtures';

const CENARIO_PADRAO = CENARIOS.find((c) => c.nome === 'plano-ativo-contrato-pendente')!;

test.describe('Reporting Products V1 — Verificação Visual e Responsiva (/relatorios/viagens)', () => {
  for (const vp of VIEWPORTS) {
    test(`Sem overflow horizontal em ${vp.nome} (${vp.width}x${vp.height})`, async ({ page }) => {
      const rede = await instalarApiFake(page, CENARIO_PADRAO);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/relatorios/viagens', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('nav a', { timeout: 20_000 });

      const medida = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      expect(
        medida.scrollWidth,
        `/relatorios/viagens em ${vp.nome} rola horizontalmente (${medida.scrollWidth} > ${medida.clientWidth})`,
      ).toBeLessThanOrEqual(medida.clientWidth + 1);

      rede.assertSemRedeExterna();
    });
  }
});
