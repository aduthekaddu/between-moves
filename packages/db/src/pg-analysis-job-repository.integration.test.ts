import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { PgAnalysisJobRepository } from './pg-analysis-job-repository';
import { PgGameCompletionRepository } from './pg-game-completion-repository';
import { resetTwoHousesWithMembers, twoHousesWithMembers } from './testing';

const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));
const id = (number: number) => `01941f29-7c00-7000-8000-${String(number).padStart(12, '0')}`;
const gameId = id(770);
const now = new Date('2026-09-25T10:00:00Z');

integration('BM-044 PostgreSQL analysis job lifecycle', () => {
  const database = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const jobs = new PgAnalysisJobRepository(database);
  let eventId: string;
  let houseId: string;

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    const world = await twoHousesWithMembers(database);
    houseId = world.first.houseId;
    await database.query(
      `insert into seasons (id, house_id, title, state, created_at, updated_at)
       values ($1,$2,'Analysis season','draft',$3,$3)`,
      [id(771), houseId, now],
    );
    await database.query(
      `insert into games (id, house_id, season_id, mode, state, white_membership_id,
         black_membership_id, clock_policy, move_due_at, created_at)
       values ($1,$2,$3,'correspondence','active',$4,$5,$6,$7,$7)`,
      [
        gameId,
        houseId,
        id(771),
        world.first.member.membershipId,
        world.first.nonOwner.membershipId,
        { kind: 'correspondence', perMoveHours: 48 },
        now,
      ],
    );
    eventId = id(773);
    await new PgGameCompletionRepository(database).resign(
      fakeAuthorizationContext({ viewerId: world.first.member.userId, houseId }),
      {
        gameId,
        clientCommandId: id(774),
        completedEventId: id(772),
        analysisEventId: eventId,
        completedAt: now,
      },
    );
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('enqueues once, leases once, and completes a duplicate callback once', async () => {
    const input = { eventId, gameId, houseId, engineVersion: 'stockfish-17', now };
    expect(await jobs.enqueue(input)).toBe('enqueued');
    expect(await jobs.enqueue(input)).toBe('duplicate');
    const lease = await jobs.claim(now, new Date(now.getTime() + 120_000), 3);
    expect(lease).toMatchObject({
      id: eventId,
      gameId,
      engineVersion: 'stockfish-17',
      attempts: 1,
    });
    expect(await jobs.claim(now, new Date(now.getTime() + 120_000), 3)).toBeNull();
    const result = { swings: [{ ply: 1, centipawnsBefore: 0, centipawnsAfter: -200 }] };
    expect(
      await jobs.complete(eventId, lease!.leaseToken, result, new Date(now.getTime() + 1000)),
    ).toEqual({ outcome: 'processed', durationMs: 1000 });
    expect(
      await jobs.complete(eventId, lease!.leaseToken, result, new Date(now.getTime() + 1000)),
    ).toEqual({ outcome: 'duplicate', durationMs: null });
    const rows = await database.query(
      'select state, attempts, result from analysis_jobs where id=$1',
      [eventId],
    );
    expect(rows.rows).toEqual([{ state: 'completed', attempts: 1, result }]);
  });

  it('keeps the Game complete through engine failures, lease expiry, and attempt cap', async () => {
    await jobs.enqueue({ eventId, gameId, houseId, engineVersion: 'v1', now });
    const first = await jobs.claim(now, new Date(now.getTime() + 1000), 3);
    const second = await jobs.claim(
      new Date(now.getTime() + 2000),
      new Date(now.getTime() + 3000),
      3,
    );
    expect(second?.attempts).toBe(2);
    expect(
      await jobs.complete(
        eventId,
        first!.leaseToken,
        { swings: [] },
        new Date(now.getTime() + 2100),
      ),
    ).toEqual({ outcome: 'stale', durationMs: null });
    expect(
      await jobs.fail(
        eventId,
        second!.leaseToken,
        new Date(now.getTime() + 2100),
        3,
        'EngineUnavailable',
      ),
    ).toBe('processed');
    expect(
      await jobs.fail(
        eventId,
        second!.leaseToken,
        new Date(now.getTime() + 2100),
        3,
        'EngineUnavailable',
      ),
    ).toBe('duplicate');
    const third = await jobs.claim(
      new Date(now.getTime() + 7000),
      new Date(now.getTime() + 8000),
      3,
    );
    expect(third?.attempts).toBe(3);
    expect(
      await jobs.fail(
        eventId,
        third!.leaseToken,
        new Date(now.getTime() + 7100),
        3,
        'EngineUnavailable',
      ),
    ).toBe('processed');
    expect(
      await jobs.claim(new Date(now.getTime() + 20_000), new Date(now.getTime() + 21_000), 3),
    ).toBeNull();
    const game = await database.query('select state from games where id=$1', [gameId]);
    const job = await database.query(
      'select state, result, attempts from analysis_jobs where id=$1',
      [eventId],
    );
    expect(game.rows).toEqual([{ state: 'completed' }]);
    expect(job.rows).toEqual([{ state: 'failed', result: null, attempts: 3 }]);
  });

  it('allows outbox retention after a job is enqueued', async () => {
    await jobs.enqueue({ eventId, gameId, houseId, engineVersion: 'v1', now });
    await database.query('delete from outbox_events where id=$1', [eventId]);
    const row = await database.query('select source_event_id from analysis_jobs where id=$1', [
      eventId,
    ]);
    expect(row.rows).toEqual([{ source_event_id: eventId }]);
    await database.query('delete from game_lifecycle_commands where game_id=$1', [gameId]);
    await resetTwoHousesWithMembers(database);
    const retained = await database.query('select id from analysis_jobs where id=$1', [eventId]);
    expect(retained.rows).toEqual([]);
  });

  it('parks a final attempt whose lease expires without a callback', async () => {
    await jobs.enqueue({ eventId, gameId, houseId, engineVersion: 'v1', now });
    await jobs.claim(now, new Date(now.getTime() + 1000), 3);
    await jobs.claim(new Date(now.getTime() + 2000), new Date(now.getTime() + 3000), 3);
    await jobs.claim(new Date(now.getTime() + 4000), new Date(now.getTime() + 5000), 3);
    expect(await jobs.expire(new Date(now.getTime() + 6000), 3)).toBe(1);
    expect(await jobs.expire(new Date(now.getTime() + 7000), 3)).toBe(0);
    expect(
      await jobs.claim(new Date(now.getTime() + 7000), new Date(now.getTime() + 8000), 3),
    ).toBeNull();
  });
});
