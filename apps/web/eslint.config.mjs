import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';
import { testDatabaseEnvRule } from '../../tooling/eslint-test-database-env.mjs';

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,tsx}'],
    rules: {
      'react/no-danger': 'error',
      'no-restricted-syntax': testDatabaseEnvRule,
    },
  },
  {
    // Next.js serialises a not-found page into the payload of every route under it, and
    // React preloads each server-rendered <img> that is not lazy, and each image marked
    // priority or preload. Any of them costs every page a high-priority request (fab208b).
    // An image in a component the page imports is not seen here; e2e/page-loading.spec.ts
    // checks the result in a browser.
    files: ['src/app/**/{not-found,global-not-found}.{js,jsx,ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "JSXOpeningElement[name.name='img']:not(:has(JSXAttribute[name.name='loading']))",
          message:
            'An <img> in a not-found page must have loading="lazy". Next.js puts this page in every route\'s payload, and React preloads a non-lazy <img>, so every page would fetch it at high priority.',
        },
        {
          selector:
            "JSXAttribute[name.name='loading']:not([value.value='lazy']):not([value.expression.value='lazy'])",
          message:
            'An image in a not-found page must use loading="lazy". Next.js puts this page in every route\'s payload, so a non-lazy image is fetched on every page.',
        },
        {
          selector: 'JSXAttribute[name.name=/^(priority|preload|fetchPriority)$/]',
          message:
            "Remove this attribute. Next.js puts a not-found page in every route's payload, so a priority or preloaded image here is fetched on every page.",
        },
      ],
    },
  },
  globalIgnores(['.next/**', 'coverage/**', 'node_modules/**', 'next-env.d.ts']),
]);
