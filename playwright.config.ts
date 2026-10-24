import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', timeout: 90000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:8787', headless: true, screenshot: 'only-on-failure',
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {} },
  webServer: { command: 'sh scripts/run.sh', url: 'http://127.0.0.1:8787/api/health', reuseExistingServer: false, timeout: 30000 },
});
