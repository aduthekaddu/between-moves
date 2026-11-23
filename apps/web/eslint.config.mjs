import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

const fenCast = {
  selector: "TSAsExpression > TSTypeReference.typeAnnotation[typeName.name='Fen']",
  message:
    'Make a Fen with parseFen or requireFen from board-model.ts, so a board the client cannot draw takes the invalid path.',
};
const boardStateHooks =
  'The board keeps its client state in one machine: add a field and an event in board-machine.ts, which board-store.ts runs. A second copy here goes stale when a late answer lands.';

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,tsx}'],
    rules: {
      'react/no-danger': 'error',
      'no-restricted-syntax': ['error', fenCast],
    },
  },
  {
    files: ['**/board-model.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['**/games/*/move-entry.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              importNames: ['useState', 'useRef', 'useReducer'],
              message: boardStateHooks,
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        fenCast,
        {
          selector:
            "MemberExpression[object.name='React'][property.name=/^(useState|useRef|useReducer)$/]",
          message: boardStateHooks,
        },
      ],
    },
  },
  globalIgnores(['.next/**', 'coverage/**', 'node_modules/**', 'next-env.d.ts']),
]);
