import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateCriteria, renderMatrix } from './traceability.mjs';

const mapped = (path, asserts = ['429']) => ({ path, asserts });
const criteria = [
  { id: 'BM-051:AC-1', criterion: 'Headers', implementation: ['ci.yml'], tests: [mapped('a.ts')] },
  { id: 'BM-051:AC-2', criterion: 'Limits', implementation: ['ci.yml'], tests: [mapped('a.ts')] },
  { id: 'BM-051:AC-3', criterion: 'CI gates', implementation: ['ci.yml'], tests: [mapped('t.ts')] },
];
const everyTag = criteria.map((row) => `[${row.id}]`).join(' ');

function problemsFor(testSource, asserts = ['429', 'retry-after'], path = 't.ts') {
  const rows = evaluateCriteria(
    [criteria[0], { ...criteria[1], tests: [mapped(path, asserts)] }, criteria[2]],
    (file) =>
      file === path ? testSource : `${everyTag} test('${everyTag}', () => { expect(429); });`,
  );
  return rows[1];
}

test('[BM-051:AC-3] unmapped criteria fail and appear in the generated matrix', () => {
  const rows = evaluateCriteria(criteria, (path) =>
    path === 'ci.yml' ? everyTag : `test('${everyTag}', () => { expect(status).toBe(429); });`,
  );
  assert.deepEqual(rows[2].missing, []);
  const absent = evaluateCriteria(criteria, (path) => (path === 'ci.yml' ? everyTag : 'no marker'));
  assert.deepEqual(absent[2].missing, ['t.ts']);
  assert.match(renderMatrix(absent), /MISSING: t.ts/);
  assert.throws(
    () =>
      evaluateCriteria([{ ...criteria[0], implementation: [] }, ...criteria.slice(1)], () => ''),
    /Unmapped criterion/,
  );
  assert.throws(() => evaluateCriteria(criteria.slice(1), () => ''), /Unmapped required/);
});

test('[BM-051:AC-3] a mapped test needs a running test titled with the tag', () => {
  const comment = problemsFor(
    `// [BM-051:AC-2] covers 429 and retry-after\ntest('other', () => { expect(429); });`,
  );
  assert.match(comment.problems[0], /no running test has \[BM-051:AC-2\] in its title/);
  assert.match(
    comment.problems[0],
    /Tag the test that asserts the criterion, or remove the mapping\./,
  );

  const skipped = problemsFor(
    `test.skip('[BM-051:AC-2] x', () => { expect(a).toBe(429); expect(b).toBe('retry-after'); });`,
  );
  assert.match(skipped.problems[0], /no running test has/);

  const tagged = `test('[BM-051:AC-2] limits', () => { expect(status).toBe(429); expect(header).toBe('Retry-After'); });`;
  assert.deepEqual(problemsFor(tagged).missing, []);
});

test('[BM-051:AC-3] a tagged test must assert every token inside expect or assert', () => {
  const noHeader = problemsFor(
    `test('[BM-051:AC-2] limits', () => { expect(status).toBe(429); });`,
  );
  assert.match(noHeader.problems[0], /asserts "retry-after" in an expect or assert call/);

  const setupOnly = problemsFor(
    `test('[BM-051:AC-2] limits', () => { const headers = { 'retry-after': '3' }; expect(status).toBe(429); // retry-after\n });`,
  );
  assert.match(setupOnly.problems[0], /asserts "retry-after"/);

  const otherTest = problemsFor(
    `test('[BM-051:AC-2] a', () => { expect(status).toBe(429); });\n` +
      `test('[BM-051:AC-2] b', () => { expect(header).toBe('retry-after'); });`,
  );
  assert.match(otherTest.problems[0], /asserts "retry-after"/);
});

test('[BM-051:AC-3] it.each, template titles, TSX and node:test asserts count as tests', () => {
  const each = `it.each([[1]])('[BM-051:AC-2] %s', (n) => { expect(r.status).toBe(429); expect(r.headers.get('retry-after')).toBe(n); });`;
  assert.deepEqual(problemsFor(each).missing, []);
  const template =
    'it(`[BM-051:AC-2] ${name}`, async () => { await expect(r).resolves.toMatchObject({ status: 429, retryAfter: "retry-after" }); });';
  assert.deepEqual(problemsFor(template).missing, []);
  const node = `test('[BM-051:AC-2] x', () => { assert.equal(r.status, 429); assert.equal(h, 'retry-after'); });`;
  assert.deepEqual(problemsFor(node).missing, []);
  const tsx = `it('[BM-051:AC-2] x', () => { render(<b />); expect(r.status).toBe(429); expect(h).toBe('retry-after'); });`;
  assert.deepEqual(problemsFor(tsx, ['429', 'retry-after'], 't.tsx').missing, []);
});
