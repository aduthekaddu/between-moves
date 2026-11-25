/**
 * node:test reporter for tooling/traceability.mjs: one JSON line per test, suite or file-level
 * hook result. `kind` is `test` for a test, `suite` for a suite, and absent for a hook.
 */
export default async function* report(source) {
  for await (const { type, data } of source) {
    if (type !== 'test:pass' && type !== 'test:fail') continue;
    const status =
      type === 'test:fail' ? 'failed' : data.skip ? 'skipped' : data.todo ? 'todo' : 'passed';
    const { file, name: title, line, column } = data;
    yield `${JSON.stringify({ file, kind: data.details?.type, title, line, column, status })}\n`;
  }
}
