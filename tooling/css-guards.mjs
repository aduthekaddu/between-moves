// Rejects CSS that brings back two phone mistakes a browser test only finds late:
//   1. a text field set below 16px (iOS Safari zooms the page into it on focus), and
//   2. a control given a height below 24px (WCAG 2.5.8 Target Size, Minimum).
// The base rules that hold both floors live in apps/web/src/app/globals.css. This check
// also fails when those base rules are gone. It reads source only; what a rule computes
// to on a real page is checked by apps/web/e2e/phone-touch.spec.ts.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const MIN_FIELD_FONT_PX = 16;
export const MIN_TARGET_PX = 24;
const BASE_FILE = 'apps/web/src/app/globals.css';

const FIELD_FIX = `Fields must be at least 1rem so iOS does not zoom. Delete this declaration; globals.css sets "input, select, textarea { font-size: max(1rem, 1em) }" for every field.`;
const TARGET_FIX = `Controls must be at least ${MIN_TARGET_PX}px tall (WCAG 2.5.8). Delete this declaration; globals.css sets a ${MIN_TARGET_PX}px floor with "--target-size". To keep a small look, add padding and cancel it with a negative margin.`;

function blankComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '));
}

/** Walks rules, descending into conditional at-rules. Yields { selector, declarations, line }. */
export function* parseRules(source) {
  const text = blankComments(source);
  function* walk(from, to) {
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
      const body = [open + 1, close - 1];
      const line =
        text.slice(0, index).split('\n').length +
        (text.slice(index, open).match(/^\s*/)?.[0].split('\n').length ?? 1) -
        1;
      if (header.startsWith('@')) {
        if (/^@(media|supports|container|layer|scope)\b/.test(header))
          yield* walk(body[0], body[1]);
      } else {
        const declarations = [];
        let depthParen = 0;
        let start = body[0];
        for (let i = body[0]; i <= body[1]; i += 1) {
          const char = i === body[1] ? ';' : text[i];
          if (char === '(') depthParen += 1;
          else if (char === ')') depthParen -= 1;
          else if (char === ';' && depthParen === 0) {
            const piece = text.slice(start, i);
            const colon = piece.indexOf(':');
            if (colon !== -1) {
              declarations.push({
                property: piece.slice(0, colon).trim().toLowerCase(),
                value: piece
                  .slice(colon + 1)
                  .trim()
                  .replace(/\s*!important$/i, ''),
                line:
                  text.slice(0, start).split('\n').length +
                  (piece.slice(0, colon).match(/^\s*/)?.[0].split('\n').length ?? 1) -
                  1,
              });
            }
            start = i + 1;
          }
        }
        yield { selector: header, declarations, line };
      }
      index = close;
    }
  }
  yield* walk(0, text.length);
}

function selectorList(selector) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= selector.length; i += 1) {
    const char = selector[i];
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if ((char === ',' && depth === 0) || i === selector.length) {
      parts.push(selector.slice(start, i).trim());
      start = i + 1;
    }
  }
  return parts.filter(Boolean);
}

/** The compound selector the rule styles: the text after the last combinator. */
function subject(selector) {
  let depth = 0;
  let cut = 0;
  for (let i = 0; i < selector.length; i += 1) {
    const char = selector[i];
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (depth === 0 && /[\s>+~]/.test(char)) cut = i + 1;
  }
  return selector.slice(cut).trim();
}

const NOT_TEXT_FIELD =
  /\[type=["']?(checkbox|radio|range|color|file|hidden|submit|button|image|reset)/i;
const FIELD = /(?<![\w\-.#\[:"'=])(input|select|textarea)(?![\w-])/i;
const CONTROL = /(?<![\w\-.#\[:"'=])(button|summary|select|textarea)(?![\w-])|\[role=["']?button/i;
const BARE_TAGS = /^(?:(?:button|input|select|textarea)\s*,?\s*)+$/i;

export function toPx(value) {
  const match = /^(-?\d*\.?\d+)(px|rem)$/.exec(value.trim());
  if (match === null) return null;
  return Number(match[1]) * (match[2] === 'rem' ? 16 : 1);
}

/** True when `value` can never compute below `minimum` px. Unknown forms are not safe. */
function atLeast(value, minimum) {
  const px = toPx(value);
  if (px !== null) return px >= minimum;
  const call = /^(max|clamp)\((.*)\)$/is.exec(value.trim());
  if (call === null) return false;
  const args = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= call[2].length; i += 1) {
    const char = call[2][i];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if ((char === ',' && depth === 0) || i === call[2].length) {
      args.push(call[2].slice(start, i).trim());
      start = i + 1;
    }
  }
  return call[1].toLowerCase() === 'max'
    ? args.some((arg) => atLeast(arg, minimum))
    : atLeast(args[0] ?? '', minimum);
}

/** Violations in one stylesheet: { line, message }. */
export function checkCss(source) {
  const violations = [];
  for (const rule of parseRules(source)) {
    for (const selector of selectorList(rule.selector)) {
      const target = subject(selector);
      const isField = FIELD.test(target) && !NOT_TEXT_FIELD.test(target);
      const isControl = CONTROL.test(target) && !NOT_TEXT_FIELD.test(target);
      for (const { property, value, line } of rule.declarations) {
        if (isField && property === 'font-size' && !atLeast(value, MIN_FIELD_FONT_PX)) {
          violations.push({
            line,
            message: `${selector} { font-size: ${value} } sets a field under ${MIN_FIELD_FONT_PX}px. ${FIELD_FIX}`,
          });
        }
        if (
          isField &&
          property === 'font' &&
          !(BARE_TAGS.test(selector) && /^(inherit|initial|unset|revert)$/i.test(value))
        ) {
          violations.push({
            line,
            message: `${selector} { font: ${value} } resets the field's font size. ${FIELD_FIX}`,
          });
        }
        if (
          isControl &&
          [
            'height',
            'max-height',
            'block-size',
            'max-block-size',
            'min-height',
            'min-block-size',
          ].includes(property)
        ) {
          const px = toPx(value);
          const small = px === null ? false : px < MIN_TARGET_PX;
          if (small) {
            violations.push({
              line,
              message: `${selector} { ${property}: ${value} } is under ${MIN_TARGET_PX}px. ${TARGET_FIX}`,
            });
          }
        }
      }
    }
  }
  return violations;
}

/** The base file must still hold both floors. */
export function checkBase(source) {
  const violations = [];
  let fieldFloor = false;
  let targetFloor = false;
  for (const rule of parseRules(source)) {
    const subjects = selectorList(rule.selector).map(subject);
    for (const { property, value } of rule.declarations) {
      if (
        property === 'font-size' &&
        subjects.some((s) => /^(input|select|textarea)$/i.test(s)) &&
        atLeast(value, MIN_FIELD_FONT_PX)
      ) {
        fieldFloor = true;
      }
      if (
        (property === 'min-block-size' || property === 'min-height') &&
        /--target-size/.test(value) &&
        /button/.test(rule.selector)
      ) {
        targetFloor = true;
      }
    }
  }
  if (!fieldFloor) {
    violations.push({
      line: 1,
      message: `${BASE_FILE} lost its field floor "input, select, textarea { font-size: max(1rem, 1em) }". Restore it; iOS zooms into fields under ${MIN_FIELD_FONT_PX}px.`,
    });
  }
  if (!targetFloor) {
    violations.push({
      line: 1,
      message: `${BASE_FILE} lost its touch-target floor (a rule listing button, summary and the other controls with "min-block-size: var(--target-size)"). Restore it; WCAG 2.5.8 needs ${MIN_TARGET_PX}px.`,
    });
  }
  return violations;
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let failures = 0;
  for (const file of cssFiles(join(root, 'apps/web/src'))) {
    const rel = relative(root, file);
    const source = readFileSync(file, 'utf8');
    const violations = [...checkCss(source), ...(rel === BASE_FILE ? checkBase(source) : [])];
    for (const { line, message } of violations) {
      console.error(`${rel}:${line}  ${message}`);
      failures += 1;
    }
  }
  if (failures > 0) {
    console.error(`\n${failures} phone/touch CSS violation(s).`);
    process.exit(1);
  }
  console.log('css-guards: ok');
}
