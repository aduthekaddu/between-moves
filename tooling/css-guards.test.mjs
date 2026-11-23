import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BASE_RULES, checkBase, checkCss } from './css-guards.mjs';

const messages = (css) => checkCss(css).map((violation) => violation.message);
const base = BASE_RULES.join('\n');

describe('field font size', () => {
  it('rejects a field under 16px and names the fix (landing door field, bf65de5)', () => {
    const found = messages('.lp-door__field input { font-size: 0.95rem; }');
    assert.equal(found.length, 1);
    assert.match(found[0], /under 16px/);
    assert.match(found[0], /max\(1rem, 1em\)/);
  });

  it('rejects any value it cannot prove is 1rem or more', () => {
    for (const value of [
      '0.85em',
      '13px',
      '0',
      'auto',
      'inherit',
      'small',
      '90%',
      'calc(1rem - 2px)',
      'var(--field-size)',
      'max(0.9rem, 12px)',
      'clamp(0.8rem, 4vw, 1.2rem)',
      '-1rem',
    ]) {
      assert.equal(messages(`.x select { font-size: ${value}; }`).length, 1, value);
    }
  });

  it('allows sizes it can prove are 1rem or more', () => {
    for (const value of [
      '1rem',
      '17px',
      'max(1rem, 1em)',
      'clamp(1rem, 4vw, 1.2rem)',
      '1rem !important',
    ])
      assert.deepEqual(messages(`.a input { font-size: ${value}; }`), [], value);
  });

  it('reads the whole selector, so :is(), :not(), :has() and pseudo-elements count', () => {
    for (const selector of [
      '.night-host label > :is(input, select)',
      'input:not([type="checkbox"])',
      'button:not(textarea)',
      '.field:has(input)',
      'input::placeholder',
      'TEXTAREA',
    ]) {
      assert.equal(messages(`${selector} { font-size: 12px; }`).length, 1, selector);
    }
  });

  it('ignores selectors that name no field', () => {
    assert.deepEqual(messages('.night-edit label { font-size: 0.85rem; }'), []);
    assert.deepEqual(
      messages('.input-hint, #select, [data-kind="input"] { font-size: 12px; }'),
      [],
    );
  });

  it('rejects any font shorthand on a field, the bare reset included outside the base file', () => {
    assert.equal(messages('.auth-form__field input { font: inherit; }').length, 1);
    assert.equal(messages('input { font: inherit; }').length, 1);
    assert.equal(messages(BASE_RULES[0]).length, 1);
    assert.deepEqual(checkCss(base, { isBase: true }), []);
  });

  it('rejects a second copy of a base rule in the base file', () => {
    assert.equal(checkCss(`${base}\n${BASE_RULES[0]}`, { isBase: true }).length, 1);
  });

  it('rejects --target-size outside the base rule', () => {
    assert.equal(messages('.night-card { --target-size: 12px; }').length, 1);
    assert.equal(messages(':root { --target-size: 24px; }').length, 1);
  });
});

describe('what the parser reads', () => {
  it('reads rules inside @media, with comments and line numbers', () => {
    const css =
      '/* a input { font-size: 9px } */\n@media (max-width: 860px) {\n  .a input {\n    font-size: 0.9rem;\n  }\n}\n';
    const found = checkCss(css);
    assert.equal(found.length, 1);
    assert.equal(found[0].line, 4);
  });

  it('rejects nested rules and unknown at-rules instead of skipping them', () => {
    for (const css of [
      '.auth-form__field { input { font-size: 12px; } }',
      '.x input { @media (max-width: 600px) { font-size: 12px; } }',
      '.x { color: red; &:hover { color: blue; } }',
      '@document url-prefix() { input { font-size: 12px; } }',
    ]) {
      const found = messages(css);
      assert.equal(found.length, 1, css);
      assert.match(found[0], /does not read/);
    }
  });

  it('skips @keyframes and @font-face', () => {
    assert.deepEqual(messages('@keyframes a { from { opacity: 0; } to { opacity: 1; } }'), []);
    assert.deepEqual(messages('@font-face { font-family: x; src: url(x.woff2); }'), []);
  });
});

describe('base rules', () => {
  it('passes the base rules in order', () => {
    assert.deepEqual(checkBase(base), []);
    assert.deepEqual(checkBase(BASE_RULES.join('\n\n/* note */\n.other { color: red; }\n')), []);
  });

  it('fails when any base rule is gone, changed or out of order', () => {
    const changed = [
      (rules) => rules.slice(1),
      (rules) => rules.with(1, 'textarea { font-size: max(1rem, 1em); }'),
      (rules) => rules.with(1, '.foo input, select, textarea { font-size: max(1rem, 1em); }'),
      (rules) => rules.with(2, ':root { --target-size: 12px; }'),
      (rules) => rules.with(3, rules[3].replace('summary, ', '')),
      (rules) => rules.with(3, rules[3].replace('min-inline-size: var(--target-size); ', '')),
      (rules) => [rules[1], rules[0], ...rules.slice(2)],
      (rules) => [`@media (min-width: 1px) { ${rules[1]} }`, ...rules.filter((_, i) => i !== 1)],
    ];
    for (const change of changed) {
      const found = checkBase(change(BASE_RULES).join('\n'));
      assert.equal(found.length, 1, change.toString());
      assert.match(found[0].message, /BASE_RULES/);
    }
  });
});
