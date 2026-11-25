import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

export const fix =
  'Write the change as a numbered SQL migration in packages/db/migrations/NNNN_name/. Migrations are the only schema; no ORM schema, config or generator may mirror them.';

const ormPackages = ['drizzle-orm', 'drizzle-kit'];
const dependencyFields = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];
const generatorScripts = ['db:generate', 'schema:generate'];
const skippedDirectories = new Set(['node_modules', '.git', 'dist', '.next', '.turbo', 'coverage']);
const ormDeclaration = /from\s+['"]drizzle-orm(?:\/[^'"]*)?['"]|\bpgTable\s*\(/;

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return skippedDirectories.has(entry.name) ? [] : walk(path);
      return [path];
    }),
  );
  return nested.flat();
}

/** Returns one message per place that brings back a second copy of the schema. */
export async function findSchemaCopies(root) {
  const problems = [];
  const files = [
    ...(await walk(join(root, 'packages'))),
    ...(await walk(join(root, 'apps'))),
    join(root, 'package.json'),
  ];
  for (const file of files) {
    const name = relative(root, file);
    const base = basename(file);
    if (/^drizzle\.config\./.test(base)) {
      problems.push(`${name}: Drizzle config file`);
    } else if (base === 'package.json') {
      const manifest = JSON.parse(await readFile(file, 'utf8'));
      for (const field of dependencyFields) {
        for (const pkg of ormPackages) {
          if (manifest[field]?.[pkg] !== undefined) problems.push(`${name}: ${field} lists ${pkg}`);
        }
      }
      for (const [script, command] of Object.entries(manifest.scripts ?? {})) {
        if (generatorScripts.includes(script) || ormPackages.some((pkg) => command.includes(pkg))) {
          problems.push(`${name}: script "${script}" generates or reads an ORM schema`);
        }
      }
    } else if (/\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/.test(base)) {
      if (ormDeclaration.test(await readFile(file, 'utf8'))) {
        problems.push(`${name}: Drizzle table declarations or imports`);
      }
    }
  }
  return problems;
}
