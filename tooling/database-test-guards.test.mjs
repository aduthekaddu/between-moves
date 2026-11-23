import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ESLint } from 'eslint';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const skippedDirectories = new Set(['node_modules', 'dist', '.next', 'coverage', '.turbo']);
const integrationTestFile = /\.integration\.test\.[cm]?[jt]sx?$/;

function integrationTestFilesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return skippedDirectories.has(entry.name) ? [] : integrationTestFilesBelow(path);
    }
    return integrationTestFile.test(entry.name) ? [path] : [];
  });
}

function workspacePackages() {
  return ['apps', 'packages'].flatMap((group) =>
    readdirSync(join(root, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(group, entry.name)),
  );
}

function hasIntegrationProject(packageDirectory) {
  const { scripts = {} } = JSON.parse(
    readFileSync(join(root, packageDirectory, 'package.json'), 'utf8'),
  );
  const vitestConfig = join(root, packageDirectory, 'vitest.config.ts');
  return (
    scripts.test === 'vitest run --project unit' &&
    scripts['test:integration'] === 'vitest run --project integration' &&
    existsSync(vitestConfig) &&
    readFileSync(vitestConfig, 'utf8').includes('databaseTestProjects(')
  );
}

describe('database tests cannot pass by skipping', () => {
  it('runs every *.integration.test file in a package that has the integration project', () => {
    const packagesWithIntegrationTests = workspacePackages().filter(
      (packageDirectory) => integrationTestFilesBelow(join(root, packageDirectory)).length > 0,
    );
    assert.ok(
      packagesWithIntegrationTests.includes('packages/db'),
      'found no db integration tests',
    );

    for (const packageDirectory of packagesWithIntegrationTests) {
      assert.ok(
        hasIntegrationProject(packageDirectory),
        `${packageDirectory} has ${relative(root, integrationTestFilesBelow(join(root, packageDirectory))[0])}, but its tests have no integration project, so that file would run in \`pnpm test\` without PostgreSQL. Spread \`databaseTestProjects\` from @between-moves/db/test-database/vitest into ${packageDirectory}/vitest.config.ts and copy the \`test\` and \`test:integration\` scripts from packages/db/package.json.`,
      );
    }
  });

  const routeArounds = {
    'a conditional describe': `
      import { describe, it } from 'vitest';
      const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
      suite('repository', () => { it('saves', () => {}); });
    `,
    'tests registered inside an if': `
      import { test } from '@playwright/test';
      test('always runs', () => {});
      if (process.env['TEST_DATABASE_URL']) { test('needs the database', () => {}); }
    `,
    'a destructured environment read': `
      const { TEST_RUNTIME_DATABASE_URL } = process.env;
      export const url = TEST_RUNTIME_DATABASE_URL;
    `,
  };

  const lintTargets = [
    { config: 'eslint.config.mjs', file: 'packages/db/src/example.test.ts' },
    { config: 'eslint.config.mjs', file: 'packages/adapters/src/example.test.ts' },
    { config: 'apps/web/eslint.config.mjs', file: 'apps/web/src/server/example.test.ts' },
    { config: 'apps/web/eslint.config.mjs', file: 'apps/web/e2e/example.spec.ts' },
  ];

  async function errorsFor(config, file, source) {
    const eslint = new ESLint({
      cwd: dirname(join(root, config)),
      overrideConfigFile: join(root, config),
    });
    const [result] = await eslint.lintText(source, { filePath: join(root, file) });
    return result.messages.filter((message) => message.ruleId === 'no-restricted-syntax');
  }

  for (const { config, file } of lintTargets) {
    for (const [routeAround, source] of Object.entries(routeArounds)) {
      it(`rejects ${routeAround} in ${file}, naming requireTestDatabaseUrl`, async () => {
        const errors = await errorsFor(config, file, source);
        assert.ok(errors.length > 0, `${config} allowed ${routeAround} in ${file}`);
        for (const error of errors) assert.match(error.message, /requireTestDatabaseUrl/);
      });
    }
  }

  it('lets the test database module read the environment', async () => {
    const source = readFileSync(join(root, 'packages/db/src/test-database/index.ts'), 'utf8');
    assert.match(source, /TEST_DATABASE_URL/);
    assert.deepEqual(
      await errorsFor('eslint.config.mjs', 'packages/db/src/test-database/index.ts', source),
      [],
    );
  });
});
