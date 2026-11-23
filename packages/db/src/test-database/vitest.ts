import { fileURLToPath } from 'node:url';
import { configDefaults, type TestProjectInlineConfiguration } from 'vitest/config';

export const integrationProject = 'integration';
const integrationTestFiles = '**/*.integration.test.{ts,tsx}';
const integrationSetup = fileURLToPath(new URL('./vitest-global-setup.ts', import.meta.url));
const integrationReporter = fileURLToPath(
  new URL('./vitest-integration-reporter.ts', import.meta.url),
);

/**
 * Splits a package's tests by file name. `unit` never needs PostgreSQL.
 * `integration` checks the test database once before it collects a file, and fails a run that
 * skips a test. Run each with `vitest run --project <name>`.
 */
export function databaseTestProjects(include: string[]): {
  projects: TestProjectInlineConfiguration[];
  reporters: string[];
} {
  return {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include,
          exclude: [...configDefaults.exclude, integrationTestFiles],
        },
      },
      {
        extends: true,
        test: {
          name: integrationProject,
          include: [integrationTestFiles],
          globalSetup: [integrationSetup],
        },
      },
    ],
    reporters: ['default', integrationReporter],
  };
}
