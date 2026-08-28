import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ESLint } from 'eslint';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const eslint = new ESLint({
  cwd: root,
  overrideConfigFile: join(root, 'eslint.config.mjs'),
});

async function boundaryErrors(filePath, source) {
  const [result] = await eslint.lintText(source, { filePath: join(root, filePath) });
  return result.messages.filter((message) =>
    ['no-restricted-imports', 'boundaries/no-cross-package-relative-imports'].includes(
      message.ruleId ?? '',
    ),
  );
}

async function assertAllowed(filePath, source) {
  assert.deepEqual(await boundaryErrors(filePath, source), []);
}

async function assertForbidden(filePath, source) {
  const errors = await boundaryErrors(filePath, source);
  assert.equal(errors.length, 1);
  assert.match(errors[0]?.message ?? '', /package boundary/i);
}

describe('BM-005 package import boundaries', () => {
  it('[BM-005] allows domain to import contracts as types only', async () => {
    await assertAllowed(
      'packages/domain/src/example.ts',
      "import type { Example } from '@between-moves/contracts'; void (0 as unknown as Example);",
    );
  });

  it('[BM-005] rejects domain imports from concrete database adapters', async () => {
    await assertForbidden(
      'packages/domain/src/example.ts',
      "import { createDatabase } from '@between-moves/db'; void createDatabase;",
    );
  });

  it('[BM-005] allows application imports from domain and contracts', async () => {
    await assertAllowed(
      'packages/application/src/example.ts',
      "import type { Clock } from '@between-moves/domain'; import { schema } from '@between-moves/contracts'; void (0 as unknown as Clock); void schema;",
    );
  });

  it('[BM-005] rejects application imports from concrete adapters', async () => {
    await assertForbidden(
      'packages/application/src/example.ts',
      "import { SystemClock } from '@between-moves/adapters'; void SystemClock;",
    );
  });

  it('[BM-005] allows database and external adapters to import approved inward packages', async () => {
    await assertAllowed(
      'packages/db/src/example.ts',
      "import type { Clock } from '@between-moves/domain'; import { logger } from '@between-moves/observability'; void (0 as unknown as Clock); void logger;",
    );
    await assertAllowed(
      'packages/adapters/src/example.ts',
      "import type { Clock } from '@between-moves/domain'; void (0 as unknown as Clock);",
    );
  });

  it('[BM-005] rejects database and external adapter imports from application', async () => {
    await assertForbidden(
      'packages/db/src/example.ts',
      "import { useCase } from '@between-moves/application'; void useCase;",
    );
    await assertForbidden(
      'packages/adapters/src/example.ts',
      "import { useCase } from '@between-moves/application'; void useCase;",
    );
  });

  it('[BM-005] rejects deep relative imports that escape a package root', async () => {
    await assertForbidden(
      'packages/db/src/example.ts',
      "import { useCase } from '../../application/src/index.ts'; void useCase;",
    );
  });
  it('[BM-005] rejects observability imports from product workspace packages', async () => {
    await assertForbidden(
      'packages/observability/src/example.ts',
      "import type { Clock } from '@between-moves/domain'; void (0 as unknown as Clock);",
    );
  });
});
