import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateCriteria, renderMatrix } from './traceability.mjs';

test('[BM-051:AC-3] unmapped criteria fail and appear in the generated matrix', () => {
  const criteria = [
    { id: 'BM-051:AC-1', criterion: 'Headers', implementation: ['ci.yml'], tests: ['ci.yml'] },
    { id: 'BM-051:AC-2', criterion: 'Limits', implementation: ['ci.yml'], tests: ['ci.yml'] },
    { id: 'BM-051:AC-3', criterion: 'CI gates', implementation: ['ci.yml'], tests: ['test.mjs'] },
  ];
  const rows = evaluateCriteria(criteria, (path) =>
    path === 'ci.yml' ? criteria.map((row) => `[${row.id}]`).join(' ') : 'no marker',
  );
  assert.deepEqual(rows[2].missing, ['test.mjs']);
  assert.match(renderMatrix(rows), /MISSING: test.mjs/);
  assert.throws(
    () =>
      evaluateCriteria([{ ...criteria[0], implementation: [] }, ...criteria.slice(1)], () => ''),
    /Unmapped criterion/,
  );
  assert.throws(() => evaluateCriteria(criteria.slice(1), () => ''), /Unmapped required/);
});
