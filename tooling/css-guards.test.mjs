import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkBase, checkCss } from './css-guards.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const messages = (css) => checkCss(css).map((violation) => violation.message);

describe('phone and touch CSS guards', () => {
  it('rejects a field under 16px and names the fix (landing door field, bf65de5)', () => {
    const found = messages('.lp-door__field input { font-size: 0.95rem; }');
    assert.equal(found.length, 1);
    assert.match(found[0], /under 16px/);
    assert.match(found[0], /max\(1rem, 1em\)/);
  });

  it('rejects an em size that follows a small label (night host field, bf65de5)', () => {
    assert.equal(
      messages('.night-host label > :is(input, select) { font-size: 0.85em; }').length,
      1,
    );
    assert.equal(messages('textarea { font-size: 13px; }').length, 1);
  });

  it('rejects a font shorthand that resets a field size', () => {
    assert.equal(messages('.auth-form__field input { font: inherit; }').length, 1);
  });

  it('allows the reset on bare tags and sizes of 1rem or more', () => {
    assert.deepEqual(
      messages('button, input, select, textarea { font: inherit; color: inherit; }'),
      [],
    );
    assert.deepEqual(messages('.a input { font-size: 1rem; }'), []);
    assert.deepEqual(messages('.a input { font-size: 17px; }'), []);
    assert.deepEqual(messages('input, select, textarea { font-size: max(1rem, 1em); }'), []);
    assert.deepEqual(messages('.a input { font-size: clamp(1rem, 4vw, 1.2rem); }'), []);
  });

  it('ignores labels, checkboxes and classes it cannot tell are fields', () => {
    assert.deepEqual(messages('.night-edit label { font-size: 0.85rem; }'), []);
    assert.deepEqual(messages('input[type="checkbox"] { font-size: 12px; }'), []);
    assert.deepEqual(messages('.input-hint { font-size: 12px; }'), []);
  });

  it('rejects a control under 24px tall', () => {
    for (const css of [
      '.x button { height: 19px; }',
      '.x summary { min-height: 12px; }',
      'select { max-height: 20px; }',
      '[role="button"] { block-size: 1rem; }',
    ]) {
      const found = messages(css);
      assert.equal(found.length, 1, css);
      assert.match(found[0], /under 24px/);
      assert.match(found[0], /--target-size/);
    }
  });

  it('allows controls of 24px or more, and radio or checkbox boxes', () => {
    assert.deepEqual(messages('.x button { min-height: 44px; }'), []);
    assert.deepEqual(messages('.x summary { height: 24px; }'), []);
    assert.deepEqual(messages('.invite-kind input { width: 18px; height: 18px; }'), []);
  });

  it('reads rules inside media queries, with comments and line numbers', () => {
    const css =
      '/* a { font-size: 9px } */\n@media (max-width: 860px) {\n  .a input {\n    font-size: 0.9rem;\n  }\n}\n';
    const found = checkCss(css);
    assert.equal(found.length, 1);
    assert.equal(found[0].line, 4);
  });

  it('fails the base file when a floor is gone', () => {
    const floors =
      'input, select, textarea { font-size: max(1rem, 1em); }\n:where(button, summary) { min-block-size: var(--target-size); }';
    assert.deepEqual(checkBase(floors), []);
    assert.equal(
      checkBase(':where(button, summary) { min-block-size: var(--target-size); }').length,
      1,
    );
    assert.equal(checkBase('input, select, textarea { font-size: max(1rem, 1em); }').length, 1);
  });

  it('passes the repo stylesheets', () => {
    const base = readFileSync(join(root, 'apps/web/src/app/globals.css'), 'utf8');
    assert.deepEqual(checkBase(base), []);
    assert.deepEqual(checkCss(base), []);
  });
});
