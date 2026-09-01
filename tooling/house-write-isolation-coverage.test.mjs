import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  houseWritePaths,
  nonHouseMutationRoutes,
  nonHouseWriteExports,
} from './house-write-paths.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mutationExport =
  /export\s+(?:(?:(?:async\s+)?function|const)\s+(?:POST|PUT|PATCH|DELETE)\b|\{[^}]*\b(?:POST|PUT|PATCH|DELETE)\b[^}]*\})/;
const applicationFunctionExport = /export\s+(?:async\s+)?function\s+(\w+)\b/g;

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? filesBelow(path) : [path];
    }),
  );
  return nested.flat();
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

test('[BM-017] every House write export and route has a parametric isolation case', async () => {
  const ids = houseWritePaths.map(({ id }) => id);
  const useCases = houseWritePaths.map(({ useCase }) => useCase);
  const routes = houseWritePaths.map(({ route }) => route);
  assert.equal(new Set(ids).size, ids.length, 'House write IDs must be unique');
  assert.equal(new Set(useCases).size, useCases.length, 'House write use cases must be unique');
  assert.equal(new Set(routes).size, routes.length, 'House write routes must be unique');

  const isolationSource = await readFile(
    resolve(repositoryRoot, 'apps/web/src/server/house-write-isolation.integration.test.ts'),
    'utf8',
  );
  const caseArray = isolationSource.match(/const cases:[\s\S]*?=\s*\[([\s\S]*?)\n\];/);
  assert.ok(caseArray?.[1], 'The integration suite must declare a cases array');
  const coveredIds = [...caseArray[1].matchAll(/\bid:\s*'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(sorted(coveredIds), sorted(ids));
  assert.equal([...caseArray[1].matchAll(/\boutcome:\s*'[^']+'/g)].length, ids.length);
  assert.equal([...caseArray[1].matchAll(/\brun:\s*/g)].length, ids.length);
  assert.match(isolationSource, /it\.each\(cases\)/);

  const moduleIndexes = await Promise.all(
    ['houses', 'seasons'].map((moduleName) =>
      readFile(resolve(repositoryRoot, `packages/application/src/${moduleName}/index.ts`), 'utf8'),
    ),
  );
  const runtimeExports = moduleIndexes
    .flatMap((source) => [...source.matchAll(/export\s*\{([^}]+)\}\s*from/g)])
    .flatMap((match) => match[1].split(','))
    .map((name) => name.trim())
    .filter(Boolean);
  assert.deepEqual(sorted(runtimeExports), sorted([...useCases, ...nonHouseWriteExports]));

  const implementedFunctions = [];
  for (const moduleName of ['houses', 'seasons']) {
    const moduleRoot = resolve(repositoryRoot, `packages/application/src/${moduleName}`);
    for (const path of await filesBelow(moduleRoot)) {
      if (!path.endsWith('.ts') || path.endsWith('.test.ts') || path.endsWith('/index.ts'))
        continue;
      const source = await readFile(path, 'utf8');
      implementedFunctions.push(
        ...[...source.matchAll(applicationFunctionExport)].map((match) => match[1]),
      );
    }
  }
  assert.deepEqual(sorted(implementedFunctions), sorted([...useCases, ...nonHouseWriteExports]));

  const apiRoot = resolve(repositoryRoot, 'apps/web/src/app/api');
  const discoveredMutationRoutes = [];
  for (const path of await filesBelow(apiRoot)) {
    if (!path.endsWith('/route.ts')) continue;
    if (mutationExport.test(await readFile(path, 'utf8'))) {
      discoveredMutationRoutes.push(relative(repositoryRoot, path));
    }
  }
  assert.deepEqual(
    sorted(discoveredMutationRoutes),
    sorted([...routes, ...nonHouseMutationRoutes]),
  );

  for (const { route } of houseWritePaths) {
    const source = await readFile(resolve(repositoryRoot, route), 'utf8');
    assert.match(source, mutationExport, `${route} must remain a mutating route`);
  }
});
