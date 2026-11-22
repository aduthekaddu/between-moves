import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');

const packageJson = JSON.parse(read('package.json'));
const nodeVersion = read('.node-version').trim();
const workflow = read('.github/workflows/ci.yml');

describe('Node and pnpm are pinned in one place each', () => {
  it('pnpm refuses to run on a Node outside engines.node', () => {
    assert.match(
      read('pnpm-workspace.yaml'),
      /^engineStrict: true$/m,
      'Set `engineStrict: true` in pnpm-workspace.yaml. pnpm 11 ignores engine-strict in .npmrc and only warns without it.',
    );
  });

  it('engines.node allows exactly the major in .node-version', () => {
    assert.match(nodeVersion, /^\d+$/, '.node-version holds one major version, for example 24');
    const major = Number(nodeVersion);
    assert.equal(packageJson.engines?.node, `>=${major} <${major + 1}`);
  });

  it('CI reads Node from .node-version and pnpm from packageManager', () => {
    assert.doesNotMatch(
      workflow,
      /^\s+node-version:/m,
      'Use `node-version-file: .node-version` instead of a literal node-version.',
    );
    assert.doesNotMatch(
      workflow,
      /^\s+version:/m,
      'Drop `version:` from pnpm/action-setup. It reads packageManager in package.json.',
    );
    const setupNodeSteps = workflow.match(/uses: actions\/setup-node@/g)?.length ?? 0;
    const nodeFileInputs = workflow.match(/^\s+node-version-file: \.node-version$/gm)?.length ?? 0;
    assert.ok(setupNodeSteps > 0);
    assert.equal(nodeFileInputs, setupNodeSteps);
  });
});
