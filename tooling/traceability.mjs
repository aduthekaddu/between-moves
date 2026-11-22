import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parse } from '@typescript-eslint/parser';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// [BM-051:AC-3] Require tagged code and test evidence for every listed criterion.
const criteriaPath = join(root, 'tooling/traceability-criteria.json');
const matrixPath = join(root, 'tooling/traceability-matrix.md');
const requiredCriteria = ['BM-051:AC-1', 'BM-051:AC-2', 'BM-051:AC-3'];

// `it`/`test` and the modifiers that still run the test. `skip`, `todo`, `skipIf`, `runIf`
// and `fails` are left out on purpose: a test that does not run asserts nothing.
const RUNNERS = new Set(['it', 'test']);
const RUNNING_MODIFIERS = new Set(['each', 'only', 'concurrent', 'sequential']);
const ASSERTION_ROOTS = new Set(['expect', 'assert']);

function children(node) {
  return Object.entries(node)
    .filter(([key]) => key !== 'parent')
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
    .filter(
      (value) => value !== null && typeof value === 'object' && typeof value.type === 'string',
    );
}

function walk(node, visit) {
  visit(node);
  for (const child of children(node)) walk(child, visit);
}

/** The chain `it`, `it.only`, `it.each` ... as a list of names, or null when it is not a runner. */
function runnerChain(node) {
  if (node.type === 'Identifier') return RUNNERS.has(node.name) ? [node.name] : null;
  if (node.type !== 'MemberExpression' || node.computed || node.property.type !== 'Identifier') {
    return null;
  }
  const inner = runnerChain(node.object);
  return inner && RUNNING_MODIFIERS.has(node.property.name) ? [...inner, node.property.name] : null;
}

function titleText(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral')
    return node.quasis.map((part) => part.value.cooked).join('');
  return null;
}

/** The (title, body) of a test call: `it(t, fn)`, `it.each(rows)(t, fn)` or ``it.each`rows`(t, fn)``. */
function testCall(node) {
  if (node.type !== 'CallExpression') return null;
  const callee = node.callee;
  const direct = runnerChain(callee);
  const tabled =
    callee.type === 'CallExpression' || callee.type === 'TaggedTemplateExpression'
      ? runnerChain(callee.type === 'CallExpression' ? callee.callee : callee.tag)
      : null;
  const isTable = (chain) => chain?.at(-1) === 'each';
  if ((direct && !isTable(direct)) || (tabled && isTable(tabled))) {
    return { title: titleText(node.arguments[0]), body: node.arguments[1] };
  }
  return null;
}

function assertionRoot(node) {
  let current = node;
  while (current.type === 'CallExpression' || current.type === 'MemberExpression') {
    current = current.type === 'CallExpression' ? current.callee : current.object;
  }
  return current.type === 'Identifier' ? current.name : null;
}

/** Every string, number, regex and name written inside an `expect(...)`/`assert.*(...)` call. */
function assertedWords(body) {
  const words = [];
  walk(body, (node) => {
    if (node.type !== 'CallExpression' || !ASSERTION_ROOTS.has(assertionRoot(node))) return;
    walk(node, (inner) => {
      if (inner.type === 'Literal') words.push(String(inner.raw ?? inner.value));
      else if (inner.type === 'TemplateElement') words.push(inner.value.raw);
      else if (inner.type === 'Identifier') words.push(inner.name);
    });
  });
  return words.map((word) => word.toLowerCase());
}

/** [BM-051:AC-3] A mapped test file must hold a running test, titled with the tag, that asserts each token. */
function testProblem(row, entry, source) {
  const fix = 'Tag the test that asserts the criterion, or remove the mapping.';
  let ast;
  try {
    ast = parse(source, { filePath: entry.path, ecmaFeatures: { jsx: true }, range: true });
  } catch (error) {
    return `${row.id} ${entry.path}: cannot parse the file (${error.message}). ${fix}`;
  }
  const tagged = [];
  walk(ast, (node) => {
    const call = testCall(node);
    if (call?.title?.includes(`[${row.id}]`) && call.body) tagged.push(assertedWords(call.body));
  });
  if (tagged.length === 0) {
    return `${row.id} ${entry.path}: no running test has [${row.id}] in its title. ${fix}`;
  }
  const missing = (words) =>
    entry.asserts.filter((token) => !words.some((word) => word.includes(token.toLowerCase())));
  if (tagged.some((words) => missing(words).length === 0)) return null;
  const closest = tagged.map(missing).sort((a, b) => a.length - b.length)[0];
  return `${row.id} ${entry.path}: no test titled [${row.id}] asserts ${closest.map((t) => `"${t}"`).join(', ')} in an expect or assert call. ${fix}`;
}

function parseTestEntry(row, entry) {
  if (
    typeof entry?.path !== 'string' ||
    !Array.isArray(entry.asserts) ||
    entry.asserts.length === 0 ||
    entry.asserts.some((token) => typeof token !== 'string' || token === '')
  ) {
    throw new Error(`Invalid test mapping for ${row.id}: each test needs a path and asserts`);
  }
  return entry;
}

function isUnsafePath(path) {
  return path.startsWith('/') || path.split('/').includes('..');
}

export function evaluateCriteria(criteria, readEvidence) {
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
    const tests = row.tests.map((entry) => parseTestEntry(row, entry));
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
    for (const entry of tests) {
      const source = read(entry.path);
      const problem =
        source === null
          ? `${row.id} ${entry.path}: file cannot be read. Fix the path, or remove the mapping.`
          : testProblem(row, entry, source);
      if (problem) {
        missing.push(entry.path);
        problems.push(problem);
      }
    }
    return { ...row, tests, missing, problems };
  });
}

export function renderMatrix(rows) {
  const header =
    '# Security traceability matrix\n\nGenerated by `pnpm traceability:generate` from the BM-051 acceptance criteria.\n\n| Criterion | Acceptance criterion | Implementation | Tests | Status |\n| --- | --- | --- | --- | --- |';
  const test = (entry) =>
    `\`${entry.path}\` asserts ${entry.asserts.map((token) => `\`${token}\``).join(', ')}`;
  return `${header}\n${rows.map((row) => `| ${row.id} | ${row.criterion} | ${row.implementation.map((path) => `\`${path}\``).join('<br>')} | ${row.tests.map(test).join('<br>')} | ${row.missing.length ? `MISSING: ${row.missing.join(', ')}` : 'Mapped'} |`).join('\n')}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const criteria = JSON.parse(readFileSync(criteriaPath, 'utf8'));
  const rows = evaluateCriteria(criteria, (path) => readFileSync(join(root, path), 'utf8'));
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
