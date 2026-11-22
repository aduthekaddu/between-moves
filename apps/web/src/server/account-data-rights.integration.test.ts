import {
  createDeleteAccount,
  createExportAccountData,
  createViewerResolver,
} from '@between-moves/application';
import {
  createDatabase,
  migrateDown,
  migrateUp,
  PgAccountDataRightsRepository,
  PgGameNoteRepository,
  PgIdentityRecoveryRepository,
} from '@between-moves/db';
import { twoHousesWithMembers, type TwoHousesWithMembers } from '@between-moves/db/testing';
import type { AccountExport } from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { betterAuth } from 'better-auth';
import { getCookies } from 'better-auth/cookies';
import { makeSignature } from 'better-auth/crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config';
import {
  createAccountDeletionHandler,
  createAccountExportHandler,
  expiredCookie,
  type AccountDataRightsHandlerDependencies,
} from '../modules/identity/dataRights';
import { createBetterAuthOptions } from './auth-options';
import { createBetterAuthSessionReader } from './better-auth-session-reader';
import { requireTestDatabaseUrl } from '@between-moves/db/test-database';

const databaseUrl = requireTestDatabaseUrl();
const migrationsDirectory = fileURLToPath(
  new URL('../../../../packages/db/migrations', import.meta.url),
);
const origin = 'https://integration.example.test';
const seasonId = '01941f29-7c00-7000-8000-000000005101';
const gameId = '01941f29-7c00-7000-8000-000000005102';
const beaNote = 'I should have seen Qxf7 coming.';
const adaNote = 'A tidy finish, if I say so myself.';

describe('BM-050 account export and deletion over HTTP', () => {
  const database = createDatabase(databaseUrl);
  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: 'integration-better-auth-secret-at-least-32-characters',
    APP_ORIGIN: origin,
    RESEND_API_KEY: 're_integration_key',
    RESEND_WEBHOOK_SECRET: 'whsec_integration_secret',
    REALTIME_APP_ID: 'realtime-integration-app',
    REALTIME_SERVER_KEY: 'realtime-integration-server-key',
    REALTIME_PUBLIC_KEY: 'realtime-integration-public-key',
    ANALYSIS_WORKER_URL: 'https://worker.integration.example.test',
    ANALYSIS_WORKER_SECRET: 'analysis-integration-secret',
    UPSTASH_REDIS_REST_URL: 'https://rate-limit.integration.example.test',
    UPSTASH_REDIS_REST_TOKEN: 'upstash-integration-token',
    APP_ENV: 'local',
  });
  const options = createBetterAuthOptions({
    config,
    database: database.pool,
    logger: { log: vi.fn() },
    queueMagicLink: vi.fn(),
  });
  const createAuth = () => betterAuth(options);
  // Built after migrateUp: Better Auth checks the schema once at construction and keeps a mismatch.
  let auth: ReturnType<typeof createAuth>;
  const cookies = getCookies(options);
  const accounts = new PgAccountDataRightsRepository(database.pool);
  const clock = { now: () => new Date('2026-10-05T09:00:00.000Z') };
  const log = vi.fn();
  let world: TwoHousesWithMembers;
  let nextAudit = 5200;

  const handlers: AccountDataRightsHandlerDependencies = {
    expectedOrigin: origin,
    requireViewer: (request) =>
      createViewerResolver(
        createBetterAuthSessionReader(auth, new PgIdentityRecoveryRepository(database.pool), {
          log: vi.fn(),
        }),
      ).requireViewer(request),
    exportAccount: createExportAccountData({ clock, accounts }),
    deleteAccount: createDeleteAccount({
      clock,
      ids: { generate: () => `01941f29-7c00-7000-8000-${String(nextAudit++).padStart(12, '0')}` },
      accounts,
    }),
    expiredSessionCookies: [
      cookies.sessionToken,
      cookies.sessionData,
      cookies.dontRememberToken,
    ].map(expiredCookie),
    logger: { log },
    clock,
  };
  const exportAccount = createAccountExportHandler(handlers);
  const deleteAccount = createAccountDeletionHandler(handlers);

  /** A signed Better Auth session cookie for a new session of `userId`. */
  async function signIn(userId: string): Promise<string> {
    const context = await auth.$context;
    const session = await context.internalAdapter.createSession(userId);
    const signature = await makeSignature(session.token, config.betterAuthSecret);
    return `${cookies.sessionToken.name}=${session.token}.${signature}`;
  }

  function exportRequest(cookie: string): Request {
    return new Request(`${origin}/api/account/export`, { headers: { cookie } });
  }

  function deleteRequest(cookie: string): Request {
    return new Request(`${origin}/api/account/delete`, {
      method: 'POST',
      headers: { cookie, origin, 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: 'delete my account' }),
    });
  }

  beforeEach(async () => {
    await migrateDown(database.pool, { migrationsDirectory, all: true });
    await migrateUp(database.pool, { migrationsDirectory });
    auth = createAuth();
    world = await twoHousesWithMembers(database.pool);
    log.mockReset();
    await database.pool.query(
      `insert into seasons (id, house_id, title, state, created_at, updated_at)
       values ($1, $2, 'Note season', 'draft', now(), now())`,
      [seasonId, world.first.houseId],
    );
    await database.pool.query(
      `insert into games
        (id, house_id, season_id, mode, state, white_membership_id, black_membership_id,
         clock_policy, result, result_reason, completed_at, created_at)
       values ($1, $2, $3, 'correspondence', 'completed', $4, $5,
               '{"kind":"correspondence","perMoveHours":48}', 'white_win', 'resign', now(), now())`,
      [
        gameId,
        world.first.houseId,
        seasonId,
        world.first.member.membershipId,
        world.first.nonOwner.membershipId,
      ],
    );
    for (const [noteId, membershipId, body] of [
      ['01941f29-7c00-7000-8000-000000005103', world.first.nonOwner.membershipId, beaNote],
      ['01941f29-7c00-7000-8000-000000005104', world.first.member.membershipId, adaNote],
    ]) {
      await database.pool.query(
        `insert into game_notes (id, game_id, house_id, membership_id, body)
         values ($1, $2, $3, $4, $5)`,
        [noteId, gameId, world.first.houseId, membershipId, body],
      );
    }
  });

  afterAll(async () => {
    await migrateDown(database.pool, { migrationsDirectory, all: true });
    await database.close();
  });

  it('[BM-050] exports only the signed-in person’s own data', async () => {
    const response = await exportAccount(exportRequest(await signIn(world.first.nonOwner.userId)));

    expect(response.status).toBe(200);
    const exported = (await response.json()) as AccountExport;
    expect(exported.profile).toMatchObject({
      userId: world.first.nonOwner.userId,
      email: 'bea-isolation@example.test',
    });
    expect(exported.authored.notes.map((note) => note.body)).toEqual([beaNote]);
    expect(exported.games.map((game) => [game.gameId, game.color])).toEqual([[gameId, 'black']]);
    const serialized = JSON.stringify(exported);
    for (const foreign of [adaNote, 'ada-isolation@example.test', 'Ada']) {
      expect(serialized).not.toContain(foreign);
    }

    const adas = (await (
      await exportAccount(exportRequest(await signIn(world.first.member.userId)))
    ).json()) as AccountExport;
    expect(adas.authored.notes.map((note) => note.body)).toEqual([adaNote]);
    expect(JSON.stringify(adas)).not.toContain(beaNote);
  });

  it('[BM-050] deletes through the session, signs out every device, and leaves Former member', async () => {
    const phone = await signIn(world.first.nonOwner.userId);
    const laptop = await signIn(world.first.nonOwner.userId);

    const response = await deleteAccount(deleteRequest(phone));

    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toContain(
      '__Secure-between-moves.session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'identity.account.deleted',
        actorId: world.first.nonOwner.userId,
        data: { deleted_now: true, memberships_left: 1, sessions_removed: 2 },
      }),
    );
    for (const cookie of [phone, laptop]) {
      expect((await exportAccount(exportRequest(cookie))).status).toBe(401);
      expect((await deleteAccount(deleteRequest(cookie))).status).toBe(401);
    }

    const notes = await new PgGameNoteRepository(database.pool).readForGame(
      fakeAuthorizationContext({
        viewerId: world.first.member.userId,
        houseId: world.first.houseId,
      }),
      gameId,
    );
    expect(notes?.notes.map((note) => [note.authorDisplayName, note.body])).toEqual(
      expect.arrayContaining([
        ['Former member', beaNote],
        ['Ada', adaNote],
      ]),
    );
    const context = await auth.$context;
    await expect(
      context.internalAdapter.findUserByEmail('bea-isolation@example.test'),
    ).resolves.toBeNull();
  });

  it('[BM-050] refuses an Owner with 409 and keeps them signed in', async () => {
    const cookie = await signIn(world.first.member.userId);

    const response = await deleteAccount(deleteRequest(cookie));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'ownership_transfer_required',
      detail: 'Transfer ownership of Knights at Dusk before deleting your account.',
    });
    expect((await exportAccount(exportRequest(cookie))).status).toBe(200);
  });
});
