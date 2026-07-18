import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

// Carrega variáveis de ambiente para credenciais de teste
// .env já está no .gitignore
dotenv.config({ path: path.resolve(import.meta.dirname, '..', '.env') });

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  retries: 1,
  fullyParallel: true,
  use: {
    // Aponte a suíte para outro ambiente com E2E_BASE_URL (ex.: http://localhost:3100).
    // Default: produção.
    baseURL: process.env.E2E_BASE_URL || 'https://menu.zelopdv.com.br',
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
