import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'server/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'e2e/**', '.claude/**', '**/worktrees/**'],
  },
});
