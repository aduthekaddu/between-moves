import { fileURLToPath } from 'node:url';
import { createDatabase } from './database';
import { migrateDown, migrateUp } from './migrations';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const direction = process.argv[2];
if (direction !== 'up' && direction !== 'down') {
  throw new Error('Migration direction must be "up" or "down"');
}
if (direction === 'down' && process.env.APP_ENV === 'production') {
  throw new Error('Production migrations are forward-only');
}

const database = createDatabase(connectionString);
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));

try {
  const changed =
    direction === 'up'
      ? await migrateUp(database.pool, { migrationsDirectory })
      : await migrateDown(database.pool, { migrationsDirectory });
  console.info(JSON.stringify({ event: `db.migration-${direction}`, changed }));
} finally {
  await database.close();
}
