// Source checks for the phone rules in apps/web CSS. It proves two things from the text:
//   1. apps/web/src/app/globals.css still holds the base rules, unchanged and in order:
//      fields at max(1rem, 1em) and a 24px --target-size floor on every control.
//   2. No rule whose selector names input, select or textarea (anywhere, :not() and :has()
//      included) sets a font-size it cannot prove is 16px or more, or a font shorthand,
//      and no rule outside the base sets --target-size.
// It cannot see a class on a field, padding, layout or covers. apps/web/e2e/phone-touch.spec.ts
// measures those in a browser. Nested rules and unknown at-rules fail, because it does not
// read them.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const MIN_FIELD_FONT_PX = 16;
export const BASE_FILE = 'apps/web/src/app/globals.css';

/** The base rules, in order. Change globals.css and this list in the same commit. */
export const BASE_RULES = [
  'button, input, select, textarea { font: inherit; color: inherit; }',
  'input, select, textarea { font-size: max(1rem, 1em); }',
  ':root { --target-size: 24px; }',
  `:where(button, summary, select, textarea, [role='button'], input:not([type='checkbox'], [type='radio'], [type='hidden'])) { min-block-size: var(--target-size); min-inline-size: var(--target-size); }`,
];

const FIELD_FIX = `Fields must be at least 1rem so iOS does not zoom. Delete this declaration; globals.css sets "input, select, textarea { font-size: max(1rem, 1em) }" for every field.`;
const WALKED = /^@(media|supports|container|layer|starting-style)\b/i;
const SKIPPED =
  /^@(keyframes|font-face|property|page|counter-style|font-feature-values|font-palette-values|view-transition)\b/i;
const FIELD = /(?<![\w\-.#[:"'=])(input|select|textarea)(?![\w-])/i;

function blankComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '));
}

const lineAt = (text, index) => text.slice(0, index).split('\n').length;
const squash = (text) =>
  text
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,()])\s*/g, '$1')
    .replace(/;?}$/, ';}')
    .trim();

/**
 * Style rules in source order, descending into conditional at-rules.
 * Yields { selector, declarations, line, text, topLevel } or { error, line }.
 */
export function* parseRules(source) {
  const text = blankComments(source);
  function* walk(from, to, topLevel) {
    let index = from;
    while (index < to) {
      const open = text.indexOf('{', index);
      const semicolon = text.indexOf(';', index);
      if (open === -1 || open >= to) return;
      if (semicolon !== -1 && semicolon < open) {
        index = semicolon + 1;
        continue;
      }
      let depth = 1;
      let close = open + 1;
      while (close < to && depth > 0) {
        if (text[close] === '{') depth += 1;
        else if (text[close] === '}') depth -= 1;
        close += 1;
      }
      const header = text.slice(index, open).trim();
      const line = lineAt(text, index + text.slice(index, open).search(/\S/));
      const body = text.slice(open + 1, close - 1);
      if (header.startsWith('@')) {
        if (WALKED.test(header)) yield* walk(open + 1, close - 1, false);
        else if (!SKIPPED.test(header)) yield { error: `${header} is an at-rule`, line };
      } else if (body.includes('{')) {
        yield { error: `${header} holds a nested rule`, line };
      } else {
        const declarations = [];
        let paren = 0;
        let start = 0;
        for (let i = 0; i <= body.length; i += 1) {
          const char = body[i];
          if (char === '(') paren += 1;
          else if (char === ')') paren -= 1;
          else if ((char === ';' && paren === 0) || i === body.length) {
            const piece = body.slice(start, i);
            const colon = piece.indexOf(':');
            if (colon !== -1) {
              declarations.push({
                property: piece.slice(0, colon).trim().toLowerCase(),
                value: piece
                  .slice(colon + 1)
                  .trim()
                  .replace(/\s*!important$/i, ''),
                line: lineAt(text, open + 1 + start + piece.search(/\S/)),
              });
            }
            start = i + 1;
          }
        }
        yield {
          selector: header,
          declarations,
          line,
          text: squash(`${header}{${body}}`),
          topLevel,
        };
      }
      index = close;
    }
  }
  yield* walk(0, text.length, true);
}

export function toPx(value) {
  const match = /^(\d*\.?\d+)(px|rem)$/i.exec(value.trim());
  if (match === null) return null;
  return Number(match[1]) * (match[2].toLowerCase() === 'rem' ? 16 : 1);
}

function args(inner) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= inner.length; i += 1) {
    const char = inner[i];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if ((char === ',' && depth === 0) || i === inner.length) {
      parts.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  return parts;
}

/** True only when `value` can never compute below `minimum` px. Anything else is unsafe. */
export function atLeast(value, minimum) {
  const px = toPx(value);
  if (px !== null) return px >= minimum;
  const call = /^(max|clamp)\((.*)\)$/is.exec(value.trim());
  if (call === null) return false;
  const list = args(call[2]);
  return call[1].toLowerCase() === 'max'
    ? list.some((arg) => atLeast(arg, minimum))
    : list.length === 3 && atLeast(list[0], minimum);
}

/** Violations in one stylesheet: { line, message }. Only the base file may hold each base rule, once. */
export function checkCss(source, { isBase = false } = {}) {
  const violations = [];
  const base = new Set(isBase ? BASE_RULES.map(squash) : []);
  for (const rule of parseRules(source)) {
    if ('error' in rule) {
      violations.push({
        line: rule.line,
        message: `${rule.error}, which lint:css does not read. Write it as a flat rule, or inside @media, @supports, @container or @layer.`,
      });
      continue;
    }
    if (rule.topLevel && base.delete(rule.text)) continue;
    const field = FIELD.test(rule.selector);
    for (const { property, value, line } of rule.declarations) {
      if (field && property === 'font-size' && !atLeast(value, MIN_FIELD_FONT_PX)) {
        violations.push({
          line,
          message: `${rule.selector} { font-size: ${value} } may set a field under ${MIN_FIELD_FONT_PX}px. Only px, rem, max() or clamp() at 1rem or more count. ${FIELD_FIX}`,
        });
      }
      if (field && property === 'font') {
        violations.push({
          line,
          message: `${rule.selector} { font: ${value} } resets the field's font size. Set font-family or font-weight instead. ${FIELD_FIX}`,
        });
      }
      if (field && property === 'all') {
        violations.push({
          line,
          message: `${rule.selector} { all: ${value} } resets the field's font size and its 24px touch-target floor. Set only the properties you mean to change. ${FIELD_FIX}`,
        });
      }
      if (property === '--target-size') {
        violations.push({
          line,
          message: `${rule.selector} { --target-size: ${value} } changes the 24px touch-target floor. Delete it; the floor is set once in globals.css.`,
        });
      }
    }
  }
  return violations;
}

/** The base file must hold every base rule at the top level, unchanged and in this order. */
export function checkBase(source) {
  const texts = [...parseRules(source)].filter((rule) => rule.topLevel);
  let after = -1;
  for (const expected of BASE_RULES) {
    const want = squash(expected);
    const found = texts.findIndex((rule, index) => index > after && rule.text === want);
    if (found === -1) {
      return [
        {
          line: 1,
          message: `${BASE_FILE} lost or changed the base rule "${expected}" (the base rules must appear in this order: ${BASE_RULES.map((rule) => `"${rule}"`).join(', ')}). Restore it. To change a base rule, edit BASE_RULES in tooling/css-guards.mjs in the same commit.`,
        },
      ];
    }
    after = found;
  }
  return [];
}

function cssFiles(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...cssFiles(path));
    else if (name.endsWith('.css')) found.push(path);
  }
  return found;
}

if (import.meta.main) {
  const violations = checkBase(readFileSync(join(root, BASE_FILE), 'utf8')).map((violation) => ({
    file: BASE_FILE,
    ...violation,
  }));
  for (const file of cssFiles(join(root, 'apps/web/src'))) {
    const rel = relative(root, file);
    for (const violation of checkCss(readFileSync(file, 'utf8'), { isBase: rel === BASE_FILE }))
      violations.push({ file: rel, ...violation });
  }
  for (const { file, line, message } of violations) console.error(`${file}:${line}  ${message}`);
  if (violations.length > 0) {
    console.error(`\n${violations.length} phone CSS violation(s).`);
    process.exit(1);
  }
  console.log('css-guards: ok');
}
