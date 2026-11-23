import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import tsParser from '@typescript-eslint/parser';
import { testDatabaseEnvRule } from './tooling/eslint-test-database-env.mjs';

const boundaryMessage =
  'Package boundary violation: this layer may only import the workspace packages allowed by the architecture.';

function packageRootFor(filename) {
  for (const directory of ['packages', 'apps']) {
    const marker = `${sep}${directory}${sep}`;
    const markerIndex = filename.lastIndexOf(marker);
    if (markerIndex < 0) continue;
    const packageNameEnd = filename.indexOf(sep, markerIndex + marker.length);
    return packageNameEnd < 0 ? undefined : filename.slice(0, packageNameEnd);
  }
  return undefined;
}

const boundaryPlugin = {
  rules: {
    'no-cross-package-relative-imports': {
      meta: {
        type: 'problem',
        docs: { description: 'Reject relative imports that escape a workspace package.' },
        schema: [],
        messages: { escaped: boundaryMessage },
      },
      create(context) {
        const filename = context.filename ?? context.getFilename();
        const packageRoot = packageRootFor(filename);

        function checkSource(node, source) {
          if (!packageRoot || typeof source.value !== 'string' || !source.value.startsWith('.')) {
            return;
          }

          const target = resolve(dirname(filename), source.value);
          const pathFromPackage = relative(packageRoot, target);
          if (
            pathFromPackage === '..' ||
            pathFromPackage.startsWith(`..${sep}`) ||
            isAbsolute(pathFromPackage)
          ) {
            context.report({ node, messageId: 'escaped' });
          }
        }

        return {
          ImportDeclaration: (node) => checkSource(node, node.source),
          ExportAllDeclaration: (node) => checkSource(node, node.source),
          ExportNamedDeclaration: (node) => {
            if (node.source) checkSource(node, node.source);
          },
          ImportExpression: (node) => checkSource(node, node.source),
        };
      },
    },
  },
};

function workspaceImportsAllowedFrom(allowedPackages) {
  return [
    'error',
    {
      patterns: [
        {
          group: [
            '@between-moves/*',
            ...allowedPackages.flatMap((packageName) => [`!${packageName}`, `!${packageName}/*`]),
          ],
          message: boundaryMessage,
        },
      ],
    },
  ];
}

const lintedSources = [
  'apps/worker/src/**/*.ts',
  'packages/{domain,application,db,adapters,observability}/src/**/*.ts',
];

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
  {
    files: lintedSources,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      boundaries: boundaryPlugin,
    },
    rules: {
      'boundaries/no-cross-package-relative-imports': 'error',
    },
  },
  {
    files: lintedSources,
    ignores: ['packages/db/src/test-database/**'],
    rules: {
      'no-restricted-syntax': testDatabaseEnvRule,
    },
  },
  {
    files: ['apps/worker/src/**/*.ts'],
    rules: {
      'no-restricted-imports': workspaceImportsAllowedFrom([
        '@between-moves/application',
        '@between-moves/domain',
        '@between-moves/db',
        '@between-moves/adapters',
        '@between-moves/contracts',
        '@between-moves/config',
        '@between-moves/observability',
      ]),
    },
  },
  {
    files: ['packages/domain/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@between-moves/*',
                '!@between-moves/contracts',
                '!@between-moves/contracts/*',
              ],
              message: boundaryMessage,
            },
            {
              group: ['@between-moves/contracts', '@between-moves/contracts/*'],
              allowTypeImports: true,
              message:
                'Package boundary violation: domain may import contracts only with import type.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/application/src/**/*.ts'],
    rules: {
      'no-restricted-imports': workspaceImportsAllowedFrom([
        '@between-moves/domain',
        '@between-moves/contracts',
      ]),
    },
  },
  {
    files: ['packages/{db,adapters}/src/**/*.ts'],
    rules: {
      'no-restricted-imports': workspaceImportsAllowedFrom([
        '@between-moves/domain',
        '@between-moves/contracts',
        '@between-moves/config',
        '@between-moves/observability',
      ]),
    },
  },
  {
    files: ['packages/observability/src/**/*.ts'],
    rules: {
      'no-restricted-imports': workspaceImportsAllowedFrom([]),
    },
  },
];
