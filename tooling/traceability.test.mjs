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
const nodeHead = `import { describe, test } from 'node:test'; import assert from 'node:assert/strict';\n`;
const spec = (body) => `import { expect, test } from '@playwright/test';\n${body}`;
const okSpec = 'apps/web/e2e/ok.spec.ts';
const base = {
  'impl.ts': '[BM-051:AC-1] [BM-051:AC-2] [BM-051:AC-3]',
  [okSpec]: spec(
    `test('[BM-051:AC-1] [BM-051:AC-3] ok', () => { expect(s).toBe(429); expect(m).toMatch(/Unmapped MISSING/); });`,
  ),
};

function criteriaFor(path, asserts = ['429', 'retry-after'], requires = asserts) {
  const other = (id) => ({
    id,
    criterion: 'Other',
    requires: ['429'],
    implementation: ['impl.ts'],
    tests: [{ path: okSpec, asserts: ['429'] }],
  });
  const limits = { id: 'BM-051:AC-2', criterion: 'Limits', requires, implementation: ['impl.ts'] };
  const tests = Array.isArray(path) ? path : [{ path, asserts }];
  return [other('BM-051:AC-1'), { ...limits, tests }, other('BM-051:AC-3')];
}

// Fixture test files that really run under Vitest and node:test, one case per file.
const runnerCases = {
  'apps/fx/control-each.test.ts': [
    `it.each([[1], [2]])('${tag} row %s', () => { ${good} });`,
    null,
  ],
  'apps/fx/control-options.test.ts': [
    `it('${tag} x', { timeout: 5000 }, () => { ${good} });`,
    null,
  ],
  'apps/fx/control-template.test.ts': ['it(`' + tag + ' ${"x"}`, () => { ' + good + ' });', null],
  'apps/fx/describe-skip.test.ts': [
    `describe.skip('s', () => { it('${tag} x', () => { ${good} }); });`,
    /no test titled \[BM-051:AC-2\] ran and passed under Vitest \(reported skipped\)/,
  ],
  'apps/fx/describe-skipif.test.ts': [
    `describe.skipIf(true)('s', () => { it('${tag} x', () => { ${good} }); });`,
    /reported skipped/,
  ],
  'apps/fx/describe-runif.test.ts': [
    `describe.runIf(false)('s', () => { it('${tag} x', () => { ${good} }); });`,
    /reported skipped/,
  ],
  'apps/fx/each-empty.test.ts': [
    `it.each([])('${tag} %s', () => { ${good} });`,
    /ran and passed under Vitest \(not reported\)/,
  ],
  'apps/fx/context-skip.test.ts': [
    `it('${tag} x', (ctx) => { ctx.skip(); ${good} });`,
    /reported skipped/,
  ],
  'apps/fx/options-skip.test.ts': [
    `it('${tag} x', { skip: true }, () => { ${good} });`,
    /reported skipped/,
  ],
  'apps/fx/only-elsewhere.test.ts': [
    `it.only('other', () => {}); it('${tag} x', () => { ${good} });`,
    /line 1 uses `only`/,
  ],
  'apps/fx/only-tagged.test.ts': [`it.only('${tag} x', () => { ${good} });`, /uses `only`/],
  'apps/fx/fails.test.ts': [`it.fails('${tag} x', () => { ${good} });`, /uses `fails`/],
  'apps/fx/comment-only.test.ts': [
    `// ${tag} 429 retry-after\nit('other', () => { ${good} });`,
    /no test has \[BM-051:AC-2\] in its title/,
  ],
  'apps/fx/failing.test.ts': [
    `it('${tag} x', () => { ${good} }); it('other', () => { expect(1).toBe(2); });`,
    /test "other" failed/,
  ],
  'tooling/control.test.mjs': [`${nodeHead}test('${tag} x', () => { ${nodeGood} });`, null],
  'tooling/body-skip.test.mjs': [
    `${nodeHead}test('${tag} x', (t) => { t.skip(); ${nodeGood} });`,
    /ran and passed under node:test \(reported skipped\)/,
  ],
  'tooling/options-skip.test.mjs': [
    `${nodeHead}test('${tag} x', { skip: true }, () => { ${nodeGood} });`,
    /reported skipped/,
  ],
  'tooling/describe-skip.test.mjs': [
    `${nodeHead}describe.skip('s', () => { test('${tag} x', () => { ${nodeGood} }); });`,
    /not reported/,
  ],
};

const fixtureDir = mkdtempSync(join(tmpdir(), 'traceability-fixtures-'));
after(() => rmSync(fixtureDir, { recursive: true, force: true }));
mkdirSync(join(fixtureDir, 'apps/fx'), { recursive: true });
mkdirSync(join(fixtureDir, 'tooling'), { recursive: true });
writeFileSync(
  join(fixtureDir, 'apps/fx/vitest.config.mjs'),
  'export default { test: { globals: true } };',
);
for (const [path, [source]] of Object.entries(runnerCases)) {
  writeFileSync(join(fixtureDir, path), source);
}
const ran = await runTests(fixtureDir, Object.keys(runnerCases), { vitestBin });

function problemsFor(path, source, asserts, requires) {
  const files = { ...base, [path]: source };
  const rows = evaluateCriteria(
    criteriaFor(path, asserts, requires),
    (file) => files[file],
    (file) => ran.get(file),
  );
  return rows[1].problems;
}

test('[BM-051:AC-3] unmapped criteria fail and appear in the generated matrix', () => {
  const criteria = criteriaFor(okSpec, ['429']);
  assert.deepEqual(evaluateCriteria(criteria, (path) => base[path])[2].missing, []);
  const absent = evaluateCriteria(criteria, (path) => (path === 'impl.ts' ? base[path] : 'x'));
  assert.deepEqual(absent[2].missing, [okSpec, 'requires 429']);
  assert.match(renderMatrix(absent), /MISSING: apps\/web\/e2e\/ok.spec.ts/);
  assert.throws(
    () =>
      evaluateCriteria([{ ...criteria[0], implementation: [] }, ...criteria.slice(1)], () => ''),
    /Unmapped criterion/,
  );
  assert.throws(() => evaluateCriteria(criteria.slice(1), () => ''), /Unmapped required/);
  assert.throws(
    () => evaluateCriteria([{ ...criteria[0], requires: [] }, ...criteria.slice(1)], () => ''),
    /requires needs the words/,
  );
});

for (const [path, [source, expected]] of Object.entries(runnerCases)) {
  test(`[BM-051:AC-3] the runner decides whether ${path} ran`, () => {
    const problems = problemsFor(path, source);
    if (expected) assert.match(problems.join('\n'), expected);
    else assert.deepEqual(problems, []);
  });
}

const specCases = {
  'a plain test inside test.describe counts': [
    `test.describe('s', () => { test('${tag} x', () => { ${good} }); });`,
    null,
  ],
  'test.describe.skip is refused': [
    `test.describe.skip('s', () => { test('${tag} x', () => { ${good} }); });`,
    /uses `skip`/,
  ],
  'test.skip() in the body is refused': [
    `test('${tag} x', () => { test.skip(); ${good} });`,
    /uses `skip`/,
  ],
  'test.fixme is refused': [`test.fixme('${tag} x', () => { ${good} });`, /uses `fixme`/],
  'test.fail is refused': [`test.fail('${tag} x', () => { ${good} });`, /uses `fail`/],
  'a test behind a condition does not count': [
    `if (process.env.X) { test('${tag} x', () => { ${good} }); }`,
    /under Playwright, read only \(not reported\)/,
  ],
};
for (const [name, [body, expected]] of Object.entries(specCases)) {
  test(`[BM-051:AC-3] Playwright spec: ${name}`, () => {
    const problems = problemsFor('apps/web/e2e/t.spec.ts', spec(body));
    if (expected) assert.match(problems.join('\n'), expected);
    else assert.deepEqual(problems, []);
  });
}

// Assertion words, checked through a read-only Playwright spec so no runner is needed.
const wordCases = {
  'a bare expect without a matcher asserts nothing': [
    `expect(429); expect('retry-after');`,
    ['429', 'retry-after'],
    /asserts "429", "retry-after" in an expect matcher or assert call/,
  ],
  'an expect message is not an assertion': [
    `expect(true, '429 retry-after').toBe(true);`,
    ['429', 'retry-after'],
    /asserts "429", "retry-after"/,
  ],
  'an assert message is not an assertion': [
    `assert.ok(true, '429 retry-after'); assert.equal(a, b, '429'); assert.throws(f, '429') assert.isTrue(true, '429'); assert.fail('429');`,
    ['429', 'retry-after'],
    /asserts "429", "retry-after"/,
  ],
  'matcher and callee names are not words': [
    `expect(JSON.stringify(body)).toBe(x);`,
    ['toBe', 'stringify', 'expect'],
    /asserts "toBe", "stringify", "expect"/,
  ],
  'a number matches whole numbers only': [
    `expect(id).toBe('a4290000'); expect(n).toBe(1429); expect(h).toBe('retry-after');`,
    ['429', 'retry-after'],
    /asserts "429"/,
  ],
  'not: needs a negated assertion': [
    `expect(s).toBe(429); expect(body).toContain(viewer.userId);`,
    ['429', 'not:userId'],
    /asserts "not:userId"/,
  ],
  'a negated assertion satisfies not:': [
    `expect(s).toBe(429); expect(JSON.stringify(body)).not.toContain(viewer.userId);`,
    ['429', 'not:userId'],
    null,
  ],
  'setup and comments are not assertions': [
    `const headers = { 'retry-after': '3' }; expect(status).toBe(429); // retry-after\n`,
    ['429', 'retry-after'],
    /asserts "retry-after"/,
  ],
};
for (const [name, [body, asserts, expected]] of Object.entries(wordCases)) {
  test(`[BM-051:AC-3] assertion words: ${name}`, () => {
    const problems = problemsFor(
      'apps/web/e2e/t.spec.ts',
      spec(`test('${tag} x', () => { ${body} });`),
      asserts,
    );
    if (expected) assert.match(problems.join('\n'), expected);
    else assert.deepEqual(problems, []);
  });
}

test('[BM-051:AC-3] tokens split across two tagged tests do not count', () => {
  const problems = problemsFor(
    'apps/web/e2e/t.spec.ts',
    spec(
      `test('${tag} a', () => { expect(s).toBe(429); });\ntest('${tag} b', () => { expect(h).toBe('retry-after'); });`,
    ),
  );
  assert.match(problems.join('\n'), /asserts "retry-after"/);
});

test('[BM-051:AC-3] one mapped test must assert every word the criterion requires', () => {
  const files = {
    ...base,
    'apps/web/e2e/limiter.spec.ts': spec(
      `test('${tag} x', () => { expect(denied.retryAfterSeconds).toBeGreaterThan(0); });`,
    ),
  };
  const rows = evaluateCriteria(
    criteriaFor(
      [{ path: 'apps/web/e2e/limiter.spec.ts', asserts: ['retryAfterSeconds'] }],
      undefined,
      ['429', 'retry-after'],
    ),
    (file) => files[file],
  );
  assert.deepEqual(rows[1].missing, ['requires 429, retry-after']);
  assert.match(
    rows[1].problems[0],
    /BM-051:AC-2: no single mapped test that ran asserts "429", "retry-after", which the criterion requires/,
  );
});
