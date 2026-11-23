import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it } from 'node:test';
import { findSchemaCopies, fix } from './migrations-only-schema.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = [];

async function scratchRoot(files) {
  const root = await mkdtemp(join(tmpdir(), 'bm-schema-copy-'));
  scratch.push(root);
  await writeFile(join(root, 'package.json'), '{"scripts":{}}');
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('migrations are the only schema', () => {
  it('finds no Drizzle dependency, config, table file or generator script in the repository', async () => {
    const problems = await findSchemaCopies(repositoryRoot);
    assert.deepEqual(problems, [], `${problems.join('\n')}\n${fix}`);
  });

  it('rejects a package that depends on drizzle-orm or drizzle-kit', async () => {
    const root = await scratchRoot({
      'packages/db/package.json': JSON.stringify({
        dependencies: { 'drizzle-orm': '0.45.2' },
        devDependencies: { 'drizzle-kit': '0.31.10' },
      }),
    });
    assert.deepEqual(await findSchemaCopies(root), [
      'packages/db/package.json: dependencies lists drizzle-orm',
      'packages/db/package.json: devDependencies lists drizzle-kit',
    ]);
  });

  it('rejects a drizzle.config file', async () => {
    const root = await scratchRoot({ 'packages/db/drizzle.config.ts': 'export default {};' });
    assert.deepEqual(await findSchemaCopies(root), [
      'packages/db/drizzle.config.ts: Drizzle config file',
    ]);
  });

  it('rejects a table declaration file', async () => {
    const root = await scratchRoot({
      'packages/db/src/schema.ts':
        "import { pgTable, text } from 'drizzle-orm/pg-core';\nexport const houses = pgTable('houses', { id: text('id') });",
    });
    assert.deepEqual(await findSchemaCopies(root), [
      'packages/db/src/schema.ts: Drizzle table declarations or imports',
    ]);
  });

  it('rejects a db:generate or schema:generate script', async () => {
    const root = await scratchRoot({
      'packages/db/package.json': JSON.stringify({
        scripts: { 'schema:generate': 'node gen.js', 'db:generate': 'node gen.js' },
      }),
    });
    assert.deepEqual(await findSchemaCopies(root), [
      'packages/db/package.json: script "schema:generate" generates or reads an ORM schema',
      'packages/db/package.json: script "db:generate" generates or reads an ORM schema',
    ]);
  });

  it('names the fix', () => {
    assert.match(fix, /numbered SQL migration/);
    assert.match(fix, /Migrations are the only schema/);
  });
});
