// Hashes the state graph of architecture/models/board/BoardState.tla, as TLC explores it at the
// bounds in board-conformance.json. board-machine.conformance.test.ts walks board-machine.ts at the
// same bounds and must reach the same hash, so the model and the reducer cannot drift apart.
//
// Usage: node tooling/board-conformance.mjs [--write]
// Without --write, exit 1 when the model's hash differs from the summary file.

import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chooseRuntime, ensureJar, spawnTlc } from './formal-check.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modelFile = join(repoRoot, 'architecture', 'models', 'board', 'BoardState.tla');
const summaryFile = join(
  repoRoot,
  'apps/web/src/app/h/[houseId]/games/[gameId]/board-conformance.json',
);

/** Reads the values TLC prints: numbers, strings, booleans, records, tuples and sets. */
export function parseTla(text) {
  let at = 0;
  const skip = () => {
    while (/\s/.test(text[at] ?? '')) at += 1;
  };
  const expect = (token) => {
    skip();
    if (!text.startsWith(token, at)) throw new Error(`expected ${token} at ${at}: ${text.slice(at, at + 40)}`);
    at += token.length;
  };
  const list = (close, item) => {
    const items = [];
    skip();
    if (text.startsWith(close, at)) {
      at += close.length;
      return items;
    }
    for (;;) {
      items.push(item());
      skip();
      if (text.startsWith(close, at)) {
        at += close.length;
        return items;
      }
      expect(',');
    }
  };
  const value = () => {
    skip();
    if (text.startsWith('<<', at)) {
      at += 2;
      return list('>>', value);
    }
    if (text[at] === '{') {
      at += 1;
      return list('}', value).sort((a, b) => canonical(a).localeCompare(canonical(b)));
    }
    if (text[at] === '[') {
      at += 1;
      return Object.fromEntries(
        list(']', () => {
          skip();
          const name = /^\w+/.exec(text.slice(at))[0];
          at += name.length;
          expect('|->');
          return [name, value()];
        }),
      );
    }
    if (text[at] === '"') {
      const end = text.indexOf('"', at + 1);
      const string = text.slice(at + 1, end);
      at = end + 1;
      return string;
    }
    const word = /^(TRUE|FALSE|-?\d+)/.exec(text.slice(at));
    if (word === null) throw new Error(`cannot read a value at ${at}: ${text.slice(at, at + 40)}`);
    at += word[0].length;
    return word[0] === 'TRUE' ? true : word[0] === 'FALSE' ? false : Number(word[0]);
  };
  const result = value();
  skip();
  if (at !== text.length) throw new Error(`unread text at ${at}: ${text.slice(at, at + 40)}`);
  return result;
}

/** JSON with object keys sorted, so one state has one spelling. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function stateOf(label) {
  const state = {};
  for (const part of label.split(/^\/\\ /m).filter((chunk) => chunk.trim() !== '')) {
    const split = part.indexOf(' = ');
    state[part.slice(0, split).trim()] = parseTla(part.slice(split + 3).trim());
  }
  return state;
}

function unescapeDot(text) {
  return text.replace(/\\(.)/g, (_, char) => (char === 'n' ? '\n' : char));
}

/** The summary both sides compare: distinct states, edges between different states, and a hash. */
export function graphSummary(initial, edges) {
  const id = (state) => createHash('sha256').update(canonical(state)).digest('hex').slice(0, 16);
  const states = new Set();
  const lines = new Set();
  for (const state of initial) {
    states.add(id(state));
    lines.add(`init ${id(state)}`);
  }
  for (const [from, label, to] of edges) {
    const source = id(from);
    const target = id(to);
    states.add(source);
    states.add(target);
    if (source !== target) lines.add(`${source} ${label} ${target}`);
  }
  const sorted = [...lines].sort();
  return {
    states: states.size,
    edges: sorted.length - initial.length,
    sha256: createHash('sha256').update(sorted.join('\n')).digest('hex'),
    lines: sorted,
  };
}

export function readDot(dot) {
  const nodes = new Map();
  const initial = [];
  const edges = [];
  for (const line of dot.split('\n')) {
    const node = /^(-?\d+) \[label="(.*)"(,style = filled)?\];?$/.exec(line);
    if (node !== null) {
      const state = stateOf(unescapeDot(node[2]));
      nodes.set(node[1], state);
      if (node[3] !== undefined) initial.push(state);
      continue;
    }
    const edge = /^(-?\d+) -> (-?\d+) \[label="([^"]+)"/.exec(line);
    if (edge !== null) edges.push([edge[1], edge[3], edge[2]]);
  }
  return {
    initial,
    edges: edges.map(([from, label, to]) => [nodes.get(from), label, nodes.get(to)]),
  };
}

async function main(argv) {
  const summary = JSON.parse(readFileSync(summaryFile, 'utf8'));
  const work = mkdtempSync(join(tmpdir(), 'board-conformance-'));
  try {
    copyFileSync(modelFile, join(work, 'BoardState.tla'));
    const constants = Object.entries(summary.constants)
      .map(([name, value]) => `  ${name} = ${value}`)
      .join('\n');
    writeFileSync(join(work, 'BoardState.cfg'), `CONSTANTS\n${constants}\nSPECIFICATION Spec\n`);
    const runtime = chooseRuntime();
    const jar = await ensureJar();
    const run = spawnTlc(runtime, jar, { name: 'BoardState', dir: work }, work, 'BoardState.cfg', [
      '-dump',
      'dot,actionlabels',
      join(work, 'graph'),
    ]);
    if (run.exitCode !== 0) throw new Error(`TLC exited ${run.exitCode}\n${run.output}`);
    const { initial, edges } = readDot(readFileSync(join(work, 'graph.dot'), 'utf8'));
    const model = graphSummary(initial, edges);
    if (process.env.BOARD_GRAPH_OUT) writeFileSync(process.env.BOARD_GRAPH_OUT, model.lines.join('\n'));
    const found = { states: model.states, edges: model.edges, sha256: model.sha256 };
    console.log(`board-conformance: model graph ${JSON.stringify(found)}`);
    if (argv.includes('--write')) {
      writeFileSync(summaryFile, `${JSON.stringify({ ...summary, ...found }, null, 2)}\n`);
      console.log(`board-conformance: wrote ${summaryFile}`);
      return 0;
    }
    if (found.sha256 === summary.sha256) return 0;
    console.error(
      'board-conformance: the model graph differs from board-conformance.json. If the model change is intended, run node tooling/board-conformance.mjs --write and make board-machine.conformance.test.ts pass.',
    );
    return 1;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`board-conformance: ${error.message}`);
      process.exit(1);
    },
  );
}
