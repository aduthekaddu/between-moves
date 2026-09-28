import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.{ts,tsx}'],
    // PostgreSQL integration files migrate the same CI database and must not overlap.
    fileParallelism: false,
    // Integration hooks rebuild the full schema (down + up) and can exceed 10s on Docker.
    hookTimeout: 30_000,
  },
});
