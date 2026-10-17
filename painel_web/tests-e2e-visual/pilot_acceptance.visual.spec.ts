import { expect, test, type Page, type Route } from '@playwright/test';
import { CENARIOS, instalarApiFake, json } from './fixtures';

const CENARIO = CENARIOS.find((item) => item.nome === 'plano-ativo-contrato-assinado')!;
const PERMISSOES_BASE = {
  'freight.view': true,
  'drivers.view': true,
  'reports.operational.view': true,
};

async function abrirPainel(page: Page, permissoes: Record<string, boolean>, interceptadores = <Array<(route: Route, url: URL) => boolean | Promise<boolean>>>[]) {
  const rede = await instalarApiFake(page, CENARIO, { permissoes, interceptadores });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/relatorios/viagens', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Gerenciamento de Fretes')).toBeVisible();
  return rede;
}

async function preencherFrete(page: Page) {
  await page.getByPlaceholder('Digite ou selecione o motorista...').click();
  await page.getByText('Motorista Sintético - AAA0A00').click();
  await page.getByPlaceholder('Cidade de origem').fill('Origem Sintética');
  await page.getByPlaceholder('Cidade de destino').fill('Destino Sintético');
  await page.getByPlaceholder('0,00').fill('1250');
}

test('PA-005: ação de criação não aparece sem freight.create efetivo', async ({ page }, testInfo) => {
  const rede = await abrirPainel(page, PERMISSOES_BASE);
  await expect(page.getByRole('button', { name: 'Novo Frete' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('pa-005-sem-criacao-mobile.png'), fullPage: true });
  rede.assertSemRedeExterna();
});

test('PA-022/047/054: resposta perdida mantém a mesma intenção após reabrir o modal', async ({ page }, testInfo) => {
  const chaves: string[] = [];
  let tentativas = 0;
  const interceptadores = [async (route: Route, url: URL) => {
    const request = route.request();
    if (request.method() === 'GET' && url.pathname.endsWith('/motoristas')) {
      await json(route, [{ id: 'mot-a', nome: 'Motorista Sintético', placa: 'AAA0A00', tipo: 'vinculado' }]);
      return true;
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/fretes')) {
      tentativas += 1;
      const payload = request.postDataJSON();
      chaves.push(payload.client_request_id);
      if (tentativas === 1) await route.abort('timedout');
      else await json(route, { id: 'frete-sintetico-1', ...payload }, 201);
      return true;
    }
    return false;
  }];
  const rede = await abrirPainel(page, { ...PERMISSOES_BASE, 'freight.create': true }, interceptadores);

  await page.getByRole('button', { name: 'Novo Frete' }).click();
  await preencherFrete(page);
  const dialogPromise = page.waitForEvent('dialog');
  const submitPromise = page.getByRole('button', { name: 'Salvar', exact: true }).click();
  const dialog = await dialogPromise;
  expect(dialog.message()).toContain('resultado da criação ainda é incerto');
  await dialog.accept();
  await submitPromise;

  await page.locator('.fixed.inset-0').locator('button').first().click();
  await page.getByRole('button', { name: 'Novo Frete' }).click();
  await preencherFrete(page);
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();

  await expect.poll(() => chaves.length).toBe(2);
  expect(chaves[0]).toMatch(/^[0-9a-f-]{36}$/i);
  expect(chaves[1]).toBe(chaves[0]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('pa-022-reconciliado-mobile.png'), fullPage: true });
  rede.assertSemRedeExterna();
});
