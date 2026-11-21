import { TestNudgeEmailSender } from '@between-moves/adapters';
import {
  createNudgeDispatcher,
  createNudgeEmailConsumer,
  createOutboxDispatcher,
} from '@between-moves/application';
import {
  migrateDown,
  migrateUp,
  PgNudgeEmailReader,
  PgNudgeRepository,
  PgOutboxRepository,
} from '@between-moves/db';
import { twoHousesWithMembers, type TwoHousesWithMembers } from '@between-moves/db/testing';
import { RetriableOutboxError, type NudgeEmailSender } from '@between-moves/domain';
import { FakeClock } from '@between-moves/domain/testing';
import { createDeliveryMetricStubs } from '@between-moves/observability';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const migrationsDirectory = fileURLToPath(
  new URL('../../../../packages/db/migrations', import.meta.url),
);
const NOW = new Date('2026-09-15T12:00:00.000Z');

function id(suffix: number): string {
  return `01941f29-7c00-7000-8000-${String(suffix).padStart(12, '0')}`;
}

async function createUpcomingGame(database: Pool, world: TwoHousesWithMembers): Promise<void> {
  await database.query(
    `insert into seasons (id, house_id, title, state, created_at, updated_at)
     values ($1, $2, 'Nudge flow', 'draft', $3, $3)`,
    [id(701), world.first.houseId, NOW],
  );
  await database.query(
    `insert into games
      (id, house_id, season_id, mode, state, white_membership_id, black_membership_id,
       current_ply, side_to_move, version, clock_policy, move_due_at, created_at)
     values ($1,$2,$3,'correspondence','active',$4,$5,7,'white',7,
             '{"kind":"correspondence","perMoveHours":48}',$6,$7)`,
    [
      id(711),
      world.first.houseId,
      id(701),
      world.first.member.membershipId,
      world.first.nonOwner.membershipId,
      new Date('2026-09-16T00:00:00.000Z'),
      NOW,
    ],
  );
}

integration('Nudge scheduling and delivery flow', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 8 });
  let world: TwoHousesWithMembers;

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    world = await twoHousesWithMembers(database);
    await createUpcomingGame(database, world);
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-029] [BM-030] [DR-DELIV-03] retains a failed email and marks it sent after retry', async () => {
    const clock = new FakeClock(NOW);
    const metrics = createDeliveryMetricStubs();
    const nudgeRepository = new PgNudgeRepository(database);
    const schedule = createNudgeDispatcher({
      clock,
      generateId: () => id(801),
      repository: nudgeRepository,
      metrics,
    });
    await expect(schedule.dispatch()).resolves.toEqual({ scanned: 1, enqueued: 1, duplicate: 0 });

    const successfulSender = new TestNudgeEmailSender();
    const sendNudge = vi.fn<NudgeEmailSender['sendNudge']>(async (message, options) => {
      if (sendNudge.mock.calls.length === 1) {
        throw new RetriableOutboxError('Resend email request failed (503)');
      }
      return successfulSender.sendNudge(message, options);
    });
    const outbox = createOutboxDispatcher({
      clock,
      repository: new PgOutboxRepository(database),
      consumer: createNudgeEmailConsumer({
        clock,
        reader: new PgNudgeEmailReader(database),
        sender: { sendNudge },
        metrics,
      }),
      metrics,
      retryBaseDelayMs: 1_000,
    });

    await expect(outbox.dispatchBatch()).resolves.toMatchObject({ retried: 1, sent: 0 });
    await expect(schedule.dispatch()).resolves.toEqual({ scanned: 0, enqueued: 0, duplicate: 0 });
    const retained = await database.query<{
      attempts: number;
      sent_at: Date | null;
      failed_at: Date | null;
      last_error: string | null;
    }>(
      "select attempts, sent_at, failed_at, last_error from outbox_events where topic = 'nudge.due'",
    );
    expect(retained.rows).toEqual([
      {
        attempts: 1,
        sent_at: null,
        failed_at: null,
        last_error: 'Resend email request failed (503)',
      },
    ]);

    clock.advance(1_000);
    await expect(outbox.dispatchBatch()).resolves.toMatchObject({ retried: 0, sent: 1 });
    expect(sendNudge).toHaveBeenLastCalledWith(
      expect.objectContaining({
        houseId: world.first.houseId,
        opponentName: 'Bea',
        lastMoveSan: null,
        moveDueAt: new Date('2026-09-16T00:00:00.000Z'),
      }),
      expect.anything(),
    );
    await expect(outbox.dispatchBatch()).resolves.toMatchObject({ claimed: 0, sent: 0 });
    expect(successfulSender.deliveries()).toHaveLength(1);
    expect(sendNudge).toHaveBeenCalledTimes(2);
    const sent = await database.query<{ sent_at: Date | null; last_error: string | null }>(
      "select sent_at, last_error from outbox_events where topic = 'nudge.due'",
    );
    expect(sent.rows[0]?.sent_at).toBeInstanceOf(Date);
    expect(sent.rows[0]?.last_error).toBe('Resend email request failed (503)');
    const counts = await database.query<{ nudges: number; events: number }>(
      `select (select count(*)::int from nudge_deliveries) nudges,
              (select count(*)::int from outbox_events where topic = 'nudge.due') events`,
    );
    expect(counts.rows).toEqual([{ nudges: 1, events: 1 }]);
  });

  async function playMove(ply: number, actor: string, uci: string, san: string): Promise<void> {
    await database.query(
      `insert into moves
        (id, game_id, house_id, ply, actor_membership_id, uci, san, fen_after, client_command_id,
         accepted_version)
       values ($1,$2,$3,$4,$5,$6,$7,'8/8/8/8/8/8/8/8 w - - 0 1',$1,$4)`,
      [id(900 + ply), id(711), world.first.houseId, ply, actor, uci, san],
    );
  }

  it.each([
    [
      'the recipient already replied',
      async () => {
        await playMove(8, world.first.member.membershipId, 'e4e5', 'e5');
        await database.query(
          `update games set current_ply = 8, side_to_move = 'black', version = 8,
                  move_due_at = '2026-09-17T00:00:00.000Z' where id = $1`,
          [id(711)],
        );
      },
    ],
    [
      'the Game ended',
      async () => {
        await database.query(
          `update games set state = 'completed', result = 'black_win', result_reason = 'resign',
                  version = 8, move_due_at = null, completed_at = $2 where id = $1`,
          [id(711), NOW],
        );
      },
    ],
  ])('[BM-029] sends no Nudge when %s before delivery', async (_case, endTurn) => {
    await playMove(7, world.first.nonOwner.membershipId, 'g8f6', 'Nf6');
    const clock = new FakeClock(NOW);
    const metrics = createDeliveryMetricStubs();
    const schedule = createNudgeDispatcher({
      clock,
      generateId: () => id(801),
      repository: new PgNudgeRepository(database),
      metrics,
    });
    await expect(schedule.dispatch()).resolves.toMatchObject({ enqueued: 1 });

    await endTurn();
    const sendNudge = vi.fn<NudgeEmailSender['sendNudge']>(async () => 'sent');
    const outbox = createOutboxDispatcher({
      clock,
      repository: new PgOutboxRepository(database),
      consumer: createNudgeEmailConsumer({
        clock,
        reader: new PgNudgeEmailReader(database),
        sender: { sendNudge },
        metrics,
      }),
      metrics,
    });
    // A skipped Nudge settles its event like a sent one; a reader error would retry it.
    await expect(outbox.dispatchBatch()).resolves.toEqual({
      claimed: 1,
      sent: 1,
      retried: 0,
      failed: 0,
    });
    expect(sendNudge).not.toHaveBeenCalled();
  });
});
