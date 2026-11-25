import type { Reporter, Suite } from '@playwright/test/reporter';

/** Fails an e2e run that skipped a test or ran none, so a skip cannot pass for a green run. */
export default class EveryTestRanReporter implements Reporter {
  private suite: Suite | undefined;

  onBegin(_config: unknown, suite: Suite): void {
    this.suite = suite;
  }

  async onEnd(): Promise<{ status: 'failed' } | undefined> {
    const tests = this.suite?.allTests() ?? [];
    const skipped = tests.filter((test) => test.outcome() === 'skipped');
    if (tests.length > 0 && skipped.length === 0) return undefined;

    console.error(
      [
        tests.length === 0
          ? 'The e2e run collected no tests.'
          : `The e2e run skipped ${skipped.length} test(s). E2E tests must run, not skip:`,
        ...skipped.map((test) => `  ${test.titlePath().filter(Boolean).join(' > ')}`),
      ].join('\n'),
    );
    return { status: 'failed' };
  }
}
