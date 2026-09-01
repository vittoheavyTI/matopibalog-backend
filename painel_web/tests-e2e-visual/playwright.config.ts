import { defineConfig, devices } from '@playwright/test';

// PRODUCT REGRESSION PACK — visual/responsivo.
//
// Roda contra o BUILD de produção servido localmente, com toda a API interceptada
// por fixtures. Assim os estados comerciais que produção não fornece sob demanda
// (contrato pendente, trial expirado, conta suspensa) podem ser exercitados sem
// nenhuma escrita e sem depender de dados reais.
//
// O que este pack mede é comportamento verificável — largura de rolagem, contagem
// de itens ativos, visibilidade de CTA — e não "a captura ficou bonita".

export default defineConfig({
  testDir: '.',
  testMatch: /visual\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  webServer: {
    command: 'npm run preview -- --port 4183 --strictPort',
    port: 4183,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:4183',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
});
