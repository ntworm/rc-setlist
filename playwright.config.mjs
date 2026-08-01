import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  testMatch: '**/*.spec.mjs',
  timeout: 15_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
  },
  webServer: {
    command: 'node tests/ui/mock-stage-server.mjs',
    url: 'http://127.0.0.1:4173/setlist/',
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});
