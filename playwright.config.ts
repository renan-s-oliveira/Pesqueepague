import { defineConfig, devices } from '@playwright/test';

const PORT = 5179;

/**
 * E2E e medição de performance. O servidor sobe o Vite em `--mode e2e`, o único modo
 * em que o jogo lê ?seed= e ?clock=manual e expõe os ganchos de teste em window.__fp.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  outputDir: './node_modules/.cache/playwright-results',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  expect: {
    // Tolerância da regressão visual: a água e o céu animam com o tempo real, então a
    // comparação absorve o deslocamento de fase, mas reprova mudança de paleta ou layout.
    toHaveScreenshot: { maxDiffPixelRatio: 0.12, threshold: 0.35, animations: 'disabled' },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] },
      },
    },
  ],
  webServer: {
    command: `npx vite --mode e2e --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
