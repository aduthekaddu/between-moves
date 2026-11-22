// Self-test for tooling/formal-check.mjs. It proves the runner can fail: a bug config
// that passes, a syntax error and a broken config must all exit nonzero.
// Needs Java 17+ or docker, so CI runs it in the formal-models job (`pnpm formal:selftest`),
// not in `pnpm test`.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const runner = join(here, 'formal-check.mjs');
const fixture = join(here, 'formal-fixtures', 'counter');
const scratch = [];

function folder(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

function copyOfFixture() {
  const dir = folder('formal-fixture-');
  cpSync(fixture, dir, { recursive: true });
  return dir;
}

function check(modelsDir) {
  const run = spawnSync(process.execPath, [runner, '--models', modelsDir], { encoding: 'utf8' });
  return { code: run.status, out: `${run.stdout}${run.stderr}` };
}

after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe('formal-check runner', () => {
  it('passes a model whose main config passes, and reports each failing bug config as the expected failure', () => {
    const { code, out } = check(fixture);
    assert.equal(code, 0, out);
    assert.match(out, /1 model\(s\), 2 bug config\(s\)/);
    assert.match(out, /ok\s+Counter\.cfg passes/);
    assert.match(
      out,
      /Counter\.bug-overshoot\.cfg fails as expected \(Invariant Bounded is violated\)/,
    );
    assert.match(
      out,
      /Counter\.bug-no-fairness\.cfg fails as expected \(Temporal properties were violated\)/,
    );
  });

  it('exits nonzero when a bug config passes', () => {
    const dir = copyOfFixture();
    cpSync(join(dir, 'Counter.cfg'), join(dir, 'Counter.bug-overshoot.cfg'));
    const { code, out } = check(dir);
    assert.notEqual(code, 0, out);
    assert.match(out, /FAIL Counter\.bug-overshoot\.cfg bug config passed/);
  });

  it('exits nonzero on a syntax error and does not count it as the expected failure', () => {
    const dir = copyOfFixture();
    const tla = join(dir, 'Counter.tla');
    writeFileSync(tla, readFileSync(tla, 'utf8').replace('Init == x = 0', 'Init == x = = 0'));
    const { code, out } = check(dir);
    assert.notEqual(code, 0, out);
    assert.doesNotMatch(out, /fails as expected/);
    assert.match(out, /FAIL Counter\.bug-overshoot\.cfg bug config failed for the wrong reason/);
    assert.match(out, /FAIL Counter\.cfg expected to pass/);
  });

  it('exits nonzero when a bug config names an invariant that does not exist', () => {
    const dir = copyOfFixture();
    writeFileSync(
      join(dir, 'Counter.bug-overshoot.cfg'),
      'CONSTANT Limit = 3\nSPECIFICATION BuggySpec\nINVARIANT NoSuchInvariant\n',
    );
    const { code, out } = check(dir);
    assert.notEqual(code, 0, out);
    assert.match(out, /FAIL Counter\.bug-overshoot\.cfg bug config failed for the wrong reason/);
  });

  it('exits nonzero for a bug config without a main config, and for a model without any config', () => {
    const dir = folder('formal-orphans-');
    writeFileSync(join(dir, 'Orphan.tla'), '---- MODULE Orphan ----\n====\n');
    writeFileSync(join(dir, 'Lonely.bug-x.cfg'), '');
    const { code, out } = check(dir);
    assert.notEqual(code, 0, out);
    assert.match(out, /FAIL Orphan\.tla: no Orphan\.cfg/);
    assert.match(out, /FAIL Lonely: bug configs exist but Lonely\.cfg does not/);
  });

  it('exits nonzero for a config name that is neither <Name>.cfg nor <Name>.bug-<slug>.cfg', () => {
    const dir = folder('formal-badname-');
    writeFileSync(join(dir, 'Counter.Bug_Two.cfg'), '');
    const { code, out } = check(dir);
    assert.notEqual(code, 0, out);
    assert.match(out, /FAIL Counter\.Bug_Two\.cfg: config name must be/);
  });

  it('passes and reports 0 models for an empty folder', () => {
    const { code, out } = check(folder('formal-empty-'));
    assert.equal(code, 0, out);
    assert.match(out, /0 model\(s\)/);
  });
});
