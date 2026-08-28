import { defineConfig } from 'drizzle-kit';
import { assertTlsDatabaseUrl } from './src/database';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required to run Drizzle Kit');
assertTlsDatabaseUrl(url);

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations/generated',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
