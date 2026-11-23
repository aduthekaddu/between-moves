import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';
import { parse } from '@typescript-eslint/parser';

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
// [BM-051:AC-3] Require tagged code and test evidence for every listed criterion.
const criteriaPath = join(root, 'tooling/traceability-criteria.json');
const matrixPath = join(root, 'tooling/traceability-matrix.md');
const requiredCriteria = ['BM-051:AC-1', 'BM-051:AC-2', 'BM-051:AC-3'];

// The runners that mapped files use today, and how each proves that a tagged test ran.
// Vitest and node:test files run here and their own reports decide. Playwright specs need a
// built app and a database, so they are read instead: only plain `test(...)` calls count, and
// modifiers that skip or invert a test are refused anywhere in the file.
const RUNNERS = [
  {
    name: 'Vitest',
    pattern: /^apps\/web\/src\/.+\.test\.ts$/,
    banned: ['only', 'fails'],
    assertion: expectAssertion,
  },
  {
    name: 'node:test',
    pattern: /^tooling\/[^/]+\.test\.mjs$/,
    banned: ['only'],
    assertion: nodeAssertion,
  },
  {
    name: 'Playwright, read only',
    pattern: /^apps\/web\/e2e\/.+\.spec\.ts$/,
    banned: ['only', 'skip', 'fixme', 'fail'],
    assertion: expectAssertion,
    readOnly: true,
  },
];
const runnerFor = (path) => RUNNERS.find((runner) => runner.pattern.test(path));
// node:assert methods and how many leading arguments they check; the rest is a message.
const NODE_ASSERT_ARITY = {
  ok: 1,
  ifError: 1,
  equal: 2,
  notEqual: 2,
  strictEqual: 2,
  notStrictEqual: 2,
  deepEqual: 2,
  notDeepEqual: 2,
  deepStrictEqual: 2,
  notDeepStrictEqual: 2,
  partialDeepStrictEqual: 2,
  match: 2,
  doesNotMatch: 2,
  throws: 2,
  rejects: 2,
  doesNotThrow: 2,
  doesNotReject: 2,
};
const NODE_ASSERT_ERROR_ARG = new Set(['throws', 'rejects', 'doesNotThrow', 'doesNotReject']);

function children(node) {
  return Object.entries(node)
    .filter(([key]) => key !== 'parent')
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
    .filter(
      (value) => value !== null && typeof value === 'object' && typeof value.type === 'string',
    );
}

/** Visit every node; `visit` returns false to skip a node's children. */
function walk(node, visit) {
  if (visit(node) === false) return;
  for (const child of children(node)) walk(child, visit);
}

function titleText(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral')
    return node.quasis.map((part) => part.value.cooked).join('');
  return null;
}

const isFunction = (node) =>
  node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression';

function calleeNames(node) {
  if (node.type === 'Identifier') return [node.name];
  if (node.type === 'CallExpression') return calleeNames(node.callee);
  if (node.type !== 'MemberExpression') return [];
  return [...calleeNames(node.object), ...(node.computed ? [] : [node.property.name])];
}

/**
 * A call that defines one test, with its callback: `it(t, fn)`, `it(t, options, fn)`,
 * `it.each(rows)(t, fn)`, `test(...)` and node:test `t.test(...)`. `describe`, `suite`, Playwright
 * `test.step` and the hooks are not tests.
 */
const NOT_TESTS = new Set([
  'describe',
  'suite',
  'step',
  'before',
  'after',
  'beforeAll',
  'afterAll',
  'beforeEach',
  'afterEach',
]);
function testCall(node) {
  if (node.type !== 'CallExpression') return null;
  const body = node.arguments.findLast(isFunction);
  const names = calleeNames(node.callee);
  const isTest =
    names.some((name) => name === 'it' || name === 'test') &&
    !names.some((name) => NOT_TESTS.has(name));
  return body && isTest ? { node, body, title: titleText(node.arguments[0]) } : null;
}

function testCalls(ast) {
  const calls = [];
  walk(ast, (node) => {
    const call = testCall(node);
    if (call) calls.push(call);
  });
  return calls;
}

/** `expect(x).not.toBe(y)` as { args: [x, y], negated: true }; null for anything else. */
function expectAssertion(node) {
  if (node.callee.type !== 'MemberExpression') return null;
  const modifiers = [];
  let target = node.callee.object;
  while (target.type === 'MemberExpression' && !target.computed) {
    modifiers.push(target.property.name);
    target = target.object;
  }
  if (target.type !== 'CallExpression') return null;
  const head = target.callee;
  const isExpect =
    (head.type === 'Identifier' && head.name === 'expect') ||
    (head.type === 'MemberExpression' &&
      head.object.type === 'Identifier' &&
      head.object.name === 'expect' &&
      ['soft', 'poll'].includes(head.property.name));
  if (!isExpect || target.arguments.length === 0) return null;
  // The second `expect` argument is a failure message, not part of the assertion.
  return { args: [target.arguments[0], ...node.arguments], negated: modifiers.includes('not') };
}

/** `assert(x, msg)` and `assert.equal(a, b, msg)` without the message. */
function nodeAssertion(node) {
  const { callee } = node;
  if (callee.type === 'Identifier' && callee.name === 'assert') {
    return { args: node.arguments.slice(0, 1), negated: false };
  }
  if (
    callee.type !== 'MemberExpression' ||
    callee.computed ||
    callee.object.type !== 'Identifier' ||
    callee.object.name !== 'assert'
  ) {
    return null;
  }
  const method = callee.property.name;
  if (!Object.hasOwn(NODE_ASSERT_ARITY, method)) return null;
  let args = node.arguments.slice(0, NODE_ASSERT_ARITY[method]);
  if (NODE_ASSERT_ERROR_ARG.has(method) && titleText(args[1]) !== null) args = args.slice(0, 1);
  return { args, negated: /^(not|doesNot)/.test(method) };
}

/** Strings, numbers, regexes and names in an assertion's arguments, without callee names. */
function argumentWords(node, words) {
  if (node.type === 'CallExpression' || node.type === 'NewExpression') {
    calleeWords(node.callee, words);
    for (const arg of node.arguments) argumentWords(arg, words);
    return;
  }
  if (node.type === 'Literal') {
    words.push(typeof node.value === 'string' ? node.value : String(node.raw));
  } else if (node.type === 'TemplateElement') words.push(node.value.cooked ?? node.value.raw);
  else if (node.type === 'Identifier') words.push(node.name);
  for (const child of children(node)) argumentWords(child, words);
}

function calleeWords(node, words) {
  if (node.type === 'MemberExpression') {
    calleeWords(node.object, words);
    if (node.computed) argumentWords(node.property, words);
  } else if (node.type !== 'Identifier') argumentWords(node, words);
}

/** Words asserted in one test body, without the bodies of tests nested inside it. */
function assertedWords(body, assertionOf) {
  const words = [];
  walk(body, (node) => {
    if (testCall(node)) return false;
    if (node.type !== 'CallExpression') return;
    const assertion = assertionOf(node);
    if (!assertion) return;
    assertion.args.forEach((arg, index) => {
      const found = [];
      argumentWords(arg, found);
      // The first argument is what is checked; the rest say what it is checked against.
      for (const text of found) {
        words.push({ text: text.toLowerCase(), negated: assertion.negated, subject: index === 0 });
      }
    });
  });
  return words;
}

/**
 * `not:x` needs a negated assertion. Under `.not`, only the checked value (the first argument)
 * can satisfy another word: `expect(s).not.toBe(429)` does not assert 429. A number matches
 * whole numbers only, so 429 is not 1429.
 */
function asserts(words, token) {
  const negated = token.startsWith('not:');
  const text = (negated ? token.slice(4) : token).toLowerCase();
  const matches = /^\d+$/.test(text)
    ? (word) => new RegExp(`\\b${text}\\b`).test(word)
    : (word) => word.includes(text);
  return words.some(
    (word) => (negated ? word.negated : !word.negated || word.subject) && matches(word.text),
  );
}

/** A banned name as an identifier, a property, a key (quoted or computed), or `x['only']`. */
function bannedName(ast, banned) {
  let found = null;
  walk(ast, (node) => {
    const name =
      node.type === 'Identifier'
        ? node.name
        : node.type === 'MemberExpression' && node.computed
          ? titleText(node.property)
          : node.type === 'Property'
            ? titleText(node.key)
            : null;
    if (!found && banned.includes(name)) found = { name, line: node.loc.start.line };
  });
  return found;
}

/** Playwright `test(...)` calls that run: at the top level or inside `test.describe` bodies. */
function playwrightResults(ast) {
  const results = [];
  const isCall = (node, path) =>
    node?.type === 'CallExpression' &&
    (path === 'test'
      ? node.callee.type === 'Identifier' && node.callee.name === 'test'
      : node.callee.type === 'MemberExpression' &&
        node.callee.object.type === 'Identifier' &&
        node.callee.object.name === 'test' &&
        node.callee.property.name === 'describe');
  const visit = (statements) => {
    for (const statement of statements) {
      const call = statement.type === 'ExpressionStatement' ? statement.expression : null;
      if (isCall(call, 'test') && call.arguments.some(isFunction)) {
        const { line, column } = call.loc.start;
        results.push({ title: titleText(call.arguments[0]) ?? '', line, column: column + 1 });
      } else if (isCall(call, 'describe')) {
        const body = call.arguments.findLast(isFunction)?.body;
        if (body?.type === 'BlockStatement') visit(body.body);
      }
    }
  };
  visit(ast.body);
  return results.map((result) => ({ ...result, status: 'passed' }));
}

function offsetOf(source, line, column) {
  let offset = 0;
  for (let current = 1; current < line; current += 1) offset = source.indexOf('\n', offset) + 1;
  return offset + column - 1;
}

/**
 * [BM-051:AC-3] The tagged tests in one mapped file that ran and passed, with the words they
 * assert. Each runner result binds to the innermost test call around its reported position,
 * and counts only when that call's own title carries the tag.
 */
function provenTests(row, entry, source, run) {
  const runner = runnerFor(entry.path);
  if (!runner) {
    return {
      problem:
        'no runner handles this path. Map a Vitest file (apps/web/src/**/*.test.ts), a node:test file (tooling/*.test.mjs) or a Playwright spec (apps/web/e2e/**/*.spec.ts).',
    };
  }
  let ast;
  try {
    ast = parse(source, {
      filePath: entry.path,
      ecmaFeatures: { jsx: true },
      range: true,
      loc: true,
    });
  } catch (error) {
    return { problem: `cannot parse the file (${error.message}).` };
  }
  const banned = bannedName(ast, runner.banned);
  if (banned) {
    return {
      problem: `line ${banned.line} uses \`${banned.name}\`, which skips, inverts or narrows tests. Remove it.`,
    };
  }
  const { tests, failures } = runner.readOnly
    ? { tests: playwrightResults(ast), failures: [] }
    : (run ?? { tests: [], failures: [] });
  const failed = tests.find((result) => result.status === 'failed');
  if (failed) return { problem: `test "${failed.title}" failed. Fix the test.` };
  if (failures.length > 0) return { problem: `${failures[0]}. Fix the run.` };

  const tag = `[${row.id}]`;
  const calls = testCalls(ast).map((call) => ({ ...call, results: [] }));
  for (const result of tests.filter((result) => result.title.includes(tag) && result.line)) {
    const offset = offsetOf(source, result.line, result.column ?? 1);
    const around = calls
      .filter(({ node }) => node.range[0] <= offset && offset < node.range[1])
      .sort((a, b) => a.node.range[1] - a.node.range[0] - (b.node.range[1] - b.node.range[0]));
    around[0]?.results.push(result);
  }
  const tagged = calls.filter((call) => call.title?.includes(tag));
  if (tagged.length === 0) return { problem: `no test has ${tag} in its title.` };
  const proven = tagged.filter(
    (call) => call.results.length > 0 && call.results.every((r) => r.status === 'passed'),
  );
  if (proven.length === 0) {
    const seen = [...new Set(tagged.flatMap((call) => call.results.map((r) => r.status)))];
    return {
      problem: `no test titled ${tag} ran and passed under ${runner.name} (${seen.length ? `reported ${seen.join(', ')}` : 'not reported'}).`,
    };
  }
  return { proven: proven.map((call) => assertedWords(call.body, runner.assertion)) };
}

function missingTokens(proven, tokens) {
  const gaps = proven.map((words) => tokens.filter((token) => !asserts(words, token)));
  return gaps.sort((a, b) => a.length - b.length)[0] ?? tokens;
}

const quoted = (tokens) => tokens.map((token) => `"${token}"`).join(', ');

function parseTokens(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((token) => typeof token === 'string' && token !== '')
  );
}

function isUnsafePath(path) {
  return path.startsWith('/') || path.split('/').includes('..');
}

/** Every mapped test path whose runner runs here (not the read-only Playwright specs). */
export function runnablePaths(criteria) {
  return [
    ...new Set(
      criteria.flatMap((row) =>
        (row.tests ?? [])
          .map((entry) => entry?.path)
          .filter((path) => typeof path === 'string' && !isUnsafePath(path)),
      ),
    ),
  ].filter((path) => runnerFor(path) && !runnerFor(path).readOnly);
}

/**
 * Run the mapped Vitest files in one Vitest process and the node:test files in one `node --test`
 * process. Returns a Map from the repo-relative path to `{ tests, failures }`: `tests` holds
 * `{ title, line, column, status }` rows, and `failures` names each failed file, suite or hook
 * and a nonzero exit, any of which leaves the file unproven.
 */
export function runTests(givenRoot, paths, { vitestBin } = {}) {
  // The runners report physical paths, so a symlinked root would match none of them.
  const rootDir = realpathSync(givenRoot);
  const results = new Map(paths.map((path) => [path, { tests: [], failures: [] }]));
  const filesFor = (name) => paths.filter((path) => runnerFor(path).name === name);
  const failedExit = (name, files, child) => {
    if (child.status === 0) return;
    for (const path of files) {
      results.get(path).failures.push(`${name} exited with code ${child.status ?? child.signal}`);
    }
  };
  const dir = mkdtempSync(join(tmpdir(), 'traceability-'));
  try {
    const vitestFiles = filesFor('Vitest');
    if (vitestFiles.length > 0) {
      const cwd = join(rootDir, 'apps/web');
      const outputFile = join(dir, 'vitest.json');
      const child = spawnSync(
        vitestBin ?? join(cwd, 'node_modules/.bin/vitest'),
        [
          'run',
          ...vitestFiles.map((path) => relative(cwd, join(rootDir, path))),
          '--reporter=json',
          `--outputFile=${outputFile}`,
          '--includeTaskLocation',
        ],
        { cwd, encoding: 'utf8' },
      );
      if (child.error) throw child.error;
      let report;
      try {
        report = JSON.parse(readFileSync(outputFile, 'utf8'));
      } catch (cause) {
        throw new Error(`Vitest wrote no report:\n${child.stderr}${child.stdout}`, { cause });
      }
      for (const file of report.testResults) {
        const entry = results.get(relative(rootDir, file.name));
        if (!entry) continue;
        entry.tests.push(
          ...file.assertionResults.map((test) => ({
            title: test.title,
            line: test.location?.line,
            column: test.location?.column,
            status: test.status,
          })),
        );
        if (file.status === 'failed') {
          const message = file.message?.split('\n')[0] || 'no message';
          entry.failures.push(`Vitest failed outside a test (${message})`);
        }
      }
      failedExit('Vitest', vitestFiles, child);
    }
    const nodeFiles = filesFor('node:test');
    if (nodeFiles.length > 0) {
      const events = join(dir, 'node-test.jsonl');
      // A run nested inside a node:test file reports to its parent, so drop that context.
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      const child = spawnSync(
        process.execPath,
        [
          '--test',
          `--test-reporter=${join(root, 'tooling/node-test-report.mjs')}`,
          `--test-reporter-destination=${events}`,
          ...nodeFiles.map((path) => join(rootDir, path)),
        ],
        { env, encoding: 'utf8' },
      );
      if (child.error) throw child.error;
      for (const line of readFileSync(events, 'utf8').split('\n').filter(Boolean)) {
        const { file, kind, ...row } = JSON.parse(line);
        const entry = file && results.get(relative(rootDir, file));
        if (!entry) continue;
        if (kind === 'test') entry.tests.push(row);
        else if (row.status === 'failed') {
          const name = row.title === file ? relative(rootDir, file) : row.title;
          entry.failures.push(`node:test failed outside a test (${kind ?? 'file'} "${name}")`);
        }
      }
      failedExit('node:test', nodeFiles, child);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return results;
}

/** `results(path)` returns `runTests`' entry for a mapped Vitest or node:test file. */
export function evaluateCriteria(criteria, readEvidence, results = () => undefined) {
  if (
    !Array.isArray(criteria) ||
    requiredCriteria.some((id) => !criteria.some((row) => row.id === id))
  ) {
    throw new Error('Unmapped required BM-051 acceptance criterion');
  }
  const ids = new Set();
  return criteria.map((row) => {
    if (!/^BM-\d+:AC-\d+$/.test(row.id) || ids.has(row.id)) {
      throw new Error(`Invalid or duplicate criterion: ${row.id}`);
    }
    ids.add(row.id);
    if (!row.criterion || row.implementation.length === 0 || row.tests.length === 0) {
      throw new Error(`Unmapped criterion: ${row.id}`);
    }
    if (!parseTokens(row.requires)) {
      throw new Error(`Invalid criterion ${row.id}: requires needs the words one test must assert`);
    }
    for (const entry of row.tests) {
      if (typeof entry?.path !== 'string' || !parseTokens(entry.asserts)) {
        throw new Error(`Invalid test mapping for ${row.id}: each test needs a path and asserts`);
      }
    }
    const missing = [];
    const problems = [];
    const read = (path) => {
      if (isUnsafePath(path)) return null;
      try {
        return readEvidence(path);
      } catch {
        return null;
      }
    };
    for (const path of row.implementation) {
      if (!read(path)?.includes(`[${row.id}]`)) {
        missing.push(path);
        problems.push(
          `${row.id} ${path}: no [${row.id}] tag. Tag the code that implements the criterion, or remove the mapping.`,
        );
      }
    }
    const fix = 'Tag the test that asserts the criterion, or remove the mapping.';
    const allProven = [];
    for (const entry of row.tests) {
      const source = read(entry.path);
      const { problem, proven } =
        source === null
          ? { problem: 'file cannot be read. Fix the path, or remove the mapping.' }
          : provenTests(row, entry, source, results(entry.path));
      const gaps = proven ? missingTokens(proven, entry.asserts) : [];
      allProven.push(...(proven ?? []));
      if (problem || gaps.length > 0) {
        missing.push(entry.path);
        problems.push(
          `${row.id} ${entry.path}: ${problem ?? `no test titled [${row.id}] that ran asserts ${quoted(gaps)} in an expect matcher or assert call. ${fix}`}`,
        );
      }
    }
    const required = missingTokens(allProven, row.requires);
    if (required.length > 0) {
      missing.push(`requires ${row.requires.join(', ')}`);
      problems.push(
        `${row.id}: no single mapped test that ran asserts ${quoted(required)}, which the criterion requires. Map a test that asserts them.`,
      );
    }
    return { ...row, missing, problems };
  });
}

export function renderMatrix(rows) {
  const header =
    '# Security traceability matrix\n\nGenerated by `pnpm traceability:generate` from the BM-051 acceptance criteria.\n\n| Criterion | Acceptance criterion | One test must assert | Implementation | Tests | Status |\n| --- | --- | --- | --- | --- | --- |';
  const words = (tokens) => tokens.map((token) => `\`${token}\``).join(', ');
  const test = (entry) =>
    `\`${entry.path}\` (${runnerFor(entry.path)?.name ?? 'no runner'}) asserts ${words(entry.asserts)}`;
  return `${header}\n${rows.map((row) => `| ${row.id} | ${row.criterion} | ${words(row.requires)} | ${row.implementation.map((path) => `\`${path}\``).join('<br>')} | ${row.tests.map(test).join('<br>')} | ${row.missing.length ? `MISSING: ${row.missing.join(', ')}` : 'Mapped'} |`).join('\n')}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const criteria = JSON.parse(readFileSync(criteriaPath, 'utf8'));
  const ran = runTests(root, runnablePaths(criteria));
  const rows = evaluateCriteria(
    criteria,
    (path) => readFileSync(join(root, path), 'utf8'),
    (path) => ran.get(path),
  );
  const matrix = renderMatrix(rows);
  if (process.argv.includes('--write')) writeFileSync(matrixPath, matrix);
  else if (process.argv.includes('--check')) {
    if (readFileSync(matrixPath, 'utf8') !== matrix) {
      process.stderr.write('Traceability matrix is stale. Run pnpm traceability:generate.\n');
      process.exitCode = 1;
    }
  } else process.stdout.write(matrix);
  const problems = rows.flatMap((row) => row.problems);
  if (problems.length > 0) {
    process.stderr.write(
      `Traceability criteria lack tagged implementation or tests.\n${problems.join('\n')}\n`,
    );
    process.exitCode = 1;
  }
}
