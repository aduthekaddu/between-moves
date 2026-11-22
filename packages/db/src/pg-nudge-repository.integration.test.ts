import type { NudgeOutboxEvent } from '@between-moves/domain';
import { FakeClock } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { PgNudgeRepository } from './pg-nudge-repository';
import { twoHousesWithMembers, type TwoHousesWithMembers } from './testing';
import { requireTestDatabaseUrl } from './test-database';

const testDatabaseUrl = requireTestDatabaseUrl();
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));
const NOW = new Date('2026-09-15T12:00:00.000Z');
const clock = new FakeClock(NOW);

function id(suffix: number): string {
  return `01941f29-7c00-7000-8000-${String(suffix).padStart(12, '0')}`;
}

function event(eventId: string, gameId: string, houseId: string): NudgeOutboxEvent {
  return {
    id: eventId,
    topic: 'nudge.due',
    aggregateId: gameId,
    houseId,
    payload: {},
    availableAt: clock.now(),
    occurredAt: clock.now(),
  };
}

async function createGames(database: Pool, world: TwoHousesWithMembers): Promise<void> {
  const seasonId = id(701);
  await database.query(
    `insert into seasons (id, house_id, title, state, created_at, updated_at)
     values ($1, $2, 'Nudge season', 'draft', $3, $3)`,
    [seasonId, world.first.houseId, NOW],
  );
  const games = [
    [id(711), 'correspondence', 'active', 'white', new Date('2026-09-16T00:00:00.000Z')],
    [id(712), 'correspondence', 'active', 'black', new Date('2026-09-15T11:00:00.000Z')],
    [id(713), 'correspondence', 'active', 'white', new Date('2026-09-17T12:00:00.000Z')],
    [id(714), 'live', 'active', 'white', null],
  ] as const;
  for (const [gameId, mode, state, side, moveDueAt] of games) {
    await database.query(
      `insert into games
        (id, house_id, season_id, mode, state, white_membership_id, black_membership_id,
         current_ply, side_to_move, version, clock_policy, white_clock_ms, black_clock_ms,
         move_due_at, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,7,$8,7,$9,$10,$11,$12,$13)`,
      [
        gameId,
        world.first.houseId,
        seasonId,
        mode,
        state,
        world.first.member.membershipId,
        world.first.nonOwner.membershipId,
        side,
        mode === 'live'
          ? { kind: 'live', initialMs: 300_000, incrementMs: 0 }
          : { kind: 'correspondence', perMoveHours: 48 },
        mode === 'live' ? 300_000 : null,
        mode === 'live' ? 300_000 : null,
        moveDueAt,
        NOW,
      ],
    );
  }
}

describe('PostgreSQL Nudge dispatcher persistence', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 8 });
  const repository = new PgNudgeRepository(database);
  let world: TwoHousesWithMembers;

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    world = await twoHousesWithMembers(database);
    await createGames(database, world);
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-029] [DR-CORR-04] finds and enqueues one advance and one overdue Nudge', async () => {
    const due = await repository.findDue({
      now: clock.now(),
      advanceCutoff: new Date('2026-09-16T12:00:00.000Z'),
      limit: 10,
    });

    expect(
      due.map(({ gameId, recipientMembershipId, stage }) => ({
        gameId,
        recipientMembershipId,
        stage,
      })),
    ).toEqual([
      {
        gameId: id(712),
        recipientMembershipId: world.first.nonOwner.membershipId,
        stage: 'overdue',
      },
      {
        gameId: id(711),
        recipientMembershipId: world.first.member.membershipId,
        stage: 'advance',
      },
    ]);

    for (const [index, nudge] of due.entries()) {
      await expect(
        repository.enqueue(nudge, event(id(800 + index), nudge.gameId, nudge.houseId)),
      ).resolves.toBe(true);
    }
    const rows = await database.query<{
      game_id: string;
      ply: number;
      stage: string;
      topic: string;
      payload: Record<string, unknown>;
    }>(
      `select delivery.game_id, delivery.ply, delivery.stage, event.topic, event.payload
         from nudge_deliveries delivery
         join outbox_events event on event.id = delivery.outbox_event_id
        order by delivery.game_id`,
    );
    expect(rows.rows).toEqual([
      expect.objectContaining({ game_id: id(711), ply: 7, stage: 'advance', topic: 'nudge.due' }),
      expect.objectContaining({ game_id: id(712), ply: 7, stage: 'overdue', topic: 'nudge.due' }),
    ]);
    expect(rows.rows[0]?.payload).toEqual({
      recipientMembershipId: world.first.member.membershipId,
      ply: 7,
      stage: 'advance',
    });
  });

  it('[BM-029] [DR-CORR-04] makes concurrent duplicate runs collide on one natural key', async () => {
    const [nudge] = await repository.findDue({
      now: clock.now(),
      advanceCutoff: new Date('2026-09-16T12:00:00.000Z'),
      limit: 1,
    });
    expect(nudge).toBeDefined();

    const inserted = await Promise.all([
      repository.enqueue(nudge!, event(id(811), nudge!.gameId, nudge!.houseId)),
      repository.enqueue(nudge!, event(id(812), nudge!.gameId, nudge!.houseId)),
    ]);
    expect(inserted.sort()).toEqual([false, true]);
    const counts = await database.query<{ nudges: number; events: number }>(
      `select
         (select count(*)::int from nudge_deliveries) as nudges,
         (select count(*)::int from outbox_events where topic = 'nudge.due') as events`,
    );
    expect(counts.rows).toEqual([{ nudges: 1, events: 1 }]);
  });

  it('[BM-029] [DR-CORR-02/04] leaves an overdue Game active and excludes a stale ply', async () => {
    const due = await repository.findDue({
      now: clock.now(),
      advanceCutoff: new Date('2026-09-16T12:00:00.000Z'),
      limit: 10,
    });
    const overdue = due.find((nudge) => nudge.stage === 'overdue')!;
    await database.query(
      `update games set current_ply = current_ply + 1, side_to_move = 'white',
                        move_due_at = $2 where id = $1`,
      [overdue.gameId, new Date('2026-09-17T12:00:00.000Z')],
    );

    await expect(
      repository.enqueue(overdue, event(id(821), overdue.gameId, overdue.houseId)),
    ).resolves.toBe(false);
    const game = await database.query<{ state: string }>('select state from games where id = $1', [
      overdue.gameId,
    ]);
    expect(game.rows).toEqual([{ state: 'active' }]);
  });

  it('[BM-029] keeps Nudge and later Game events on one monotonic aggregate sequence', async () => {
    const advance = (
      await repository.findDue({
        now: clock.now(),
        advanceCutoff: new Date('2026-09-16T12:00:00.000Z'),
        limit: 10,
      })
    ).find((nudge) => nudge.gameId === id(711));
    expect(advance?.stage).toBe('advance');
    await repository.enqueue(advance!, event(id(831), advance!.gameId, advance!.houseId));

    const overdueAt = new Date('2026-09-16T00:00:00.001Z');
    const overdue = (
      await repository.findDue({
        now: overdueAt,
        advanceCutoff: new Date('2026-09-17T00:00:00.001Z'),
        limit: 10,
      })
    ).find((nudge) => nudge.gameId === id(711));
    expect(overdue?.stage).toBe('overdue');
    await repository.enqueue(overdue!, {
      ...event(id(832), overdue!.gameId, overdue!.houseId),
      occurredAt: overdueAt,
    });

    const sequences = await database.query<{ sequence: string }>(
      `select sequence::text from outbox_events
        where aggregate_id = $1 order by sequence`,
      [id(711)],
    );
    const game = await database.query<{ outbox_sequence: string }>(
      'select outbox_sequence::text from games where id = $1',
      [id(711)],
    );
    expect(sequences.rows).toEqual([{ sequence: '1' }, { sequence: '2' }]);
    expect(game.rows).toEqual([{ outbox_sequence: '2' }]);
  });
});
