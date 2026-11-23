import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';
import { rejectVerifiedNudgeDeliveryAssertion } from '../../tooling/verified-nudge-delivery-lint.mjs';

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,tsx}'],
    rules: {
      'react/no-danger': 'error',
      'no-restricted-syntax': rejectVerifiedNudgeDeliveryAssertion,
    },
  },
  globalIgnores(['.next/**', 'coverage/**', 'node_modules/**', 'next-env.d.ts']),
]);
