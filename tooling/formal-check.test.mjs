// Self-test for tooling/formal-check.mjs. It proves the runner can fail: a bug config
// that passes, a syntax error and a broken config must all exit nonzero.
// Needs Java 17+ or docker, so CI runs it in the formal-models job (`pnpm formal:selftest`),
// not in `pnpm test`.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { jarLocation } from './formal-check.mjs';

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

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [runner, ...args], { encoding: 'utf8', ...options });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

function check(modelsDir, options) {
  return run(['--models', modelsDir], options);
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

  it('exits nonzero when a bug config deadlocks instead of violating an invariant', () => {
    const dir = copyOfFixture();
    // BuggySpec runs past Limit and gets stuck. Without an invariant, TLC reports a deadlock.
    writeFileSync(
      join(dir, 'Counter.bug-overshoot.cfg'),
      'CONSTANT Limit = 3\nSPECIFICATION BuggySpec\n',
    );
    const { code, out } = check(dir);
    assert.notEqual(code, 0, out);
    assert.doesNotMatch(out, /Counter\.bug-overshoot\.cfg fails as expected/);
    assert.match(
      out,
      /FAIL Counter\.bug-overshoot\.cfg bug config failed for the wrong reason \(TLC exited 11: Deadlock reached/,
    );
  });

  it('checks a model that sits in a subfolder, and names the folder in each line', () => {
    const dir = folder('formal-nested-');
    cpSync(fixture, join(dir, 'nudge', 'outbox'), { recursive: true });
    const { code, out } = check(dir);
    assert.equal(code, 0, out);
    assert.match(out, /1 model\(s\), 2 bug config\(s\)/);
    assert.match(out, /ok\s+nudge\/outbox\/Counter\.cfg passes/);
    assert.match(out, /ok\s+nudge\/outbox\/Counter\.bug-overshoot\.cfg fails as expected/);
  });

  it('fails a model in a subfolder whose bug config passes', () => {
    const dir = folder('formal-nested-bug-');
    cpSync(fixture, join(dir, 'board'), { recursive: true });
    cpSync(join(dir, 'board', 'Counter.cfg'), join(dir, 'board', 'Counter.bug-overshoot.cfg'));
    const { code, out } = check(dir);
    assert.notEqual(code, 0, out);
    assert.match(out, /FAIL board\/Counter\.bug-overshoot\.cfg bug config passed/);
  });

  it('keeps each folder separate: a config does not pair with a .tla in another folder', () => {
    const dir = folder('formal-split-');
    mkdirSync(join(dir, 'a'));
    mkdirSync(join(dir, 'b'));
    cpSync(join(fixture, 'Counter.tla'), join(dir, 'a', 'Counter.tla'));
    cpSync(join(fixture, 'Counter.cfg'), join(dir, 'b', 'Counter.cfg'));
    const { code, out } = check(dir);
    assert.notEqual(code, 0, out);
    assert.match(out, /FAIL a\/Counter\.tla: no Counter\.cfg/);
    assert.match(out, /FAIL b\/Counter: configs exist but Counter\.tla does not/);
  });

  it('exits nonzero for a file that is not .tla, .cfg or README.md, at the top and in a subfolder', () => {
    const dir = folder('formal-stray-');
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'Counter.cfg.disabled'), '');
    writeFileSync(join(dir, 'sub', 'notes.txt'), '');
    writeFileSync(join(dir, 'README.md'), '# fine\n');
    writeFileSync(join(dir, 'sub', 'README.md'), '# fine\n');
    const { code, out } = check(dir);
    assert.notEqual(code, 0, out);
    assert.match(out, /FAIL Counter\.cfg\.disabled: not a \.tla, \.cfg or README\.md file/);
    assert.match(out, /FAIL sub\/notes\.txt: not a \.tla, \.cfg or README\.md file/);
    assert.doesNotMatch(out, /README\.md: not a/);
  });

  it('accepts a relative FORMAL_CACHE_DIR, which TLC must not read from its own working folder', () => {
    const cwd = folder('formal-cache-cwd-');
    const downloaded = jarLocation({});
    assert.ok(existsSync(downloaded), `the earlier tests should have downloaded ${downloaded}`);
    const inCwd = jarLocation({ FORMAL_CACHE_DIR: join(cwd, 'cache') });
    mkdirSync(dirname(inCwd), { recursive: true });
    copyFileSync(downloaded, inCwd);
    const { code, out } = check(fixture, {
      cwd,
      env: { ...process.env, FORMAL_CACHE_DIR: 'cache' },
    });
    assert.equal(code, 0, out);
  });

  it('rejects an unknown argument, a stray positional and a missing --models value', () => {
    for (const args of [['--model', fixture], [fixture], ['--models'], ['--models', '--other']]) {
      const { code, out } = run(args);
      assert.notEqual(code, 0, `${args.join(' ')}: ${out}`);
      assert.match(
        out,
        /formal-check: .*Usage: node tooling\/formal-check\.mjs \[--models <dir>\]/s,
      );
    }
  });
});
