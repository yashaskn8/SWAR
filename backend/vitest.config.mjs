import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'tests/**/*.spec.ts', 'tests/**/*.e2e-spec.ts'],
    testTimeout: 10_000,
  },
});
