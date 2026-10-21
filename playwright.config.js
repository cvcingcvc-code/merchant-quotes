import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1, retries: 0, timeout: 60000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    trace: 'retain-on-failure', screenshot: 'only-on-failure',
    launchOptions: { ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage'] },
  },
});
