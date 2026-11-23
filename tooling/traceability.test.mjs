import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateCriteria, renderMatrix, runTests } from './traceability.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vitestBin = join(repo, 'apps/web/node_modules/.bin/vitest');
const tag = '[BM-051:AC-2]';
const good = `const r = { status: 429, h: 'retry-after' }; expect(r.status).toBe(429); expect(r.h).toBe('retry-after');`;
const nodeGood = `const r = { status: 429, h: 'retry-after' }; assert.equal(r.status, 429); assert.equal(r.h, 'retry-after');`;
const nodeHead = `import { after, describe, test } from 'node:test'; import assert from 'node:assert/strict';\n`;
const spec = (body) => `import { expect, test } from '@playwright/test';\n${body}`;
const okSpec = 'apps/web/e2e/ok.spec.ts';
const base = {
  'impl.ts': '[BM-051:AC-1] [BM-051:AC-2] [BM-051:AC-3]',
  [okSpec]: spec(
    `test('[BM-051:AC-1] [BM-051:AC-2] [BM-051:AC-3] ok', () => { expect(s).toBe(429); expect(m).toMatch(/Unmapped MISSING/); });`,
  ),
};
// Every row also maps okSpec, which asserts what `requires` asks for, so a case's problems
// come from the file under test alone.
const backing = { path: okSpec, asserts: ['429'] };
const gap = (words) =>
  `no test titled [BM-051:AC-2] that ran asserts ${words} in an expect matcher or assert call. Tag the test that asserts the criterion, or remove the mapping.`;
const skipped = (runner) =>
  `no test titled [BM-051:AC-2] ran and passed under ${runner} (reported skipped).`;
const notReported = (runner) =>
  `no test titled [BM-051:AC-2] ran and passed under ${runner} (not reported).`;
const banned = (line, name) =>
  `line ${line} uses \`${name}\`, which skips, inverts or narrows tests. Remove it.`;

function criteriaFor(tests, requires = ['429']) {
  const row = (id, rowTests, rowRequires) => ({
    id,
    criterion: 'Criterion',
    requires: rowRequires,
    implementation: ['impl.ts'],
    tests: rowTests,
  });
  return [
    row('BM-051:AC-1', [backing], ['429']),
    row('BM-051:AC-2', tests, requires),
    row('BM-051:AC-3', [backing], ['429']),
  ];
}

/** The case's expected problem, alone: an exact string, an anchored regex, or none. */
function assertProblem(problems, path, expected) {
  if (expected === null) return assert.deepEqual(problems, []);
  assert.equal(problems.length, 1, problems.join('\n'));
  const prefix = `BM-051:AC-2 ${path}: `;
  assert.equal(problems[0].slice(0, prefix.length), prefix);
  if (typeof expected === 'string') assert.equal(problems[0].slice(prefix.length), expected);
  else assert.match(problems[0].slice(prefix.length), expected);
}

// Fixture test files that really run, one case per file: [source, expected problem, how].
// A file whose run exits nonzero fails every file in that run, so it runs `alone`. Files the
// check refuses before running (`static`) are not run.
const fx = 'apps/web/src/fx';
const runnerCases = {
  [`${fx}/control-each.test.ts`]: [
    `it.each([[1], [2]])('${tag} row %s', () => { ${good} });`,
    null,
  ],
  [`${fx}/control-options.test.ts`]: [
    `it('${tag} x', { timeout: 5000 }, () => { ${good} });`,
    null,
  ],
  [`${fx}/control-template.test.ts`]: ['it(`' + tag + ' ${"x"}`, () => { ' + good + ' });', null],
  [`${fx}/describe-skip.test.ts`]: [
    `describe.skip('s', () => { it('${tag} x', () => { ${good} }); });`,
    skipped('Vitest'),
  ],
  [`${fx}/describe-skipif.test.ts`]: [
    `describe.skipIf(true)('s', () => { it('${tag} x', () => { ${good} }); });`,
    skipped('Vitest'),
  ],
  [`${fx}/describe-runif.test.ts`]: [
    `describe.runIf(false)('s', () => { it('${tag} x', () => { ${good} }); });`,
    skipped('Vitest'),
  ],
  [`${fx}/describe-tagged.test.ts`]: [
    `const title = '${tag} x'; describe('${tag} s', () => { it(title, () => { ${good} }); });`,
    'no test has [BM-051:AC-2] in its title.',
  ],
  [`${fx}/context-skip.test.ts`]: [
    `it('${tag} x', (ctx) => { ctx.skip(); ${good} });`,
    skipped('Vitest'),
  ],
  [`${fx}/options-skip.test.ts`]: [
    `it('${tag} x', { skip: true }, () => { ${good} });`,
    skipped('Vitest'),
  ],
  [`${fx}/comment-only.test.ts`]: [
    `// ${tag} 429 retry-after\nit('other', () => { ${good} });`,
    'no test has [BM-051:AC-2] in its title.',
  ],
  [`${fx}/only-elsewhere.test.ts`]: [
    `it.only('other', () => {}); it('${tag} x', () => { ${good} });`,
    banned(1, 'only'),
    'static',
  ],
  [`${fx}/only-tagged.test.ts`]: [
    `it.only('${tag} x', () => { ${good} });`,
    banned(1, 'only'),
    'static',
  ],
  [`${fx}/fails.test.ts`]: [
    `it.fails('${tag} x', () => { ${good} });`,
    banned(1, 'fails'),
    'static',
  ],
  [`${fx}/fails-key.test.ts`]: [
    `it('${tag} x', { 'fails': true }, () => { ${good} });`,
    banned(1, 'fails'),
    'static',
  ],
  [`${fx}/each-empty.test.ts`]: [
    `it.each([])('${tag} %s', () => { ${good} });`,
    /^Vitest failed outside a test \(No test suite found in file \/.+\/each-empty\.test\.ts\)\. Fix the run\.$/,
    'alone',
  ],
  [`${fx}/failing.test.ts`]: [
    `it('${tag} x', () => { ${good} }); it('other', () => { expect(1).toBe(2); });`,
    'test "other" failed. Fix the test.',
    'alone',
  ],
  [`${fx}/hook.test.ts`]: [
    `afterAll(() => { throw new Error('hook'); }); it('${tag} x', () => { ${good} });`,
    'Vitest failed outside a test (hook). Fix the run.',
    'alone',
  ],
  [`${fx}/exit.test.ts`]: [
    `it('${tag} x', () => { ${good} });`,
    'Vitest exited with code 3. Fix the run.',
    'exit 3',
  ],
  'tooling/control.test.mjs': [`${nodeHead}test('${tag} x', () => { ${nodeGood} });`, null],
  'tooling/body-skip.test.mjs': [
    `${nodeHead}test('${tag} x', (t) => { t.skip(); ${nodeGood} });`,
    skipped('node:test'),
  ],
  'tooling/options-skip.test.mjs': [
    `${nodeHead}test('${tag} x', { skip: true }, () => { ${nodeGood} });`,
    skipped('node:test'),
  ],
  'tooling/describe-skip.test.mjs': [
    `${nodeHead}describe.skip('s', () => { test('${tag} x', () => { ${nodeGood} }); });`,
    notReported('node:test'),
  ],
  'tooling/subtest-skip.test.mjs': [
    `${nodeHead}test('${tag} x', async (t) => { await t.test('sub', { skip: true }, () => { ${nodeGood} }); });`,
    gap('"429", "retry-after"'),
  ],
  'tooling/assert-message.test.mjs': [
    `${nodeHead}test('${tag} x', () => { assert.ok(true, '429 retry-after'); assert.equal(1, 1, '429'); assert.throws(() => { throw new Error('x'); }, 'retry-after'); assert.match('x', /x/, '429'); });`,
    gap('"429", "retry-after"'),
  ],
  'tooling/hook.test.mjs': [
    `${nodeHead}after(() => { throw new Error('hook'); }); test('${tag} x', () => { ${nodeGood} });`,
    'node:test failed outside a test (file "tooling/hook.test.mjs"). Fix the run.',
    'alone',
  ],
};

const fixtureDir = mkdtempSync(join(tmpdir(), 'traceability-fixtures-'));
after(() => rmSync(fixtureDir, { recursive: true, force: true }));
mkdirSync(join(fixtureDir, fx), { recursive: true });
mkdirSync(join(fixtureDir, 'tooling'), { recursive: true });
writeFileSync(
  join(fixtureDir, 'apps/web/vitest.config.mjs'),
  'export default { test: { globals: true } };',
);
// Writes a report where every test passed, then exits 3.
const fakeVitest = join(fixtureDir, 'fake-vitest.mjs');
writeFileSync(
  fakeVitest,
  `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const outputFile = process.argv.find((arg) => arg.startsWith('--outputFile=')).slice(13);
const location = { line: 1, column: 1 };
const test = { title: '${tag} x', status: 'passed', location };
const file = { name: resolve(process.argv[3]), status: 'passed', assertionResults: [test] };
writeFileSync(outputFile, JSON.stringify({ testResults: [file] }));
process.exit(3);
`,
  { mode: 0o755 },
);
for (const [path, [source]] of Object.entries(runnerCases)) {
  writeFileSync(join(fixtureDir, path), source);
}
const casesRun = (how) => Object.keys(runnerCases).filter((path) => runnerCases[path][2] === how);
const ran = new Map([
  ...runTests(fixtureDir, casesRun(undefined), { vitestBin }),
  ...runTests(fixtureDir, casesRun('exit 3'), { vitestBin: fakeVitest }),
]);
for (const path of casesRun('alone')) {
  for (const entry of runTests(fixtureDir, [path], { vitestBin })) ran.set(...entry);
}

function problemsFor(path, source, asserts = ['429', 'retry-after']) {
  const files = { ...base, [path]: source };
  const rows = evaluateCriteria(
    criteriaFor([{ path, asserts }, backing]),
    (file) => files[file],
    (file) => ran.get(file),
  );
  return rows[1].problems;
}

test('[BM-051:AC-3] unmapped criteria fail and appear in the generated matrix', () => {
  const criteria = criteriaFor([backing]);
  assert.deepEqual(evaluateCriteria(criteria, (path) => base[path])[2].missing, []);
  const absent = evaluateCriteria(criteria, (path) => (path === 'impl.ts' ? base[path] : 'x'));
  assert.deepEqual(absent[2].missing, [okSpec, 'requires 429']);
  assert.match(
    renderMatrix(absent),
    /\| BM-051:AC-3 \|.*\| MISSING: apps\/web\/e2e\/ok\.spec\.ts, requires 429 \|$/m,
  );
  assert.throws(
    () =>
      evaluateCriteria([{ ...criteria[0], implementation: [] }, ...criteria.slice(1)], () => ''),
    { message: 'Unmapped criterion: BM-051:AC-1' },
  );
  assert.throws(() => evaluateCriteria(criteria.slice(1), () => ''), {
    message: 'Unmapped required BM-051 acceptance criterion',
  });
  assert.throws(
    () => evaluateCriteria([{ ...criteria[0], requires: [] }, ...criteria.slice(1)], () => ''),
    { message: 'Invalid criterion BM-051:AC-1: requires needs the words one test must assert' },
  );
});

for (const [path, [source, expected]] of Object.entries(runnerCases)) {
  test(`[BM-051:AC-3] the runner decides whether ${path} ran`, () => {
    assertProblem(problemsFor(path, source), path, expected);
  });
}

test('[BM-051:AC-3] a path no runner handles is refused', () => {
  const path = 'packages/db/src/x.test.ts';
  assertProblem(
    problemsFor(path, `it('${tag} x', () => { ${good} });`),
    path,
    'no runner handles this path. Map a Vitest file (apps/web/src/**/*.test.ts), a node:test file (tooling/*.test.mjs) or a Playwright spec (apps/web/e2e/**/*.spec.ts).',
  );
});

const specPath = 'apps/web/e2e/t.spec.ts';
const specCases = {
  'a plain test inside test.describe counts': [
    `test.describe('s', () => { test('${tag} x', () => { ${good} }); });`,
    null,
  ],
  'test.describe.skip is refused': [
    `test.describe.skip('s', () => { test('${tag} x', () => { ${good} }); });`,
    banned(2, 'skip'),
  ],
  'test.skip() in the body is refused': [
    `test('${tag} x', () => { test.skip(); ${good} });`,
    banned(2, 'skip'),
  ],
  'test.fixme is refused': [`test.fixme('${tag} x', () => { ${good} });`, banned(2, 'fixme')],
  'test.fail is refused': [`test.fail('${tag} x', () => { ${good} });`, banned(2, 'fail')],
  'a test behind a condition does not count': [
    `if (process.env.X) { test('${tag} x', () => { ${good} }); }`,
    notReported('Playwright, read only'),
  ],
};
for (const [name, [body, expected]] of Object.entries(specCases)) {
  test(`[BM-051:AC-3] Playwright spec: ${name}`, () => {
    assertProblem(problemsFor(specPath, spec(body)), specPath, expected);
  });
}

// Assertion words, checked through a read-only Playwright spec so no runner is needed.
const wordCases = {
  'a bare expect without a matcher asserts nothing': [
    `expect(429); expect('retry-after');`,
    ['429', 'retry-after'],
    gap('"429", "retry-after"'),
  ],
  'an expect message is not an assertion': [
    `expect(true, '429 retry-after').toBe(true);`,
    ['429', 'retry-after'],
    gap('"429", "retry-after"'),
  ],
  'matcher and callee names are not words': [
    `expect(JSON.stringify(body)).toBe(x);`,
    ['toBe', 'stringify', 'expect'],
    gap('"toBe", "stringify", "expect"'),
  ],
  'a number matches whole numbers only': [
    `expect(id).toBe('a4290000'); expect(n).toBe(1429); expect(h).toBe('retry-after');`,
    ['429', 'retry-after'],
    gap('"429"'),
  ],
  'not: needs a negated assertion': [
    `expect(s).toBe(429); expect(body).toContain(viewer.userId);`,
    ['429', 'not:userId'],
    gap('"not:userId"'),
  ],
  'a negated assertion satisfies not:': [
    `expect(s).toBe(429); expect(JSON.stringify(body)).not.toContain(viewer.userId);`,
    ['429', 'not:userId'],
    null,
  ],
  'a node:assert call in a Playwright spec is not an assertion': [
    `assert.equal(s, 429); assert.equal(h, 'retry-after');`,
    ['429', 'retry-after'],
    gap('"429", "retry-after"'),
  ],
  'setup and comments are not assertions': [
    `const headers = { 'retry-after': '3' }; expect(status).toBe(429); // retry-after\n`,
    ['429', 'retry-after'],
    gap('"retry-after"'),
  ],
};
for (const [name, [body, asserts, expected]] of Object.entries(wordCases)) {
  test(`[BM-051:AC-3] assertion words: ${name}`, () => {
    const problems = problemsFor(specPath, spec(`test('${tag} x', () => { ${body} });`), asserts);
    assertProblem(problems, specPath, expected);
  });
}

test('[BM-051:AC-3] tokens split across two tagged tests do not count', () => {
  const problems = problemsFor(
    specPath,
    spec(
      `test('${tag} a', () => { expect(s).toBe(429); });\ntest('${tag} b', () => { expect(h).toBe('retry-after'); });`,
    ),
  );
  assertProblem(problems, specPath, gap('"retry-after"'));
});

test('[BM-051:AC-3] one mapped test must assert every word the criterion requires', () => {
  const path = 'apps/web/e2e/limiter.spec.ts';
  const files = {
    ...base,
    [path]: spec(
      `test('${tag} x', () => { expect(denied.retryAfterSeconds).toBeGreaterThan(0); });`,
    ),
  };
  const rows = evaluateCriteria(
    criteriaFor([{ path, asserts: ['retryAfterSeconds'] }], ['429', 'retry-after']),
    (file) => files[file],
  );
  assert.deepEqual(rows[1].missing, ['requires 429, retry-after']);
  assert.deepEqual(rows[1].problems, [
    'BM-051:AC-2: no single mapped test that ran asserts "429", "retry-after", which the criterion requires. Map a test that asserts them.',
  ]);
});
