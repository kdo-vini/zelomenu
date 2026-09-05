import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

// Carrega variáveis de ambiente para credenciais de teste
// .env já está no .gitignore
dotenv.config({ path: path.resolve(import.meta.dirname, '..', '.env') });

const e2eBaseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:3100';
if (/^https:\/\/menu\.zelopdv\.com\.br\/?$/i.test(e2eBaseUrl) && process.env.E2E_ALLOW_PRODUCTION !== 'true') {
  throw new Error('Refusing to run E2E against production. Use staging/local or set E2E_ALLOW_PRODUCTION=true explicitly.');
}

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  retries: 1,
  fullyParallel: true,
  webServer: e2eBaseUrl === 'http://127.0.0.1:3100' ? {
    command: 'npm run dev -- --host 127.0.0.1',
    url: e2eBaseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  } : undefined,
  use: {
    // Aponte a suíte para outro ambiente com E2E_BASE_URL (ex.: http://localhost:3100).
    // Default seguro: localhost. Produção exige E2E_ALLOW_PRODUCTION=true.
    baseURL: e2eBaseUrl,
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: 'chromium-mobile',
      use: {
        browserName: 'chromium',
        viewport: { width: 375, height: 667 },
      },
    },
  ],
});
