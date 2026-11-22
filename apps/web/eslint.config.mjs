import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,tsx}'],
    rules: {
      'react/no-danger': 'error',
    },
  },
  {
    // Next.js serialises this page into every route's payload, and React preloads each
    // server-rendered <img> that is not lazy. A non-lazy photo here costs every page a
    // high-priority request. e2e/page-loading.spec.ts checks the result in a browser.
    files: ['src/app/not-found.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "JSXOpeningElement[name.name='img']:not(:has(JSXAttribute[name.name='loading'][value.value='lazy']))",
          message:
            'An <img> in not-found.tsx must have loading="lazy". Next.js puts this page in every route\'s payload, and React preloads a non-lazy <img>, so every page would fetch it at high priority.',
        },
      ],
    },
  },
  globalIgnores(['.next/**', 'coverage/**', 'node_modules/**', 'next-env.d.ts']),
]);
