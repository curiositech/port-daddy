import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:4179',
    viewport: { width: 1600, height: 1050 },
    colorScheme: 'dark',
  },
  webServer: {
    command: 'npm run dev -- --port 4179',
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: true,
  },
});
