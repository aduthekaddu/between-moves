import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.{ts,tsx}'],
    // PostgreSQL integration files migrate the same CI database and must not overlap.
    fileParallelism: false,
  },
});
