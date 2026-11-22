// Docs that name code which no longer exists must fail the build.
//
// The developer docs make four kinds of claims that can be checked against the tree:
//   path      a backticked repo path, or a relative markdown link, exists
//   script    `pnpm <script>` and `pnpm --filter <pkg> <script>` name a real package.json script
//   package   `@between-moves/<name>` is a workspace package (docs and eslint configs)
//   symbol    "`name` in `path/to/file.ts`" means the file contains `name`
//   edge      the package diagram, "only `a` depends on `b`" and "`x` may import `y`" lists agree
//             with the package.json dependencies and the eslint allow-list
//
// The checker reads the tree under DOC_CLAIMS_ROOT (default: this repository) so it can be
// pointed at an older checkout.
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FIX = 'Fix: update the doc in the same commit as the code it describes.';
const SCOPE_NAME = '@between-moves/';
const TOP_LEVEL_DIRS = ['apps', 'packages', 'ops', 'tooling', 'scripts', 'architecture', '.github'];
const FILE_EXTENSIONS = 'md|mjs|cjs|ts|tsx|json|sql|yml|yaml|png|example';
const SKIPPED_DIRS = new Set(['node_modules', '.git', '.next', '.turbo', 'dist', 'coverage']);
// Backticked paths that are real but never tracked. Each needs a reason.
const UNTRACKED_PATHS = new Map([
  ['apps/web/.env.local', 'gitignored; README step 3 tells the reader to create it'],
  ['.env.local', 'gitignored; README step 3 tells the reader to create it'],
  ['packages/db/migrations/generated', 'gitignored; `pnpm db:generate` creates it'],
]);
// pnpm commands that are not package.json scripts.
const PNPM_BUILT_INS = new Set(
  (
    'add audit bin create dedupe deploy dlx env exec fetch i import init install install-test link ' +
    'list ls outdated pack patch prune publish rebuild remove rm run run-script setup self-update ' +
    'store unlink up update why approve-builds config'
  ).split(' '),
);
// CHANGELOG is history, the traceability matrix is generated and has its own check.
const EXCLUDED_DOCS = new Set(['CHANGELOG.md', 'tooling/traceability-matrix.md']);

function listFiles(directory, accept) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name)) continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...listFiles(full, accept));
    else if (accept(entry.name)) found.push(full);
  }
  return found;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function loadWorkspace(root) {
  const packages = [];
  const rootManifest = join(root, 'package.json');
  if (existsSync(rootManifest)) {
    packages.push({ dir: '.', manifest: readJson(rootManifest) });
  }
  for (const group of ['apps', 'packages']) {
    if (!existsSync(join(root, group))) continue;
    for (const entry of readdirSync(join(root, group), { withFileTypes: true })) {
      const manifest = join(root, group, entry.name, 'package.json');
      if (entry.isDirectory() && existsSync(manifest)) {
        packages.push({ dir: `${group}/${entry.name}`, manifest: readJson(manifest) });
      }
    }
  }
  return packages;
}

function docFiles(root) {
  return listFiles(root, (name) => name.endsWith('.md'))
    .map((file) => relative(root, file))
    .filter((file) => !EXCLUDED_DOCS.has(file) && !file.startsWith('docs/'));
}

// Yields { line, text, inFence } for every line, tracking fenced code blocks.
function* docLines(source) {
  let fence = null;
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index];
    const marker = /^\s*(`{3,}|~{3,})/.exec(text);
    if (marker) {
      if (fence === null) fence = marker[1];
      else if (marker[1].startsWith(fence[0]) && marker[1].length >= fence.length) fence = null;
      continue;
    }
    yield { line: index + 1, text, inFence: fence !== null };
  }
}

function parsePnpm(command) {
  const words = command
    .split(/\s*(?:&&|\|\||[|;>])\s*/)[0]
    .trim()
    .split(/\s+/);
  assert.equal(words[0], 'pnpm');
  let filter;
  let index = 1;
  while (index < words.length && words[index].startsWith('-')) {
    const flag = words[index];
    if (['--filter', '-F', '--dir', '-C'].includes(flag)) {
      if (flag === '--filter' || flag === '-F') filter = words[index + 1];
      index += 2;
    } else if (flag.startsWith('--filter=')) {
      filter = flag.slice('--filter='.length);
      index += 1;
    } else {
      index += 1;
    }
  }
  let name = words[index];
  if (['run', 'run-script'].includes(name) && words[index + 1]) {
    name = words[index + 1];
    return { filter, name, explicitRun: true };
  }
  return { filter, name, explicitRun: false };
}

// `<name>`, `*`, `...` and `NNNN` (a migration number) stand for a value, not a real name.
// Yields { line, text } for each line of every ```mermaid block that starts with `flowchart`.
function flowcharts(source) {
  const lines = source.split('\n');
  const charts = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*```mermaid/.test(lines[index])) continue;
    const body = [];
    let end = index + 1;
    for (; end < lines.length && !/^\s*```/.test(lines[end]); end += 1) {
      body.push({ line: end + 1, text: lines[end] });
    }
    if (body.some(({ text }) => /^\s*flowchart\b/.test(text))) {
      charts.push({ line: index + 1, body });
    }
    index = end;
  }
  return charts;
}

// The lint allow-list as eslint.config.mjs sets it: { 'db' => Set('domain', ...) }.
// Subjects are `apps/<name>` for an app and `<name>` for a package.
async function lintAllowLists(root) {
  const config = join(root, 'eslint.config.mjs');
  const lists = new Map();
  if (!existsSync(config)) return lists;
  const { default: entries } = await import(pathToFileURL(config).href);
  for (const entry of entries) {
    const group = entry.rules?.['no-restricted-imports']?.[1]?.patterns?.[0]?.group;
    const glob = entry.files?.[0];
    if (!group || !glob) continue;
    const allowed = new Set(
      group
        .filter((item) => item.startsWith(`!${SCOPE_NAME}`) && !item.endsWith('/*'))
        .map((item) => item.slice(`!${SCOPE_NAME}`.length)),
    );
    const target = /^(apps\/[^/]+|packages\/(?:\{([^}]+)\}|[^/]+))\/src\//.exec(glob);
    if (!target) continue;
    const subjects = target[2] ? target[2].split(',') : [target[1].replace(/^packages\//, '')];
    for (const subject of subjects) lists.set(subject, allowed);
  }
  return lists;
}

const isPlaceholder = (text) => /[<>*]|\.\.\.|\bN{3,}/.test(text);

export async function findStaleClaims(root) {
  const findings = [];
  const workspace = loadWorkspace(root);
  const packageNames = new Set(workspace.map((entry) => entry.manifest.name));
  const rootScripts = new Set(
    Object.keys(workspace.find((e) => e.dir === '.')?.manifest.scripts ?? {}),
  );
  const allScripts = new Set(workspace.flatMap((e) => Object.keys(e.manifest.scripts ?? {})));
  const knownBasenames = new Set(listFiles(root, () => true).map((file) => basename(file)));
  const dependenciesOf = (entry) =>
    new Set(
      ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
        .flatMap((field) => Object.keys(entry.manifest[field] ?? {}))
        .filter((name) => packageNames.has(name) && name !== entry.manifest.name),
    );
  const bySubject = (subject) =>
    workspace.find((entry) =>
      subject.startsWith('apps/')
        ? entry.dir === subject
        : entry.manifest.name === `${SCOPE_NAME}${subject}`,
    );
  const lintAllowed = await lintAllowLists(root);
  const fileCache = new Map();
  const read = (path) => {
    if (!fileCache.has(path)) fileCache.set(path, readFileSync(join(root, path), 'utf8'));
    return fileCache.get(path);
  };

  function report(doc, line, kind, claim, detail) {
    findings.push(`${doc}:${line} [${kind}] ${claim} ${detail} ${FIX}`);
  }

  function repoPathExists(path) {
    return existsSync(join(root, path));
  }

  function checkPath(doc, line, token) {
    const path = token.replace(/\/$/, '');
    if (UNTRACKED_PATHS.has(path)) return true;
    if (!repoPathExists(path)) {
      report(doc, line, 'path', `\`${token}\``, 'does not exist in the repo.');
      return false;
    }
    return true;
  }

  function checkScript(doc, line, command) {
    const { filter, name, explicitRun } = parsePnpm(command);
    if (!name || isPlaceholder(name)) return;
    const builtIn = !explicitRun && PNPM_BUILT_INS.has(name);
    if (filter) {
      if (isPlaceholder(filter)) return;
      const target = workspace.find(
        (e) => e.manifest.name === filter || `./${e.dir}` === filter || e.dir === filter,
      );
      if (!target) {
        report(
          doc,
          line,
          'script',
          `\`${command}\``,
          `names the package \`${filter}\`, which does not exist.`,
        );
      } else if (!builtIn && !(name in (target.manifest.scripts ?? {}))) {
        report(
          doc,
          line,
          'script',
          `\`${command}\``,
          `names a script that ${target.manifest.name} does not define.`,
        );
      }
      return;
    }
    if (builtIn || rootScripts.has(name)) return;
    // Docs also run package scripts from inside that package ("From apps/worker, run ...").
    if (allScripts.has(name)) return;
    report(doc, line, 'script', `\`${command}\``, 'names a script that no package.json defines.');
  }

  const tokensIn = (text) => [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  const shortName = (token) => token.replace(SCOPE_NAME, '');
  const sameSet = (a, b) => a.size === b.size && [...a].every((item) => b.has(item));
  const listOf = (names) => [...names].sort().join(', ') || 'nothing';

  // "Today only `apps/web` depends on `contracts`." and the bullet list of what a layer
  // "may import", which AGENTS.md says is the lint allow-list.
  function checkDependencyProse(doc, line, text) {
    const only = /only `([^`]+)` depends on `([^`]+)`/.exec(text);
    if (only) {
      const target = bySubject(shortName(only[2]));
      const dependents = new Set(
        workspace
          .filter((entry) => target && dependenciesOf(entry).has(target.manifest.name))
          .map((entry) => entry.dir),
      );
      if (!target || !sameSet(dependents, new Set([only[1]]))) {
        report(
          doc,
          line,
          'edge',
          `only \`${only[1]}\` depends on \`${only[2]}\``,
          `disagrees with the package.json files, where the dependents are ${listOf(dependents)}.`,
        );
      }
    }
    const may = /^- (.+?) may import (.+?)\.(?:\s|$)/.exec(text);
    if (may) {
      const claimed = new Set(
        tokensIn(may[2])
          .filter((token) => token !== 'import type')
          .map(shortName),
      );
      for (const subject of tokensIn(may[1])) {
        const allowed = lintAllowed.get(subject);
        if (!allowed || !sameSet(allowed, claimed)) {
          report(
            doc,
            line,
            'edge',
            `\`${subject}\` may import ${listOf(claimed)}`,
            `disagrees with eslint.config.mjs, which allows ${allowed ? listOf(allowed) : 'no entry for it'}.`,
          );
        }
      }
    }
    const depends = /^- `([^`]+)` may import.*`package\.json` depends on `([^`]+)` only/.exec(text);
    const entry = depends && bySubject(depends[1]);
    if (
      depends &&
      entry &&
      !sameSet(dependenciesOf(entry), new Set([`${SCOPE_NAME}${depends[2]}`]))
    ) {
      report(
        doc,
        line,
        'edge',
        `\`${depends[1]}\` package.json depends on \`${depends[2]}\` only`,
        `disagrees with its package.json, which depends on ${listOf([...dependenciesOf(entry)].map(shortName))}.`,
      );
    }
  }

  // The package diagram: each arrow must be a dependency in a package.json, and each
  // dependency must be an arrow.
  function checkDiagram(doc, chart) {
    const ids = new Map();
    for (const { text } of chart.body) {
      for (const node of text.matchAll(/(\w+)\["([^"]+)"\]/g)) ids.set(node[1], node[2]);
    }
    const drawn = new Map();
    for (const { line, text } of chart.body) {
      const arrow = /^\s*(\w+)\s*-->\s*(\w+)/.exec(text);
      if (!arrow) continue;
      const [from, to] = [ids.get(arrow[1]), ids.get(arrow[2])];
      if (
        !from ||
        !to ||
        !bySubject(from.replace(/^packages\//, '')) ||
        !bySubject(to.replace(/^packages\//, ''))
      ) {
        report(
          doc,
          line,
          'edge',
          `\`${text.trim()}\``,
          'names a node that is not a workspace package.',
        );
        continue;
      }
      drawn.set(`${from} --> ${to}`, line);
    }
    const real = new Set();
    for (const entry of workspace.filter((e) => e.dir !== '.')) {
      for (const dep of dependenciesOf(entry)) {
        real.add(`${entry.dir} --> ${workspace.find((e) => e.manifest.name === dep).dir}`);
      }
    }
    for (const [edge, line] of drawn) {
      if (!real.has(edge))
        report(
          doc,
          line,
          'edge',
          `diagram arrow ${edge}`,
          'is not a dependency in any package.json.',
        );
    }
    for (const edge of real) {
      if (!drawn.has(edge))
        report(
          doc,
          chart.line,
          'edge',
          `package.json dependency ${edge}`,
          'is missing from the diagram.',
        );
    }
  }

  function checkPackageNames(doc, line, text) {
    for (const match of text.matchAll(/@between-moves\/([A-Za-z0-9._-]+)/g)) {
      const name = `${SCOPE_NAME}${match[1]}`;
      if (!packageNames.has(name)) {
        report(doc, line, 'package', `\`${name}\``, 'is not a workspace package.');
      }
    }
  }

  const barePath = new RegExp(`^[\\w.-]+\\.(?:${FILE_EXTENSIONS})$`);
  const repoPath = new RegExp(
    `^(?:${TOP_LEVEL_DIRS.map((d) => d.replace('.', '\\.')).join('|')})(?:/[\\w@.\\[\\]-]+)*/?$`,
  );
  const symbolInFile =
    /`([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?:\(\))?`\s+(?:is\s+)?in\s+`([^`\s]+)`/g;
  const fileDeclares =
    /`([^`\s]+)`\s+(?:exports|defines|declares|contains)\s+`([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)`/g;

  function filesUnder(path) {
    const full = join(root, path);
    return existsSync(full) && !path.match(/\.\w+$/)
      ? listFiles(full, () => true).map((file) => relative(root, file))
      : [path];
  }

  function checkSymbol(doc, line, symbol, path) {
    const clean = path.replace(/\/$/, '');
    if (!repoPathExists(clean)) return; // reported by the path check
    const candidates = filesUnder(clean);
    for (const part of symbol.split('.')) {
      const word = new RegExp(`(?<![\\w$])${part.replace(/\$/g, '\\$')}(?![\\w$])`);
      if (!candidates.some((file) => word.test(read(file)))) {
        report(
          doc,
          line,
          'symbol',
          `\`${symbol}\` in \`${path}\``,
          `is wrong: \`${part}\` does not appear there.`,
        );
        return;
      }
    }
  }

  for (const doc of docFiles(root)) {
    const docDir = dirname(doc);
    for (const chart of flowcharts(readFileSync(join(root, doc), 'utf8'))) checkDiagram(doc, chart);
    for (const { line, text, inFence } of docLines(readFileSync(join(root, doc), 'utf8'))) {
      if (inFence) {
        const command = /^\s*(?:\$\s+)?(pnpm\s.*)$/.exec(text);
        if (command) checkScript(doc, line, command[1].trim());
        continue;
      }

      checkPackageNames(doc, line, text);
      checkDependencyProse(doc, line, text);

      for (const match of text.matchAll(/`([^`]+)`/g)) {
        const token = match[1].trim();
        if (/^pnpm\s/.test(token)) checkScript(doc, line, token);
        else if (isPlaceholder(token) || token.includes(' ')) continue;
        else if (token.includes('/') && repoPath.test(token)) checkPath(doc, line, token);
        else if (
          barePath.test(token) &&
          !UNTRACKED_PATHS.has(token) &&
          !knownBasenames.has(token)
        ) {
          report(doc, line, 'path', `\`${token}\``, 'does not exist anywhere in the repo.');
        }
      }

      for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = match[1].split('#')[0];
        if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) continue;
        const resolved = join(docDir, target).replace(/\\/g, '/');
        if (!repoPathExists(resolved)) {
          report(
            doc,
            line,
            'path',
            `link \`${match[1]}\``,
            'does not resolve to a file in the repo.',
          );
        }
      }

      for (const match of text.matchAll(symbolInFile)) {
        if (repoPath.test(match[2])) checkSymbol(doc, line, match[1], match[2]);
      }
      for (const match of text.matchAll(fileDeclares)) {
        if (repoPath.test(match[1])) checkSymbol(doc, line, match[2], match[1]);
      }
    }
  }

  // A lint allow-list that names a package that does not exist is the same mistake in code.
  for (const config of listFiles(root, (name) => /^eslint\.config\.m?js$/.test(name))) {
    const source = readFileSync(config, 'utf8');
    for (const match of source.matchAll(/'@between-moves\/([A-Za-z0-9._-]+)'/g)) {
      const name = `${SCOPE_NAME}${match[1]}`;
      if (!packageNames.has(name)) {
        const line = source.slice(0, match.index).split('\n').length;
        findings.push(
          `${relative(root, config)}:${line} [package] \`${name}\` is not a workspace package. ` +
            'Fix: remove it from the allow-list, or create the package in the same commit.',
        );
      }
    }
  }

  return findings;
}

async function withTree(files, run) {
  const root = mkdtempSync(join(tmpdir(), 'doc-claims-'));
  try {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    return await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const allowList = (files, ...names) => ({
  files: [files],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          { group: ['@between-moves/*', ...names.map((name) => `!@between-moves/${name}`)] },
        ],
      },
    ],
  },
});

const fixtureFiles = {
  'package.json': JSON.stringify({ name: 'root', scripts: { check: 'x', 'test:e2e': 'x' } }),
  'apps/worker/package.json': JSON.stringify({
    name: '@between-moves/worker',
    scripts: { 'trigger:deploy': 'x' },
    dependencies: { '@between-moves/domain': 'workspace:*' },
  }),
  'packages/domain/package.json': JSON.stringify({ name: '@between-moves/domain' }),
  'packages/observability/package.json': JSON.stringify({ name: '@between-moves/observability' }),
  'packages/domain/src/season.ts': 'export function transitionSeasonState() {}\n',
  'eslint.config.mjs': `export default [${JSON.stringify(allowList('apps/worker/src/**/*.ts', 'domain', 'observability'))}];\n`,
};

describe('doc claims checker', () => {
  it('accepts claims that match the tree', async () => {
    const findings = await withTree(
      {
        ...fixtureFiles,
        'AGENTS.md': [
          'Run `pnpm check` and `pnpm --filter @between-moves/worker trigger:deploy`.',
          '`transitionSeasonState` in `packages/domain/src/season.ts` moves a season.',
          'See [the season](packages/domain/src/season.ts) and `@between-moves/domain`.',
          'Today only `apps/worker` depends on `domain`.',
          '- `apps/worker` may import `domain` and `observability`.',
          '```mermaid',
          'flowchart TD',
          '  worker["apps/worker"]',
          '  domain["packages/domain"]',
          '  worker --> domain',
          '```',
          '```bash',
          'pnpm install',
          'pnpm test:e2e',
          '```',
        ].join('\n'),
      },
      findStaleClaims,
    );
    assert.deepEqual(findings, []);
  });

  it('names doc, line, claim and fix for each stale claim', async () => {
    const findings = await withTree(
      {
        ...fixtureFiles,
        'eslint.config.mjs': `const ghost = '@between-moves/config';\nexport default [${JSON.stringify(
          allowList('apps/worker/src/**/*.ts', 'domain', 'config'),
        )}];\n`,
        'AGENTS.md': [
          'Gone path `packages/domain/src/gone.ts` here.',
          'Gone script `pnpm lint:boundaries` here.',
          'Wrong script `pnpm --filter @between-moves/worker nope` here.',
          'Gone package `@between-moves/config` here.',
          '`renamedFunction` in `packages/domain/src/season.ts` is wrong.',
          'Bad link [x](ops/gone.md) here.',
          '```bash',
          'pnpm db:gone',
          '```',
          'Today only `apps/worker` depends on `observability`.',
          '- `apps/worker` may import `domain`.',
          '```mermaid',
          'flowchart TD',
          '  worker["apps/worker"]',
          '  obs["packages/observability"]',
          '  worker --> obs',
          '```',
        ].join('\n'),
      },
      findStaleClaims,
    );
    const expected = [
      ['AGENTS.md:1', '[path]', 'packages/domain/src/gone.ts'],
      ['AGENTS.md:2', '[script]', 'pnpm lint:boundaries'],
      ['AGENTS.md:3', '[script]', 'nope'],
      ['AGENTS.md:4', '[package]', '@between-moves/config'],
      ['AGENTS.md:5', '[symbol]', 'renamedFunction'],
      ['AGENTS.md:6', '[path]', 'ops/gone.md'],
      ['AGENTS.md:8', '[script]', 'pnpm db:gone'],
      ['AGENTS.md:10', '[edge]', 'only `apps/worker` depends on `observability`'],
      ['AGENTS.md:11', '[edge]', '`apps/worker` may import domain'],
      ['AGENTS.md:16', '[edge]', 'diagram arrow apps/worker --> packages/observability'],
      ['AGENTS.md:12', '[edge]', 'package.json dependency apps/worker --> packages/domain'],
      ['eslint.config.mjs:1', '[package]', '@between-moves/config'],
    ];
    assert.equal(findings.length, expected.length, findings.join('\n'));
    for (const [at, kind, claim] of expected) {
      const hit = findings.find(
        (finding) => finding.startsWith(`${at} ${kind}`) && finding.includes(claim),
      );
      assert.ok(hit, `missing ${at} ${kind} ${claim} in\n${findings.join('\n')}`);
      assert.match(hit, /Fix: /);
    }
  });
});

describe('developer docs match the code', () => {
  it('names no path, script, package, symbol or dependency edge that is missing from the tree', async () => {
    const root = process.env.DOC_CLAIMS_ROOT
      ? resolve(process.env.DOC_CLAIMS_ROOT)
      : repositoryRoot;
    const findings = await findStaleClaims(root);
    assert.deepEqual(
      findings,
      [],
      `\nDocs name code that is not in the tree:\n${findings.join('\n')}\n`,
    );
  });
});
