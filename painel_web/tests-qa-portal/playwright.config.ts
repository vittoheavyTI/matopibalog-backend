import { defineConfig, devices } from '@playwright/test';
import { API_BASE, ORIGEM_LOCAL, PORTA } from './harness';

// Config do pacote de aceitação visual do Portal do Embarcador V1.
//
// O app é servido pelo dev server do Vite, com `VITE_API_URL` apontando para o
// PRÓPRIO servidor local, sob o prefixo `/__api`. Isso respeita a CSP real do
// `index.html` (que só permite `'self'` e os domínios da Matopiba) sem afrouxá-la,
// e garante que a "API" do pacote não tem caminho para a internet.

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.visual\.spec\.ts/,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: ORIGEM_LOCAL,
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    // A primeira navegação num worktree novo paga a compilação inicial do Vite,
    // que é bem mais lenta que as seguintes.
    navigationTimeout: 120_000,
    // Congela a data para que "atualizado em" e afins não mudem entre execuções
    // e o pacote seja comparável de uma rodada para outra.
    timezoneId: 'America/Sao_Paulo',
    locale: 'pt-BR',
  },
  webServer: {
    command: `npm run dev -- --port ${PORTA} --strictPort`,
    url: ORIGEM_LOCAL,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { VITE_API_URL: API_BASE },
  },
});
