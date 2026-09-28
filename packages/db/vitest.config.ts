import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: false,
    fileParallelism: false,
    // Integration hooks repeatedly rebuild the schema on Docker PostgreSQL.
    hookTimeout: 30_000,
  },
});
