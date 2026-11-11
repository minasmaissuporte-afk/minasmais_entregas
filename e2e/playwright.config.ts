import { defineConfig, devices } from "@playwright/test";
import { API_URL, WEB_URL } from "./support/env.ts";

/**
 * Bateria E2E do Minas Mais Entregas.
 * - api: contrato, permissões por papel e fluxos completos pela API real.
 * - ui-desktop / ui-mobile: painel web e PWA do motoboy no navegador.
 * Os testes rodam em série: compartilham o mesmo banco local e os mesmos motoboys.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }], ["json", { outputFile: "test-results/results.json" }]],
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  use: {
    baseURL: WEB_URL,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "api", testMatch: /api\/.*\.spec\.ts/ },
    {
      name: "ui-desktop",
      testMatch: /ui\/(?!courier).*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "ui-mobile",
      testMatch: /ui\/courier.*\.spec\.ts/,
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: [
    {
      command: "pnpm --dir .. dev:api",
      url: `${API_URL}/api/healthz`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "pnpm --dir .. dev:web",
      url: WEB_URL,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
