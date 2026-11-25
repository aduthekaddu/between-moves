import { defineConfig } from 'vitest/config';
import { databaseTestProjects } from './src/test-database/vitest';

export default defineConfig({
  test: {
    environment: 'node',
    passWithNoTests: false,
    fileParallelism: false,
    // Integration hooks repeatedly rebuild the schema on Docker PostgreSQL.
    hookTimeout: 30_000,
    ...databaseTestProjects(['src/**/*.test.ts']),
  },
});
