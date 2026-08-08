import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /sec1\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    launchOptions: {
      args: [
        '--host-resolver-rules=MAP app.sec1.test 127.0.0.1,MAP api.sec1.invalid 127.0.0.1,MAP evil.sec1.test 127.0.0.1',
      ],
    },
  },
});
