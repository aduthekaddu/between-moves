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

  it('[BM-006] rejects worker imports from the web composition root', async () => {
    await assertForbidden(
      'apps/worker/src/example.ts',
      "import { GET } from '../../web/src/app/healthz/route.ts'; void GET;",
    );
  });
});

describe('BM-029 VerifiedNudgeDelivery is issued only by the delivery gate', () => {
  const forge =
    "import type { NudgeEmail, VerifiedNudgeDelivery } from '@between-moves/domain'; export const forge = (email: NudgeEmail) => email as VerifiedNudgeDelivery;";

  async function forgeErrors(filePath, source) {
    const [result] = await eslint.lintText(source, { filePath: join(root, filePath) });
    return result.messages.filter((message) => message.ruleId === 'no-restricted-syntax');
  }

  it('[BM-029] rejects an assertion to VerifiedNudgeDelivery and names PgNudgeDeliveryGate.pass', async () => {
    for (const filePath of ['packages/db/src/example.ts', 'apps/worker/src/example.ts']) {
      const errors = await forgeErrors(filePath, forge);
      assert.equal(errors.length, 1, filePath);
      assert.match(errors[0]?.message ?? '', /PgNudgeDeliveryGate\.pass/);
    }
    const doubleCast = await forgeErrors(
      'packages/application/src/example.ts',
      "import type { VerifiedNudgeDelivery } from '@between-moves/domain'; export const forge = (value: object) => value as unknown as VerifiedNudgeDelivery;",
    );
    assert.equal(doubleCast.length, 1);
  });

  it('[BM-029] allows the gate and the test fake to assert it', async () => {
    for (const filePath of [
      'packages/db/src/pg-nudge-delivery-gate.ts',
      'packages/domain/src/testing/fake-verified-nudge-delivery.ts',
    ]) {
      assert.deepEqual(await forgeErrors(filePath, forge), [], filePath);
    }
  });
});
