// Docs that name code which no longer exists must fail the build.
//
// The developer docs make five kinds of claims that can be checked against the tree:
//   path      a backticked repo path, or a relative markdown link, exists
//   script    `pnpm <script>` and `pnpm --filter <pkg> <script>` name a real package.json script
//   package   `@between-moves/<name>` is a workspace package (docs and eslint configs)
//   symbol    "`name` in `path/to/file.ts`" means the file contains `name`
//   edge      the package diagram, "only `a` depends on `b`", "`x` imports no workspace package"
//             and "`x` may import `y`" lists agree with the package.json dependencies and the
//             eslint allow-list
//
// The package diagram is the Mermaid block that follows DIAGRAM_MARKER. Other diagrams are not
// checked. The check fails when no doc has the marked diagram.
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
  statSync,
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
// A package name ends in a letter, digit or underscore, so a `.` or `-` that follows a name at
// the end of a sentence is punctuation and not part of it.
const PACKAGE_REF = /@between-moves\/([A-Za-z0-9._-]*[A-Za-z0-9_])/g;
const DIAGRAM_MARKER = '<!-- doc-claims: package-diagram -->';
const ESLINT_CONFIG = /^eslint\.config\.[cm]?[jt]s$/;
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
// Every other .md file in the repo is checked. Backticked paths are only checked under TOP_LEVEL_DIRS.
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
    .filter((file) => !EXCLUDED_DOCS.has(file));
}

// Yields { line, text, inFence, lang } for every line, tracking fenced code blocks.
function* docLines(source) {
  let fence = null;
  let lang = '';
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index];
    const marker = /^\s*(`{3,}|~{3,})/.exec(text);
    if (marker) {
      if (fence === null) {
        fence = marker[1];
        lang = text.trim().slice(marker[1].length).trim().split(/\s+/)[0].toLowerCase();
      } else if (marker[1].startsWith(fence[0]) && marker[1].length >= fence.length) {
        fence = null;
        lang = '';
      }
      continue;
    }
    yield { line: index + 1, text, inFence: fence !== null, lang };
  }
}

// Every `pnpm ...` command in a shell line: each part of an `a && b; c | d` chain, after any
// leading `$ ` prompt and `NAME=value` environment words.
function pnpmCommands(line) {
  return line
    .split(/\s*(?:&&|\|\||[|;>])\s*/)
    .map((part) =>
      part
        .trim()
        .replace(/^\$\s+/, '')
        .replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, ''),
    )
    .filter((part) => /^pnpm\s/.test(part));
}

function parsePnpm(command) {
  const words = command.trim().split(/\s+/);
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

// The ```mermaid block that follows each DIAGRAM_MARKER line. `chart` is null when the marker
// has no mermaid block right after it. Body lines are { line, text }.
function markedDiagrams(source) {
  const lines = source.split('\n');
  const found = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== DIAGRAM_MARKER) continue;
    let fence = index + 1;
    while (fence < lines.length && lines[fence].trim() === '') fence += 1;
    if (!/^\s*```mermaid\s*$/.test(lines[fence] ?? '')) {
      found.push({ line: index + 1, chart: null });
      continue;
    }
    const body = [];
    let end = fence + 1;
    for (; end < lines.length && !/^\s*```/.test(lines[end]); end += 1) {
      body.push({ line: end + 1, text: lines[end] });
    }
    found.push({ line: fence + 1, chart: { line: fence + 1, body } });
    index = end;
  }
  return found;
}

// Every eslint.config.* under root, as ESLint would load it: { file, entries }. Importing the
// config means a name built by a helper, or written with any quote style, is seen like any other.
async function loadEslintConfigs(root) {
  const loaded = [];
  for (const file of listFiles(root, (name) => ESLINT_CONFIG.test(name))) {
    const { default: exported } = await import(pathToFileURL(file).href);
    loaded.push({ file, entries: [await exported].flat() });
  }
  return loaded;
}

// Every string in a config value, skipping plugins and parsers, which are code, not settings.
function* configStrings(value, seen = new Set()) {
  if (typeof value === 'string') yield value;
  else if (Array.isArray(value)) for (const item of value) yield* configStrings(item, seen);
  else if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    for (const [key, item] of Object.entries(value)) {
      if (key !== 'plugins' && key !== 'parser') yield* configStrings(item, seen);
    }
  }
}

// What the root eslint config lets each workspace package import, decided by ESLint itself:
// { 'db' => { full: Set, typeOnly: Set } }. Subjects are `apps/<name>` for an app and `<name>` for
// a package. `full` names may be imported as values, `typeOnly` names only with `import type`.
// ESLint lints one probe file per subject that imports every other workspace package, so rule
// severity, later entries that override earlier ones, patterns and `allowTypeImports` all
// count as they do in `pnpm lint`.
async function lintAllowLists(root, entries, workspace) {
  const lists = new Map();
  if (entries.length === 0) return lists;
  const { ESLint } = await import('eslint');
  const { default: tsParser } = await import('@typescript-eslint/parser');
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [...entries, { files: ['**/*.ts'], languageOptions: { parser: tsParser } }],
  });
  const names = workspace
    .map((entry) => entry.manifest.name)
    .filter((name) => name?.startsWith(SCOPE_NAME));
  // Names of the packages that ESLint refuses to let `file` import with this statement.
  const refused = async (file, statement, others) => {
    const code = others.map((name) => statement(name)).join('\n');
    const [result] = await eslint.lintText(code, { filePath: join(root, file) });
    const fatal = result.messages.find((message) => message.fatal || message.ruleId === null);
    if (fatal) throw new Error(`eslint could not read the probe for ${file}: ${fatal.message}`);
    return new Set(
      result.messages
        .filter((message) => message.ruleId === 'no-restricted-imports')
        .map((message) => others[message.line - 1]),
    );
  };
  for (const entry of workspace) {
    if (!/^(?:apps|packages)\//.test(entry.dir)) continue;
    const others = names.filter((name) => name !== entry.manifest.name);
    const file = `${entry.dir}/src/probe.ts`;
    const values = await refused(file, (name) => `import '${name}';`, others);
    const types = await refused(file, (name) => `import type {} from '${name}';`, others);
    lists.set(entry.dir.replace(/^packages\//, ''), {
      full: new Set(
        others.filter((name) => !values.has(name)).map((name) => name.slice(SCOPE_NAME.length)),
      ),
      typeOnly: new Set(
        others
          .filter((name) => values.has(name) && !types.has(name))
          .map((name) => name.slice(SCOPE_NAME.length)),
      ),
    });
  }
  return lists;
}

// `<name>`, `*`, `...` and `NNNN` (a migration number) stand for a value, not a real name.
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
  const bySubject = (token) => {
    const subject = token.replace(/^packages\//, '');
    return workspace.find((entry) =>
      subject.startsWith('apps/')
        ? entry.dir === subject
        : entry.manifest.name === `${SCOPE_NAME}${subject}`,
    );
  };
  const eslintConfigs = await loadEslintConfigs(root);
  const rootConfig = eslintConfigs.find(({ file }) => dirname(file) === root);
  let lintAllowedPromise;
  const lintAllowedLists = () => {
    lintAllowedPromise ??= lintAllowLists(root, rootConfig?.entries ?? [], workspace);
    return lintAllowedPromise;
  };
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

  // "Today only `apps/web` depends on `contracts`.", "`x` imports no workspace package." and the
  // bullet list of what a layer "may import", which AGENTS.md says is the lint allow-list.
  async function checkDependencyProse(doc, line, text) {
    for (const only of [
      /`([^`]+)` is the only workspace package that (?:declares a dependency on|depends on) `([^`]+)`/,
      /only `([^`]+)` depends on `([^`]+)`/,
    ]) {
      const match = only.exec(text);
      if (!match) continue;
      const target = bySubject(shortName(match[2]));
      const dependents = new Set(
        workspace
          .filter((entry) => target && dependenciesOf(entry).has(target.manifest.name))
          .map((entry) => entry.dir),
      );
      if (!target || !sameSet(dependents, new Set([match[1]]))) {
        report(
          doc,
          line,
          'edge',
          `only \`${match[1]}\` depends on \`${match[2]}\``,
          `disagrees with the package.json files, where the dependents are ${listOf(dependents)}.`,
        );
      }
    }
    const none =
      /((?:`[^`]+`(?:,\s*|\s+and\s+|,\s*and\s+)?)+)\s+depends? on no workspace package/.exec(text);
    for (const subject of none ? tokensIn(none[1]) : []) {
      const entry = bySubject(subject);
      if (!entry || dependenciesOf(entry).size > 0) {
        report(
          doc,
          line,
          'edge',
          `\`${subject}\` depends on no workspace package`,
          `disagrees with its package.json, which depends on ${entry ? listOf([...dependenciesOf(entry)].map(shortName)) : 'no such package'}.`,
        );
      }
    }
    const imports = /^- (.+?) imports no workspace package\b/.exec(text);
    for (const subject of imports ? tokensIn(imports[1]) : []) {
      const allowed = (await lintAllowedLists()).get(subject);
      const entry = bySubject(subject);
      const lintNames = allowed ? [...allowed.full, ...allowed.typeOnly] : [];
      const depNames = entry ? [...dependenciesOf(entry)].map(shortName) : [];
      if (!allowed || !entry || lintNames.length > 0 || depNames.length > 0) {
        report(
          doc,
          line,
          'edge',
          `\`${subject}\` imports no workspace package`,
          `disagrees with eslint.config.mjs (${allowed ? listOf(lintNames) : 'no entry for it'}) or package.json (${listOf(depNames)}).`,
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
      const typeOnlyClaim = /only with `import type`/.test(may[2]);
      const claimedFull = typeOnlyClaim ? new Set() : claimed;
      const claimedTypeOnly = typeOnlyClaim ? claimed : new Set();
      for (const subject of tokensIn(may[1])) {
        const allowed = (await lintAllowedLists()).get(subject);
        if (
          !allowed ||
          !sameSet(allowed.full, claimedFull) ||
          !sameSet(allowed.typeOnly, claimedTypeOnly)
        ) {
          const actual = allowed
            ? `${listOf(allowed.full)}${allowed.typeOnly.size ? `, and ${listOf(allowed.typeOnly)} only as a type` : ''}`
            : 'no entry for it';
          report(
            doc,
            line,
            'edge',
            `\`${subject}\` may import ${listOf(claimed)}${typeOnlyClaim ? ' only as a type' : ''}`,
            `disagrees with eslint.config.mjs, which allows ${actual}.`,
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

  // The package diagram: every node is a workspace package, each arrow is a dependency in a
  // package.json, and each dependency is an arrow. A line it cannot read is a finding, so a
  // change of form cannot turn the check off.
  function checkDiagram(doc, chart) {
    const ids = new Map();
    const drawn = new Map();
    const unreadable = (line, text, why) =>
      report(doc, line, 'edge', `\`${text.trim()}\``, `${why} The checker cannot read it.`);
    const lines = chart.body.filter(({ text }) => text.trim() !== '' && !/^\s*%%/.test(text));
    const [first, ...rest] = lines;
    if (!first || !/^\s*(?:flowchart|graph)\s+(?:TD|TB|BT|LR|RL)\s*$/.test(first.text)) {
      report(
        doc,
        first?.line ?? chart.line,
        'edge',
        'the package diagram',
        'is not a `flowchart TD` block, which is the only form the checker reads.',
      );
      return;
    }
    for (const { line, text } of rest) {
      const node = /^\s*(\w+)\["([^"]+)"\]\s*$/.exec(text);
      if (node) {
        const entry = workspace.find((e) => e.dir === node[2] && e.dir !== '.');
        if (!entry) {
          report(doc, line, 'edge', `node \`${node[2]}\``, 'is not a workspace package.');
        }
        ids.set(node[1], node[2]);
      } else if (/^\s*\w+(?:\s*-->\s*\w+)+\s*$/.test(text)) {
        const chain = text.split('-->').map((id) => id.trim());
        for (let at = 0; at + 1 < chain.length; at += 1) {
          const [from, to] = [ids.get(chain[at]), ids.get(chain[at + 1])];
          if (!from || !to) {
            report(
              doc,
              line,
              'edge',
              `\`${text.trim()}\``,
              'uses an id that has no labelled node.',
            );
          } else drawn.set(`${from} --> ${to}`, line);
        }
      } else unreadable(line, text, 'Only `id["label"]` nodes and `a --> b` arrows are allowed.');
    }
    const real = new Set();
    for (const entry of workspace.filter((e) => e.dir !== '.')) {
      for (const dep of dependenciesOf(entry)) {
        real.add(`${entry.dir} --> ${workspace.find((e) => e.manifest.name === dep).dir}`);
      }
    }
    const labelled = new Set(ids.values());
    for (const entry of workspace.filter((e) => e.dir !== '.')) {
      if (!labelled.has(entry.dir)) {
        report(
          doc,
          chart.line,
          'edge',
          `node \`${entry.dir}\``,
          'is missing from the diagram. Every workspace package needs a node, even one with no dependency.',
        );
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
    for (const match of text.matchAll(PACKAGE_REF)) {
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
    return statSync(full).isDirectory()
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

  let packageDiagrams = 0;
  for (const doc of docFiles(root)) {
    const docDir = dirname(doc);
    const source = readFileSync(join(root, doc), 'utf8');
    for (const { line, chart } of markedDiagrams(source)) {
      if (chart) {
        packageDiagrams += 1;
        checkDiagram(doc, chart);
      } else {
        report(doc, line, 'edge', 'the package diagram marker', 'has no mermaid block after it.');
      }
    }
    for (const { line, text, inFence, lang } of docLines(source)) {
      if (inFence) {
        if (['', 'bash', 'sh', 'shell', 'console', 'zsh'].includes(lang)) {
          for (const command of pnpmCommands(text)) checkScript(doc, line, command);
          checkPackageNames(doc, line, text);
          for (const word of text.split(/[\s=]+/)) {
            if (word.includes('/') && !isPlaceholder(word) && repoPath.test(word)) {
              checkPath(doc, line, word);
            }
          }
        }
        continue;
      }

      checkPackageNames(doc, line, text);
      await checkDependencyProse(doc, line, text);

      for (const match of text.matchAll(/`([^`]+)`/g)) {
        const token = match[1].trim();
        const commands = pnpmCommands(token);
        if (commands.length > 0) {
          for (const command of commands) checkScript(doc, line, command);
        } else if (isPlaceholder(token) || token.includes(' ')) continue;
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

  // The package diagram must exist while the workspace has dependencies to draw.
  const hasEdges = workspace.some((entry) => dependenciesOf(entry).size > 0);
  if (hasEdges && packageDiagrams === 0) {
    report(
      'ARCHITECTURE.md',
      1,
      'edge',
      'the package diagram',
      `is missing: no doc has a mermaid flowchart right after \`${DIAGRAM_MARKER}\`.`,
    );
  }

  // A lint allow-list that names a package that does not exist is the same mistake in code.
  for (const { file, entries } of eslintConfigs) {
    const source = readFileSync(file, 'utf8');
    const names = new Set();
    for (const text of configStrings(entries)) {
      for (const match of text.matchAll(PACKAGE_REF)) {
        names.add(`${SCOPE_NAME}${match[1]}`);
      }
    }
    for (const name of [...names].filter((candidate) => !packageNames.has(candidate))) {
      const at = source.indexOf(name);
      const line = at < 0 ? 1 : source.slice(0, at).split('\n').length;
      findings.push(
        `${relative(root, file)}:${line} [package] \`${name}\` is not a workspace package. ` +
          'Fix: remove it from the allow-list, or create the package in the same commit.',
      );
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
  'package.json': JSON.stringify({
    name: 'root',
    type: 'module',
    scripts: { check: 'x', 'test:e2e': 'x' },
  }),
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
          DIAGRAM_MARKER,
          '```mermaid',
          'flowchart TD',
          '  worker["apps/worker"]',
          '  domain["packages/domain"]',
          '  obs["packages/observability"]',
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
        'eslint.config.mjs': `export default [${JSON.stringify(
          allowList('apps/worker/src/**/*.ts', 'domain', 'observability', 'config'),
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
          DIAGRAM_MARKER,
          '```mermaid',
          'flowchart TD',
          '  worker["apps/worker"]',
          '  domain["packages/domain"]',
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
      ['AGENTS.md:18', '[edge]', 'diagram arrow apps/worker --> packages/observability'],
      ['AGENTS.md:13', '[edge]', 'package.json dependency apps/worker --> packages/domain'],
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

// README.md carries a correct package diagram unless a test replaces it.
const findingsFor = (files) =>
  withTree({ ...fixtureFiles, 'README.md': diagramDoc(...goodDiagram), ...files }, findStaleClaims);
const mentions = (findings, ...parts) =>
  findings.filter((finding) => parts.every((part) => finding.includes(part)));

const diagramDoc = (...body) => [DIAGRAM_MARKER, '```mermaid', ...body, '```'].join('\n');
const goodDiagram = [
  'flowchart TD',
  '  worker["apps/worker"]',
  '  domain["packages/domain"]',
  '  obs["packages/observability"]',
  '  worker --> domain',
];

describe('eslint configs', () => {
  const ghostPatterns = [
    '!@between-moves/ghost',
    '!@between-moves/ghost/*',
    '@between-moves/ghost/*',
  ];
  const forms = {
    'eslint.config.mjs': (list) => `export default [${list}];\n`,
    'eslint.config.js': (list) => `export default [${list}];\n`,
    'eslint.config.cjs': (list) => `module.exports = [${list}];\n`,
    'eslint.config.ts': (list) => `const entries: object[] = [${list}];\nexport default entries;\n`,
  };
  for (const [name, wrap] of Object.entries(forms)) {
    for (const pattern of ghostPatterns) {
      for (const quote of ["'", '"']) {
        it(`flags ${quote}${pattern}${quote} in apps/web/${name}`, async () => {
          const entry = `{ files: ['a.ts'], rules: { 'no-restricted-imports': ['error', { patterns: [{ group: [${quote}${pattern}${quote}] }] }] } }`;
          const findings = await findingsFor({ [`apps/web/${name}`]: wrap(entry) });
          assert.equal(mentions(findings, `apps/web/${name}`, '@between-moves/ghost').length, 1);
        });
      }
    }
  }

  it('flags a name that a helper function builds', async () => {
    const findings = await findingsFor({
      'eslint.config.mjs': [
        'const from = (names) => names.map((name) => `!@between-moves/${name}`);',
        "export default [{ files: ['apps/worker/src/**/*.ts'], rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['@between-moves/*', ...from(['domain', 'ghost'])] }] }] } }];",
      ].join('\n'),
    });
    assert.equal(mentions(findings, 'eslint.config.mjs', '@between-moves/ghost').length, 1);
  });

  it('accepts real package names in every form', async () => {
    const entry =
      "{ files: ['a.ts'], rules: { 'no-restricted-imports': ['error', { patterns: [{ group: [\"@between-moves/*\", '!@between-moves/domain', \"!@between-moves/domain/*\"] }] }] } }";
    assert.deepEqual(
      await findingsFor({ 'apps/web/eslint.config.cjs': forms['eslint.config.cjs'](entry) }),
      [],
    );
  });
});

describe('package diagram', () => {
  const doc = (...body) => ({ 'AGENTS.md': diagramDoc(...body) });

  it('ignores a flowchart that is not marked as the package diagram', async () => {
    const findings = await findingsFor({
      'AGENTS.md': [
        diagramDoc(...goodDiagram),
        '```mermaid',
        'flowchart LR',
        '  request["Request"] --> handler["Handler"]',
        '  lonely["Not a package"]',
        '```',
      ].join('\n'),
    });
    assert.deepEqual(findings, []);
  });

  it('fails when no doc carries the package diagram', async () => {
    const findings = await findingsFor({ 'README.md': 'No diagram here.\n' });
    assert.equal(mentions(findings, '[edge]', 'package diagram').length, 1, findings.join('\n'));
  });

  it('fails when the marked diagram is not a flowchart', async () => {
    const findings = await findingsFor(doc('stateDiagram-v2', '  [*] --> A'));
    assert.ok(mentions(findings, '[edge]', 'flowchart').length >= 1, findings.join('\n'));
  });

  it('fails when the marker has no mermaid block after it', async () => {
    const findings = await findingsFor({ 'AGENTS.md': `${DIAGRAM_MARKER}\n\nText.\n` });
    assert.ok(mentions(findings, '[edge]', 'package diagram').length >= 1);
  });

  it('accepts `graph TD`', async () => {
    const findings = await findingsFor(doc('graph TD', ...goodDiagram.slice(1)));
    assert.deepEqual(findings, []);
  });

  it('flags an isolated node that is not a workspace package', async () => {
    const findings = await findingsFor(doc(...goodDiagram, '  ghost["packages/config"]'));
    assert.equal(mentions(findings, 'packages/config', 'not a workspace package').length, 1);
  });

  it('flags a workspace package that has no node in the diagram', async () => {
    const findings = await findingsFor({
      'README.md': diagramDoc(
        'flowchart TD',
        '  worker["apps/worker"]',
        '  domain["packages/domain"]',
        '  worker --> domain',
      ),
    });
    assert.equal(mentions(findings, 'node `packages/observability`', 'missing from the diagram').length, 1);
  });

  it('flags an edge to an id with no label', async () => {
    const findings = await findingsFor(doc(...goodDiagram, '  worker --> nowhere'));
    assert.equal(mentions(findings, 'worker --> nowhere').length, 1);
  });

  it('flags an arrow form it cannot read', async () => {
    const findings = await findingsFor(doc(...goodDiagram, '  worker -.-> domain'));
    assert.equal(mentions(findings, 'worker -.-> domain', 'cannot read').length, 1);
  });
});

describe('prose claims', () => {
  it('reads a package name without the punctuation that follows it', async () => {
    const findings = await findingsFor({
      'AGENTS.md': [
        'Only @between-moves/domain.',
        'And @between-moves/domain, then @between-moves/domain;',
        'and (@between-moves/ghost).',
      ].join('\n'),
    });
    assert.deepEqual(
      findings.map((finding) => finding.replace(/ Fix: .*/, '')),
      ['AGENTS.md:3 [package] `@between-moves/ghost` is not a workspace package.'],
    );
  });

  it('flags `imports no workspace package` when lint allows one', async () => {
    const findings = await findingsFor({
      'AGENTS.md': '- `apps/worker` imports no workspace package.\n',
    });
    assert.equal(mentions(findings, '[edge]', 'apps/worker', 'no workspace package').length, 1);
  });

  it('flags `depend on no workspace package` when a package.json has a dependency', async () => {
    const findings = await findingsFor({
      'AGENTS.md': '`apps/worker` and `packages/domain` depend on no workspace package.\n',
    });
    assert.equal(mentions(findings, '[edge]', 'apps/worker').length, 1);
    assert.equal(mentions(findings, 'packages/domain').length, 0);
  });

  it('flags `is the only workspace package that declares a dependency on`', async () => {
    const wrong =
      '`packages/observability` is the only workspace package that declares a dependency on `domain`.\n';
    assert.equal(mentions(await findingsFor({ 'AGENTS.md': wrong }), '[edge]', 'domain').length, 1);
    const right =
      '`apps/worker` is the only workspace package that declares a dependency on `domain`.\n';
    assert.deepEqual(mentions(await findingsFor({ 'AGENTS.md': right }), '[edge]'), []);
  });

  const lint = (entries) => ({
    'eslint.config.mjs': `export default ${JSON.stringify(entries)};\n`,
  });
  const restrict = (files, ...patterns) => ({
    files,
    rules: { 'no-restricted-imports': ['error', { patterns }] },
  });

  it('reads every glob in `files`', async () => {
    const findings = await findingsFor({
      ...lint([
        restrict(['packages/domain/src/**/*.ts', 'apps/worker/src/**/*.ts'], {
          group: ['@between-moves/*', '!@between-moves/domain'],
        }),
      ]),
      'AGENTS.md': '- `apps/worker` may import `domain`.\n',
    });
    assert.deepEqual(mentions(findings, '[edge]'), []);
  });

  it('reads every pattern, not only the first', async () => {
    const files = lint([
      restrict(
        ['apps/worker/src/**/*.ts'],
        { group: ['@between-moves/*', '!@between-moves/domain', '!@between-moves/observability'] },
        { group: ['@between-moves/observability', '@between-moves/observability/*'] },
      ),
    ]);
    const findings = await findingsFor({
      ...files,
      'AGENTS.md': '- `apps/worker` may import `domain` and `observability`.\n',
    });
    assert.equal(mentions(findings, '[edge]', 'apps/worker').length, 1, findings.join('\n'));
  });

  it('checks the type-only rule', async () => {
    const files = lint([
      restrict(
        ['packages/domain/src/**/*.ts'],
        { group: ['@between-moves/*', '!@between-moves/observability'] },
        {
          group: ['@between-moves/observability', '@between-moves/observability/*'],
          allowTypeImports: true,
        },
      ),
    ]);
    const typeOnly =
      '- `domain` may import `@between-moves/observability` only with `import type`.\n';
    const plain = '- `domain` may import `observability`.\n';
    assert.deepEqual(
      mentions(await findingsFor({ ...files, 'AGENTS.md': typeOnly }), '[edge]'),
      [],
    );
    assert.equal(mentions(await findingsFor({ ...files, 'AGENTS.md': plain }), '[edge]').length, 1);
    const open = lint([
      restrict(['packages/domain/src/**/*.ts'], {
        group: ['@between-moves/*', '!@between-moves/observability'],
      }),
    ]);
    assert.equal(
      mentions(await findingsFor({ ...open, 'AGENTS.md': typeOnly }), '[edge]').length,
      1,
    );
  });

  describe('reads the config the way ESLint resolves it', () => {
    const worker = ['apps/worker/src/**/*.ts'];
    const allowDomain = { group: ['@between-moves/*', '!@between-moves/domain'] };
    const mayImportDomain = '- `apps/worker` may import `domain`.\n';
    const edgeFindings = async (entries, doc) =>
      mentions(await findingsFor({ ...lint(entries), 'AGENTS.md': doc }), '[edge]');

    it('treats a rule set to off, in any spelling, as allowing every package', async () => {
      for (const severity of ['off', 0]) {
        const entry = {
          files: worker,
          rules: { 'no-restricted-imports': [severity, { patterns: [allowDomain] }] },
        };
        assert.equal(
          (await edgeFindings([entry], mayImportDomain)).length,
          1,
          `severity ${severity}`,
        );
      }
    });

    it('lets a later entry that turns the rule off override an earlier allow-list', async () => {
      const off = { files: worker, rules: { 'no-restricted-imports': 'off' } };
      const findings = await edgeFindings([restrict(worker, allowDomain), off], mayImportDomain);
      assert.equal(findings.length, 1, findings.join('\n'));
    });

    it('lets a later entry that replaces the allow-list override an earlier one', async () => {
      const replace = restrict(worker, {
        group: ['@between-moves/*', '!@between-moves/observability'],
      });
      const entries = [restrict(worker, allowDomain), replace];
      assert.equal((await edgeFindings(entries, mayImportDomain)).length, 1);
      const claimsObservability = '- `apps/worker` may import `observability`.\n';
      assert.deepEqual(await edgeFindings(entries, claimsObservability), []);
    });

    it('treats patterns that do not restrict workspace packages as allowing all of them', async () => {
      const unrelated = restrict(['packages/observability/src/**/*.ts'], { group: ['node:fs'] });
      const noImports = '- `observability` imports no workspace package.\n';
      assert.equal((await edgeFindings([unrelated], noImports)).length, 1);
      const onlyOneBanned = restrict(['packages/observability/src/**/*.ts'], {
        group: ['@between-moves/db'],
      });
      assert.equal((await edgeFindings([onlyOneBanned], noImports)).length, 1);
    });

    it('accepts `imports no workspace package` when every workspace import is banned', async () => {
      const banned = restrict(['packages/observability/src/**/*.ts'], {
        group: ['@between-moves/*'],
      });
      assert.deepEqual(
        await edgeFindings([banned], '- `observability` imports no workspace package.\n'),
        [],
      );
    });

    it('honors allowTypeImports on the `@between-moves/*` group', async () => {
      const entries = [restrict(worker, { group: ['@between-moves/*'], allowTypeImports: true })];
      const plain = '- `apps/worker` may import `domain` and `observability`.\n';
      assert.equal((await edgeFindings(entries, plain)).length, 1);
      const typeOnly =
        '- `apps/worker` may import `domain` and `observability` only with `import type`.\n';
      assert.deepEqual(await edgeFindings(entries, typeOnly), []);
    });
  });
});

describe('commands and files', () => {
  it('checks every command in a chain', async () => {
    const findings = await findingsFor({
      'AGENTS.md': [
        'Run `pnpm check && pnpm gone` then `pnpm check; pnpm also-gone`.',
        '```bash',
        'pnpm check && pnpm fenced-gone',
        '```',
      ].join('\n'),
    });
    assert.equal(mentions(findings, 'pnpm gone').length, 1);
    assert.equal(mentions(findings, 'pnpm also-gone').length, 1);
    assert.equal(mentions(findings, 'pnpm fenced-gone').length, 1);
  });

  it('checks inline commands the way fenced ones are checked', async () => {
    const findings = await findingsFor({
      'AGENTS.md': [
        'Run `APP_ENV=production pnpm env-gone`.',
        'Run `$ pnpm prompt-gone`.',
        'Run `cd apps/worker && pnpm cd-gone`.',
        'Run `pnpm check` and `cd apps/worker && pnpm trigger:deploy`.',
      ].join('\n'),
    });
    assert.equal(mentions(findings, '[script]', 'pnpm env-gone').length, 1, findings.join('\n'));
    assert.equal(mentions(findings, '[script]', 'pnpm prompt-gone').length, 1);
    assert.equal(mentions(findings, '[script]', 'pnpm cd-gone').length, 1);
    assert.equal(mentions(findings, '[script]').length, 3);
  });

  it('checks fenced commands that start with environment variables', async () => {
    const findings = await findingsFor({
      'AGENTS.md': ['```bash', 'APP_ENV=production TEST_DATABASE_URL=x pnpm env-gone', '```'].join(
        '\n',
      ),
    });
    assert.equal(mentions(findings, 'pnpm env-gone').length, 1);
  });

  it('checks package names and repo paths in fenced shell commands', async () => {
    const findings = await findingsFor({
      'AGENTS.md': [
        '```bash',
        'psql -f ops/gone.sql',
        'pnpm --filter @between-moves/ghost check',
        '```',
      ].join('\n'),
    });
    assert.equal(mentions(findings, '[path]', 'ops/gone.sql').length, 1);
    assert.equal(mentions(findings, '[script]', '@between-moves/ghost').length, 1);
  });

  it('reads a symbol claim against a dotted directory and an extensionless file', async () => {
    const findings = await findingsFor({
      '.github/workflows/ci.yml': 'name: ci\n',
      'ops/Dockerfile': 'FROM node\n',
      'AGENTS.md': [
        '`ci` in `.github` and `FROM` in `ops/Dockerfile` are real.',
        '`missing` in `.github` is wrong.',
      ].join('\n'),
    });
    assert.equal(mentions(findings, '[symbol]').length, 1, findings.join('\n'));
    assert.equal(mentions(findings, 'missing').length, 1);
  });

  it('checks docs under docs/', async () => {
    const findings = await findingsFor({ 'docs/guide.md': 'See `packages/domain/src/gone.ts`.\n' });
    assert.equal(mentions(findings, 'docs/guide.md:1', '[path]').length, 1);
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
