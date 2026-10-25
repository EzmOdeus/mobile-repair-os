import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    locale: 'ar-EG',
    timezoneId: 'Africa/Cairo',
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_SKIP_WEBSERVER
    ? undefined
    : [
        {
          command: 'npm run dev:api',
          url: 'http://localhost:4000/api/v1/health',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        {
          command: 'npm run dev:web',
          url: 'http://localhost:3000/login',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ],
});
