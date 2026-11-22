// Runs every TLA+ model under architecture/models with TLC.
//
// Layout: models may sit in architecture/models itself or in any subfolder, to any depth.
// Each folder is checked on its own, so `<Name>.tla` and its configs share a folder.
// Besides README.md, every file in the tree must be a .tla or a .cfg; anything else fails
// the run, so a renamed or misplaced file cannot go unchecked.
//
// File convention, one module per `<Name>.tla`:
//   <Name>.cfg                must pass.
//   <Name>.bug-<slug>.cfg     replays a past bug. It must FAIL with an invariant or
//                             property violation. A bug config that passes, or that
//                             fails for another reason (parse error, bad config,
//                             deadlock), fails the run.
//
// Usage: node tooling/formal-check.mjs [--models <dir>]
// Exit 0 when every config behaves as above. Exit 1 on any surprise.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pinned TLC. To upgrade, change the version and the hash together.
const TLA2TOOLS_VERSION = '1.7.4';
const TLA2TOOLS_SHA256 = '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88';
const TLA2TOOLS_URL = `https://github.com/tlaplus/tlaplus/releases/download/v${TLA2TOOLS_VERSION}/tla2tools.jar`;

// Used when `java` is not on PATH (or older than MIN_JAVA_MAJOR). Java 21.
const DOCKER_IMAGE =
  'eclipse-temurin@sha256:cd35bb33859641c5374415826a5951845104093eaa401cbe9d3d9023444f1c13';
const MIN_JAVA_MAJOR = 17;

// Fixed so a run is repeatable: one worker gives one breadth-first order, so the
// counterexample is the same each time. `-fp` pins the fingerprint function.
const TLC_FLAGS = ['-workers', '1', '-fp', '0', '-nowarning'];
const JVM_FLAGS = ['-XX:+UseParallelGC', '-Xmx2g'];
const TLC_TIMEOUT_MS = 10 * 60 * 1000;

// TLC exit codes (tlc2.output.EC / ExitStatus). Only these two count as "the model
// found the bug".
const EXIT_PASS = 0;
const EXIT_SAFETY_VIOLATION = 12; // invariant or action property
const EXIT_LIVENESS_VIOLATION = 13; // temporal property

const CFG_NAME = /^([A-Za-z][A-Za-z0-9_]*)(?:\.bug-([a-z0-9]+(?:-[a-z0-9]+)*))?\.cfg$/;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultModelsDir = join(repoRoot, 'architecture', 'models');

const STRAY_FILE = 'not a .tla, .cfg or README.md file, so nothing checks it';

/**
 * Walks `modelsDir`. Returns the models, each with the folder it lives in (`dir`) and its
 * path from `modelsDir` (`id`), plus every problem found.
 */
export function discoverModels(modelsDir) {
  const models = [];
  const problems = [];
  const visit = (dir, relDir) => {
    const at = (file) => (relDir ? `${relDir}/${file}` : file);
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    const files = [];
    for (const entry of entries) {
      if (entry.isDirectory()) visit(join(dir, entry.name), at(entry.name));
      else if (entry.isFile() && (/\.(tla|cfg)$/.test(entry.name) || entry.name === 'README.md'))
        files.push(entry.name);
      else problems.push(`${at(entry.name)}: ${STRAY_FILE}`);
    }
    models.push(...discoverFolder(dir, relDir, files, problems));
  };
  visit(modelsDir, '');
  return { models, problems };
}

function discoverFolder(dir, relDir, files, problems) {
  const at = (file) => (relDir ? `${relDir}/${file}` : file);
  const byName = new Map();
  const modelFor = (name) => {
    if (!byName.has(name))
      byName.set(name, {
        name,
        dir,
        id: at(name),
        tla: files.includes(`${name}.tla`),
        main: null,
        bugs: [],
      });
    return byName.get(name);
  };

  for (const file of files.filter((f) => f.endsWith('.cfg'))) {
    const match = CFG_NAME.exec(file);
    if (!match) {
      problems.push(
        `${at(file)}: config name must be <Name>.cfg or <Name>.bug-<slug>.cfg (slug is lower-case words joined by "-")`,
      );
      continue;
    }
    const [, name, slug] = match;
    if (slug) modelFor(name).bugs.push({ slug, cfg: file });
    else modelFor(name).main = file;
  }

  for (const file of files.filter((f) => f.endsWith('.tla'))) {
    const name = basename(file, '.tla');
    if (!byName.has(name)) problems.push(`${at(file)}: no ${name}.cfg, so nothing checks it`);
  }

  for (const model of byName.values()) {
    if (!model.tla) problems.push(`${model.id}: configs exist but ${model.name}.tla does not`);
    if (!model.main) problems.push(`${model.id}: bug configs exist but ${model.name}.cfg does not`);
  }

  return [...byName.values()];
}

/** What TLC's exit code means for a config that is expected to pass or to fail. */
export function judge(kind, exitCode, output) {
  if (kind === 'main') {
    return exitCode === EXIT_PASS
      ? { ok: true, summary: 'passes' }
      : { ok: false, summary: `expected to pass, TLC exited ${exitCode}`, showOutput: true };
  }
  if (exitCode === EXIT_SAFETY_VIOLATION || exitCode === EXIT_LIVENESS_VIOLATION) {
    return { ok: true, summary: `fails as expected (${violationOf(output)})` };
  }
  if (exitCode === EXIT_PASS) {
    return {
      ok: false,
      summary: 'bug config passed. The model no longer catches this bug, so the check cannot fail',
      showOutput: false,
    };
  }
  return {
    ok: false,
    summary: `bug config failed for the wrong reason (TLC exited ${exitCode}: ${errorOf(output)}). Only an invariant or property violation counts`,
    showOutput: true,
  };
}

function violationOf(output) {
  const match =
    /^Error: (Invariant .+ is violated|Action property .+ is violated|Temporal properties were violated)\.?$/m.exec(
      output,
    );
  return match ? match[1] : 'violation';
}

function errorOf(output) {
  const match = /^Error: (.+)$/m.exec(output);
  return match ? match[1] : 'no error line in TLC output';
}

function javaMajor(java) {
  const run = spawnSync(java, ['-version'], { encoding: 'utf8' });
  if (run.error || run.status !== 0) return null;
  const match = /version "(\d+)(?:\.(\d+))?/.exec(`${run.stdout}${run.stderr}`);
  if (!match) return null;
  return match[1] === '1' ? Number(match[2]) : Number(match[1]);
}

function chooseRuntime() {
  const major = javaMajor('java');
  if (major !== null && major >= MIN_JAVA_MAJOR)
    return { kind: 'java', label: `java ${major} on PATH` };
  const docker = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8',
  });
  if (docker.error || docker.status !== 0) {
    throw new Error(
      `Need Java ${MIN_JAVA_MAJOR}+ on PATH` +
        (major === null ? ' (found none)' : ` (found ${major})`) +
        ` or a working docker for ${DOCKER_IMAGE}.`,
    );
  }
  return { kind: 'docker', label: `docker ${DOCKER_IMAGE}` };
}

/** Absolute, because TLC runs in the model folder and docker needs an absolute bind path. */
export function jarLocation(env) {
  const cacheDir = env.FORMAL_CACHE_DIR || join(homedir(), '.cache', 'between-moves', 'tla2tools');
  return join(resolve(cacheDir), TLA2TOOLS_VERSION, 'tla2tools.jar');
}

async function ensureJar() {
  const jar = jarLocation(process.env);
  if (existsSync(jar) && sha256(readFileSync(jar)) === TLA2TOOLS_SHA256) return jar;

  const response = await fetch(TLA2TOOLS_URL);
  if (!response.ok) throw new Error(`Download of ${TLA2TOOLS_URL} failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== TLA2TOOLS_SHA256) {
    throw new Error(
      `tla2tools.jar ${TLA2TOOLS_VERSION} has SHA-256 ${actual}, expected ${TLA2TOOLS_SHA256}`,
    );
  }
  mkdirSync(dirname(jar), { recursive: true });
  const partial = `${jar}.${process.pid}.tmp`;
  writeFileSync(partial, bytes);
  renameSync(partial, jar);
  return jar;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function runTlc(runtime, jar, model, cfg) {
  // TLC names its state folder after the current second, so two runs must not share a metadir.
  const metaDir = mkdtempSync(join(tmpdir(), 'formal-check-'));
  try {
    return spawnTlc(runtime, jar, model, metaDir, cfg);
  } finally {
    rmSync(metaDir, { recursive: true, force: true });
  }
}

function spawnTlc(runtime, jar, model, metaDir, cfg) {
  const tlcArgs = [
    'tlc2.TLC',
    ...TLC_FLAGS,
    '-metadir',
    metaDir,
    '-config',
    cfg,
    `${model.name}.tla`,
  ];
  const [command, args] =
    runtime.kind === 'java'
      ? ['java', [...JVM_FLAGS, '-cp', jar, ...tlcArgs]]
      : [
          'docker',
          [
            'run',
            '--rm',
            '--network',
            'none',
            ...dockerUser(),
            '-v',
            `${model.dir}:/models:ro`,
            '-v',
            `${jar}:/tla2tools.jar:ro`,
            '-v',
            `${metaDir}:/meta`,
            '-w',
            '/models',
            DOCKER_IMAGE,
            'java',
            ...JVM_FLAGS,
            '-cp',
            '/tla2tools.jar',
            ...tlcArgs.map((arg) => (arg === metaDir ? '/meta' : arg)),
          ],
        ];
  const run = spawnSync(command, args, {
    cwd: model.dir,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: TLC_TIMEOUT_MS,
  });
  if (run.error) return { exitCode: -1, output: `could not run TLC: ${run.error.message}` };
  return { exitCode: run.status ?? -1, output: `${run.stdout}${run.stderr}` };
}

// Run as the caller so the metadir files belong to them. Windows has no uid.
function dockerUser() {
  return process.getuid && process.getgid
    ? ['--user', `${process.getuid()}:${process.getgid()}`]
    : [];
}

function indent(text) {
  return text
    .trimEnd()
    .split('\n')
    .map((line) => `    | ${line}`)
    .join('\n');
}

const USAGE = 'Usage: node tooling/formal-check.mjs [--models <dir>]';

export function parseArgs(argv) {
  if (argv.length === 0) return { modelsDir: defaultModelsDir };
  const [flag, value, ...rest] = argv;
  if (flag !== '--models' || value === undefined || value.startsWith('--') || rest.length > 0) {
    throw new Error(`unexpected arguments: ${argv.join(' ')}. ${USAGE}`);
  }
  return { modelsDir: resolve(value) };
}

export async function main(argv) {
  const { modelsDir } = parseArgs(argv);
  if (!existsSync(modelsDir)) {
    console.error(`formal-check: models folder not found: ${modelsDir}`);
    return 1;
  }

  const { models, problems } = discoverModels(modelsDir);
  const bugCount = models.reduce((sum, model) => sum + model.bugs.length, 0);
  console.log(`formal-check: ${models.length} model(s), ${bugCount} bug config(s) in ${modelsDir}`);

  let failures = problems.length;
  for (const problem of problems) console.log(`FAIL ${problem}`);

  const runnable = models.filter((model) => model.main && model.tla);
  if (runnable.length === 0) {
    console.log(
      failures === 0 ? 'formal-check: nothing to run' : `formal-check: ${failures} problem(s)`,
    );
    return failures === 0 ? 0 : 1;
  }

  const runtime = chooseRuntime();
  const jar = await ensureJar();
  console.log(`formal-check: TLC ${TLA2TOOLS_VERSION} via ${runtime.label}`);
  for (const model of runnable) {
    const configs = [
      { kind: 'main', cfg: model.main },
      ...model.bugs.map((bug) => ({ kind: 'bug', cfg: bug.cfg })),
    ];
    for (const { kind, cfg } of configs) {
      const started = Date.now();
      const { exitCode, output } = runTlc(runtime, jar, model, cfg);
      const verdict = judge(kind, exitCode, output);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      const shown = model.id === model.name ? cfg : `${dirname(model.id)}/${cfg}`;
      console.log(`${verdict.ok ? 'ok  ' : 'FAIL'} ${shown} ${verdict.summary} [${seconds}s]`);
      if (!verdict.ok) {
        failures += 1;
        if (verdict.showOutput) console.log(indent(output));
      }
    }
  }

  console.log(
    failures === 0
      ? 'formal-check: all models behave as expected'
      : `formal-check: ${failures} problem(s)`,
  );
  return failures === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`formal-check: ${error.message}`);
      process.exit(1);
    },
  );
}
