/** node:test reporter for tooling/traceability.mjs: one JSON line per test that ran or skipped. */
export default async function* report(source) {
  for await (const { type, data } of source) {
    if ((type !== 'test:pass' && type !== 'test:fail') || data.details?.type !== 'test') continue;
    const status =
      type === 'test:fail' ? 'failed' : data.skip ? 'skipped' : data.todo ? 'todo' : 'passed';
    yield `${JSON.stringify({ file: data.file, title: data.name, line: data.line, column: data.column, status })}\n`;
  }
}
