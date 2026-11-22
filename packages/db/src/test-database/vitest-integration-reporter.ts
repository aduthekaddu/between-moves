import { relative } from 'node:path';
import type { Reporter, TestModule, Vitest } from 'vitest/node';
import { integrationProject } from './vitest';

const listedSkips = 20;

/**
 * Fails an integration run that skipped a test or ran none, so `.skip`, `skipIf`
 * or a name filter cannot turn a database suite green without running it.
 */
export default class IntegrationRunReporter implements Reporter {
  private runsIntegration = false;

  onInit(vitest: Vitest): void {
    this.runsIntegration = vitest.projects.some((project) => project.name === integrationProject);
  }

  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    if (!this.runsIntegration) return;
    const tests = testModules
      .filter((testModule) => testModule.project.name === integrationProject)
      .flatMap((testModule) => [...testModule.children.allTests()]);
    const skipped = tests.filter((test) => test.result().state === 'skipped');
    if (tests.length > 0 && skipped.length === 0) return;

    const lines =
      tests.length === 0
        ? ['The integration project ran no tests.']
        : [
            `The integration project skipped ${skipped.length} test(s). Integration tests must run, not skip:`,
            ...skipped
              .slice(0, listedSkips)
              .map(
                (test) => `  ${relative(process.cwd(), test.module.moduleId)} > ${test.fullName}`,
              ),
            ...(skipped.length > listedSkips ? [`  and ${skipped.length - listedSkips} more`] : []),
          ];
    console.error(lines.join('\n'));
    process.exitCode = 1;
  }
}
