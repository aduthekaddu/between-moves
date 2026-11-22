import { createAuthorizeHouseAction } from '@between-moves/application';
import {
  migrateDown,
  migrateUp,
  PgHouseAuthorizationMembershipRepository,
  PgHouseCreationRepository,
} from '@between-moves/db';
import type {
  AuthenticatedViewer,
  HouseCreationInput,
  HouseCreationRepository,
} from '@between-moves/domain';
import {
  createHouseAuthorizationMetricStubs,
  createStructuredLogger,
} from '@between-moves/observability';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHouseAuthorizationDenialRecorder } from './house-authorization-observability';
import { requireTestDatabaseUrl } from '@between-moves/db/test-database';

const testDatabaseUrl = requireTestDatabaseUrl();
const migrationsDirectory = fileURLToPath(
  new URL('../../../../packages/db/migrations', import.meta.url),
);
const adaId = '01941f29-7c00-7000-8000-000000000101';
const graceId = '01941f29-7c00-7000-8000-000000000102';
const firstHouseId = '01941f29-7c00-7000-8000-000000000201';
const otherHouseId = '01941f29-7c00-7000-8000-000000000211';

function creation(
  houseId: string,
  ownerUserId: string,
  ownerMembershipId: string,
  auditId: string,
): HouseCreationInput {
  return {
    houseId,
    ownerMembershipId,
    auditId,
    ownerUserId,
    name: `House ${houseId.slice(-3)}`,
    slug: houseId,
    description: null,
    emblemSeed: `house:${houseId}`,
    timeZone: 'UTC',
    createdAt: new Date('2026-08-30T00:00:00.000Z'),
  };
}

describe('House authorization persistence and denial telemetry', () => {
  const database = new Pool({ connectionString: testDatabaseUrl });
  const houses: HouseCreationRepository = new PgHouseCreationRepository(database);

  beforeAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    await database.query(
      `insert into users (id, display_name, email, email_verified)
       values ($1, 'Ada', 'ada-authz@example.test', true),
              ($2, 'Grace', 'grace-authz@example.test', true)`,
      [adaId, graceId],
    );
    await houses.create(
      creation(
        firstHouseId,
        adaId,
        '01941f29-7c00-7000-8000-000000000202',
        '01941f29-7c00-7000-8000-000000000203',
      ),
    );
    await houses.create(
      creation(
        otherHouseId,
        graceId,
        '01941f29-7c00-7000-8000-000000000212',
        '01941f29-7c00-7000-8000-000000000213',
      ),
    );
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-012] [DR-MEM-04] denies a valid other-House ID and counts it as cross-House', async () => {
    const metrics = createHouseAuthorizationMetricStubs();
    const lines: string[] = [];
    const authorizeHouseAction = createAuthorizeHouseAction({
      memberships: new PgHouseAuthorizationMembershipRepository(database),
      nightHosts: { isAssignedNightHost: async () => false },
      denials: createHouseAuthorizationDenialRecorder({
        logger: createStructuredLogger({
          clock: { now: () => new Date('2026-08-30T00:01:00.000Z') },
          sink: (line) => lines.push(line),
        }),
        metrics,
        requestId: '01941f29-7c00-7000-8000-000000000001',
      }),
    });
    const viewer: AuthenticatedViewer = {
      kind: 'authenticated',
      userId: adaId,
      displayName: 'Ada',
      imageUrl: null,
    };

    await expect(
      authorizeHouseAction({ kind: 'view_house_content' }, otherHouseId, viewer),
    ).rejects.toMatchObject({
      code: 'authorization_denied',
      reason: 'not_a_member',
      crossHouse: true,
    });
    expect(metrics.snapshot()).toEqual({ authz_denied_total: { false: 0, true: 1 } });
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      actor_id: adaId,
      house_id: otherHouseId,
      data: { cross_house: true },
    });
  });
});
