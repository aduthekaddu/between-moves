import { defineConfig } from 'vitest/config';
import { databaseTestProjects } from '@between-moves/db/test-database/vitest';

export default defineConfig({
  test: {
    environment: 'node',
    // PostgreSQL integration files migrate the same CI database and must not overlap.
    fileParallelism: false,
    // Integration hooks rebuild the full schema (down + up) and can exceed 10s on Docker.
    hookTimeout: 30_000,
    ...databaseTestProjects(['**/*.test.{ts,tsx}']),
  },
});
