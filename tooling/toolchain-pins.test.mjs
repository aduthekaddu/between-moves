import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');

// No package declares js-yaml, so load the copy ESLint already installs: eslint -> @eslint/eslintrc -> js-yaml.
const requireFrom = (from) => createRequire(from);
const eslintrc = requireFrom(requireFrom(join(root, '/')).resolve('eslint')).resolve(
  '@eslint/eslintrc',
);
const { load: parseYaml } = requireFrom(eslintrc)('js-yaml');

const packageJson = JSON.parse(read('package.json'));
const nodeVersion = read('.node-version').trim();
const workspaceGlobs = parseYaml(read('pnpm-workspace.yaml')).packages;

const workspacePackages = workspaceGlobs.flatMap((glob) => {
  assert.match(
    glob,
    /^[\w-]+\/\*$/,
    `Workspace glob ${glob} must be "<dir>/*" for this test to list packages`,
  );
  const dir = glob.slice(0, -2);
  return readdirSync(join(root, dir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${dir}/${entry.name}`);
});

/** Every way a workflow can pin Node or pnpm outside `.node-version` and `packageManager`. */
function findWorkflowPinProblems(workflowText) {
  const problems = [];
  const jobs = Object.entries(parseYaml(workflowText).jobs ?? {});
  let setupNodeSteps = 0;
  let pnpmSetupSteps = 0;
  for (const [jobName, job] of jobs) {
    for (const [index, step] of (job.steps ?? []).entries()) {
      const where = `${jobName} step ${index + 1}`;
      const uses = typeof step.uses === 'string' ? step.uses.split('@')[0] : '';
      const inputs = step.with ?? {};
      if (uses === 'actions/setup-node') {
        setupNodeSteps += 1;
        if ('node-version' in inputs) {
          problems.push(
            `${where}: drop \`node-version\`. setup-node prefers it over \`node-version-file\`.`,
          );
        }
        if (inputs['node-version-file'] !== '.node-version') {
          problems.push(`${where}: set \`node-version-file: .node-version\`.`);
        }
      }
      if (uses === 'pnpm/action-setup') {
        pnpmSetupSteps += 1;
        if ('version' in inputs) {
          problems.push(
            `${where}: drop \`version\` from pnpm/action-setup. It reads packageManager in package.json.`,
          );
        }
      }
    }
  }
  if (setupNodeSteps === 0) problems.push('no actions/setup-node step found');
  if (pnpmSetupSteps === 0) problems.push('no pnpm/action-setup step found');
  return problems;
}

describe('Node and pnpm are pinned in one place each', () => {
  it('pnpm refuses to run on a Node outside engines.node', () => {
    assert.equal(
      parseYaml(read('pnpm-workspace.yaml')).engineStrict,
      true,
      'Set `engineStrict: true` in pnpm-workspace.yaml. pnpm 11 ignores engine-strict in .npmrc and only warns without it.',
    );
  });

  it('engines.node allows exactly the major in .node-version, in the root and in every workspace package', () => {
    assert.match(nodeVersion, /^\d+$/, '.node-version holds one major version, for example 24');
    const major = Number(nodeVersion);
    const range = `>=${major} <${major + 1}`;
    assert.ok(workspacePackages.length > 0);
    for (const dir of ['.', ...workspacePackages]) {
      const manifest = JSON.parse(read(join(dir, 'package.json')));
      assert.equal(
        manifest.engines?.node,
        range,
        `Set "engines": { "node": "${range}" } in ${join(dir, 'package.json')}. pnpm checks only the manifest of the package whose script runs, so \`pnpm -C ${dir} <script>\` skips the root check.`,
      );
    }
  });

  it('CI reads Node from .node-version and pnpm from packageManager', () => {
    assert.match(
      packageJson.packageManager ?? '',
      /^pnpm@\d+\.\d+\.\d+$/,
      'Set packageManager in package.json to an exact pnpm version. CI installs pnpm from it.',
    );
    assert.deepEqual(findWorkflowPinProblems(read('.github/workflows/ci.yml')), []);
  });

  it('the workflow check sees a pin behind an inline comment or a quoted key', () => {
    const workflow = (steps) => `jobs:\n  a:\n    steps:\n${steps}`;
    assert.equal(
      findWorkflowPinProblems(
        workflow(
          `      - uses: pnpm/action-setup@v4 # v4\n        with:\n          version: 11.24.0\n      - uses: actions/setup-node@v4\n        with:\n          node-version-file: .node-version\n`,
        ),
      ).length,
      1,
    );
    assert.equal(
      findWorkflowPinProblems(
        workflow(
          `      - uses: pnpm/action-setup@v4\n      - uses: actions/setup-node@v4\n        with:\n          'node-version': 24\n          node-version-file: .node-version\n`,
        ),
      ).length,
      1,
    );
  });
});
