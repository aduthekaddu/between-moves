import {
  MoveConflictError,
  type ChessMoveProposal,
  type ChessSquare,
  type RulesAdapter,
  type RulesAdapterResult,
  type SubmitMoveInput,
} from '@between-moves/domain';
import { FakeClock, fakeAuthorizationContext } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { PgSubmitMoveRepository } from './pg-submit-move-repository';
import { twoHousesWithMembers, type TwoHousesWithMembers } from './testing';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));
const seasonId = '01941f29-7c00-7000-8000-000000000701';
const charterId = '01941f29-7c00-7000-8000-000000000702';
const gameId = '01941f29-7c00-7000-8000-000000000703';
const standardFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const receivedAt = new Date('2026-09-02T09:00:00.000Z');

const positions = {
  e4: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
  d4: 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1',
  e5: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
  nf3: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
  nc6: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
} as const;

interface Transition {
  readonly before: string;
  readonly move: string;
  readonly after: string;
  readonly san: string;
  readonly ply: number;
  readonly sideToMove: 'white' | 'black';
}

const transitions: readonly Transition[] = [
  {
    before: standardFen,
    move: 'e2e4',
    after: positions.e4,
    san: 'e4',
    ply: 1,
    sideToMove: 'black',
  },
  {
    before: standardFen,
    move: 'd2d4',
    after: positions.d4,
    san: 'd4',
    ply: 1,
    sideToMove: 'black',
  },
  {
    before: positions.e4,
    move: 'e7e5',
    after: positions.e5,
    san: 'e5',
    ply: 2,
    sideToMove: 'white',
  },
  {
    before: positions.e5,
    move: 'g1f3',
    after: positions.nf3,
    san: 'Nf3',
    ply: 3,
    sideToMove: 'black',
  },
  {
    before: positions.nf3,
    move: 'b8c6',
    after: positions.nc6,
    san: 'Nc6',
    ply: 4,
    sideToMove: 'white',
  },
];

const terminalCases = [
  {
    name: 'checkmate',
    reason: 'checkmate' as const,
    result: 'white_win' as const,
    sideToMove: 'black' as const,
    terminalState: 'checkmate' as const,
  },
  {
    name: 'stalemate',
    reason: 'stalemate' as const,
    result: 'draw' as const,
    sideToMove: 'black' as const,
    terminalState: 'stalemate' as const,
  },
] as const;

function terminalRules(terminal: (typeof terminalCases)[number]): RulesAdapter {
  return {
    applyMove: () => ({
      legal: true,
      uci: 'e2e4',
      san: terminal.reason === 'checkmate' ? 'e4#' : 'e4',
      fen: positions.e4,
      sideToMove: terminal.sideToMove,
      ply: 1,
      terminalState: terminal.terminalState,
      terminalReason: terminal.reason,
    }),
  };
}

class SequenceRulesAdapter implements RulesAdapter {
  applyMove(fen: string, move: ChessMoveProposal): RulesAdapterResult {
    const uci = `${move.from}${move.to}${move.promotion ?? ''}`;
    const transition = transitions.find((item) => item.before === fen && item.move === uci);
    if (transition === undefined) return { legal: false, reason: 'illegal_move' };
    return {
      legal: true,
      uci,
      san: transition.san,
      fen: transition.after,
      sideToMove: transition.sideToMove,
      ply: transition.ply,
      terminalState: 'ongoing',
      terminalReason: null,
    };
  }
}

const rules: RulesAdapter = new SequenceRulesAdapter();

function square(value: string): ChessSquare {
  if (!/^[a-h][1-8]$/.test(value)) throw new Error('Invalid replay square');
  return value as ChessSquare;
}

function context(world: TwoHousesWithMembers, actor: 'white' | 'black' | 'spectator') {
  const viewerId =
    actor === 'white'
      ? world.first.member.userId
      : actor === 'black'
        ? world.first.nonOwner.userId
        : world.switchingMember.userId;
  return fakeAuthorizationContext({ viewerId, houseId: world.first.houseId });
}

function id(suffix: number): string {
  return `01941f29-7c00-7000-8000-${suffix.toString().padStart(12, '0')}`;
}

function input(
  sequence: number,
  expectedPly: number,
  move: ChessMoveProposal,
  clientCommandId = id(800 + sequence),
  adapter: RulesAdapter = rules,
): SubmitMoveInput {
  return {
    gameId,
    expectedPly,
    clientCommandId,
    move,
    moveId: id(900 + sequence),
    outboxEventId: id(1_000 + sequence),
    completedEventId: id(1_100 + sequence),
    analysisEventId: id(1_200 + sequence),
    receivedAt: new Date(receivedAt.getTime() + sequence * 1_000),
    rules: adapter,
  };
}

async function createActiveGame(database: Pool, world: TwoHousesWithMembers): Promise<void> {
  await database.query(
    `insert into seasons (id, house_id, title, state, created_at, updated_at)
     values ($1, $2, 'Autumn tables', 'draft', $3, $3)`,
    [seasonId, world.first.houseId, receivedAt],
  );
  await database.query(
    `insert into season_charters
      (id, season_id, version, correspondence_pace_hours, night_recurrence, points_recipe,
       published_at, created_at)
     values ($1, $2, 1, 48, '{"weekday":5,"localTime":"19:30","count":4}', '{}', $3, $3)`,
    [charterId, seasonId, receivedAt],
  );
  await database.query(
    `update seasons
        set state = 'active', starts_at = $2, ends_at = $3,
            published_charter_version = 1, updated_at = $2
      where id = $1`,
    [seasonId, receivedAt, new Date('2026-09-30T09:00:00.000Z')],
  );
  await database.query(
    `insert into games
      (id, house_id, season_id, mode, state, white_membership_id, black_membership_id,
       initial_fen, current_fen, current_ply, side_to_move, version, clock_policy, move_due_at,
       created_at)
     values ($1,$2,$3,'correspondence','active',$4,$5,$6,$6,0,'white',0,$7,$8,$9)`,
    [
      gameId,
      world.first.houseId,
      seasonId,
      world.first.member.membershipId,
      world.first.nonOwner.membershipId,
      standardFen,
      { kind: 'correspondence', perMoveHours: 48 },
      receivedAt,
      receivedAt,
    ],
  );
}

integration('PostgreSQL durable Move repository', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 8 });
  const repository = new PgSubmitMoveRepository(database);
  let world: TwoHousesWithMembers;

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    world = await twoHousesWithMembers(database);
    await createActiveGame(database, world);
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-024] [DR-MOVE-02/03] atomically records a legal Move, snapshot, deadline, and outbox event', async () => {
    const command = input(1, 0, { from: 'e2', to: 'e4' });

    await expect(repository.submit(context(world, 'white'), command)).resolves.toEqual({
      gameId,
      houseId: world.first.houseId,
      ply: 1,
      uci: 'e2e4',
      san: 'e4',
      fenAfter: positions.e4,
      sideToMove: 'black',
      version: 1,
      clock: { kind: 'correspondence', moveDueAt: new Date('2026-09-04T09:00:01.000Z') },
      completedNow: false,
      replayed: false,
    });
    const persisted = await database.query(
      `select g.current_fen, g.current_ply, g.side_to_move, g.version, g.move_due_at,
              m.actor_membership_id::text, m.uci, m.san, m.fen_after,
              o.topic, o.sequence::text, o.payload
         from games g join moves m on m.game_id=g.id
         join outbox_events o on o.aggregate_id=g.id
        where g.id=$1`,
      [gameId],
    );
    expect(persisted.rows).toEqual([
      expect.objectContaining({
        current_fen: positions.e4,
        current_ply: 1,
        side_to_move: 'black',
        version: 1,
        move_due_at: new Date('2026-09-04T09:00:01.000Z'),
        actor_membership_id: world.first.member.membershipId,
        uci: 'e2e4',
        san: 'e4',
        fen_after: positions.e4,
        topic: 'game.move-accepted',
        sequence: '1',
        payload: expect.objectContaining({ ply: 1, uci: 'e2e4', sideToMove: 'black' }),
      }),
    ]);
  });

  it('[BM-025] [DR-CORR-01/03] advances each deadline by the snapshotted Game pace after a Charter change', async () => {
    const clock = new FakeClock(receivedAt);

    const firstMove = { ...input(30, 0, { from: 'e2', to: 'e4' }), receivedAt: clock.now() };
    await expect(repository.submit(context(world, 'white'), firstMove)).resolves.toMatchObject({
      clock: { kind: 'correspondence', moveDueAt: new Date('2026-09-04T09:00:00.000Z') },
    });

    await database.query(
      'update season_charters set correspondence_pace_hours = 24 where id = $1',
      [charterId],
    );
    clock.advance(6 * 60 * 60 * 1_000);

    const secondMove = { ...input(31, 1, { from: 'e7', to: 'e5' }), receivedAt: clock.now() };
    await expect(repository.submit(context(world, 'black'), secondMove)).resolves.toMatchObject({
      clock: { kind: 'correspondence', moveDueAt: new Date('2026-09-04T15:00:00.000Z') },
    });
    await expect(
      database.query(
        `select g.clock_policy, g.move_due_at, c.correspondence_pace_hours
           from games g
           join season_charters c on c.id = $2
          where g.id = $1`,
        [gameId, charterId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          clock_policy: { kind: 'correspondence', perMoveHours: 48 },
          move_due_at: new Date('2026-09-04T15:00:00.000Z'),
          correspondence_pace_hours: 24,
        },
      ],
    });
  });

  it('[BM-024] [DR-MOVE-04] concurrent duplicate command IDs return one canonical Move', async () => {
    const commandId = id(850);
    await database.query('update games set version=4 where id=$1', [gameId]);
    const outcomes = await Promise.all([
      repository.submit(context(world, 'white'), input(2, 0, { from: 'e2', to: 'e4' }, commandId)),
      repository.submit(context(world, 'white'), input(3, 0, { from: 'e2', to: 'e4' }, commandId)),
    ]);

    expect(outcomes.map(({ replayed: _replayed, ...result }) => result)).toEqual([
      expect.objectContaining({ ply: 1, uci: 'e2e4', fenAfter: positions.e4, version: 5 }),
      expect.objectContaining({ ply: 1, uci: 'e2e4', fenAfter: positions.e4, version: 5 }),
    ]);
    expect(outcomes.filter((result) => result.replayed)).toHaveLength(1);
    await expect(
      database.query('select count(*)::int as count from moves where game_id=$1', [gameId]),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('[BM-024] [DR-MOVE-05] resolves a two-Move race with one winner and current snapshot', async () => {
    const outcomes = await Promise.allSettled([
      repository.submit(context(world, 'white'), input(4, 0, { from: 'e2', to: 'e4' })),
      repository.submit(context(world, 'white'), input(5, 0, { from: 'd2', to: 'd4' })),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const loser = outcomes.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
    );
    expect(loser?.reason).toBeInstanceOf(MoveConflictError);
    expect(loser?.reason).toMatchObject({ current: { version: 1, currentPly: 1 } });
    await expect(
      database.query('select count(*)::int as count from moves where game_id=$1', [gameId]),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('[BM-024] [DR-MOVE-05/06] rejects stale, wrong-turn, spectator, and cross-House commands', async () => {
    await expect(
      repository.submit(context(world, 'white'), input(6, 1, { from: 'e2', to: 'e4' })),
    ).rejects.toMatchObject({ code: 'move_conflict', current: { version: 0, currentPly: 0 } });
    await expect(
      repository.submit(context(world, 'black'), input(7, 0, { from: 'e2', to: 'e4' })),
    ).rejects.toMatchObject({ code: 'authorization_denied' });
    await expect(
      repository.submit(context(world, 'spectator'), input(8, 0, { from: 'e2', to: 'e4' })),
    ).rejects.toMatchObject({ code: 'authorization_denied' });
    const otherHouse = fakeAuthorizationContext({
      viewerId: world.second.member.userId,
      houseId: world.second.houseId,
    });
    await expect(
      repository.submit(otherHouse, input(9, 0, { from: 'e2', to: 'e4' })),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      repository.submit(context(world, 'white'), input(11, 0, { from: 'e2', to: 'e5' })),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      database.query('select count(*)::int as count from moves where game_id=$1', [gameId]),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  it('[BM-024] rejects a Move while its Game is still waiting for a seat', async () => {
    await database.query(
      "update games set state='waiting', black_membership_id=null, move_due_at=null where id=$1",
      [gameId],
    );

    await expect(
      repository.submit(context(world, 'white'), input(13, 0, { from: 'e2', to: 'e4' })),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('[BM-041] decrements and increments a live clock in the durable Move transaction', async () => {
    await database.query(
      `update games
          set mode='live', clock_policy=$2, white_clock_ms=300000, black_clock_ms=300000,
              turn_started_at=$3, move_due_at=null
        where id=$1`,
      [
        gameId,
        { kind: 'live', initialMs: 300_000, incrementMs: 2_000 },
        new Date('2026-09-02T08:59:55.000Z'),
      ],
    );

    await expect(
      repository.submit(context(world, 'white'), input(12, 0, { from: 'e2', to: 'e4' })),
    ).resolves.toMatchObject({
      ply: 1,
      clock: {
        kind: 'live',
        whiteMs: 285_000,
        blackMs: 300_000,
        turnStartedAt: new Date('2026-09-02T09:00:12.000Z'),
      },
    });
    await expect(
      database.query(
        `select turn_started_at, move_due_at, clock_snapshot
           from games g join moves m on m.game_id=g.id where g.id=$1`,
        [gameId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          turn_started_at: new Date('2026-09-02T09:00:12.000Z'),
          move_due_at: null,
          clock_snapshot: { whiteMs: 285_000, blackMs: 300_000 },
        },
      ],
    });
  });

  it('[BM-041] starts the opponent clock and spends it on the next live Move', async () => {
    const clock = new FakeClock(receivedAt);
    await database.query(
      `update games set mode='live', clock_policy=$2, white_clock_ms=300000,
        black_clock_ms=300000, turn_started_at=$3, move_due_at=null where id=$1`,
      [gameId, { kind: 'live', initialMs: 300_000, incrementMs: 2_000 }, clock.now()],
    );
    clock.advance(10_000);
    const first = await repository.submit(context(world, 'white'), {
      ...input(60, 0, { from: 'e2', to: 'e4' }),
      receivedAt: clock.now(),
    });
    expect(first.clock).toEqual({
      kind: 'live',
      whiteMs: 292_000,
      blackMs: 300_000,
      turnStartedAt: clock.now(),
    });
    clock.advance(25_000);
    const second = await repository.submit(context(world, 'black'), {
      ...input(61, 1, { from: 'e7', to: 'e5' }),
      receivedAt: clock.now(),
    });
    expect(second.clock).toEqual({
      kind: 'live',
      whiteMs: 292_000,
      blackMs: 277_000,
      turnStartedAt: clock.now(),
    });
    await expect(
      database.query(
        `select white_clock_ms, black_clock_ms, turn_started_at from games where id=$1`,
        [gameId],
      ),
    ).resolves.toMatchObject({
      rows: [{ white_clock_ms: 292_000, black_clock_ms: 277_000, turn_started_at: clock.now() }],
    });
  });

  it('[BM-041] flags at zero without recording or incrementing a late Move', async () => {
    const clock = new FakeClock(receivedAt);
    await database.query(
      `update games set mode='live', clock_policy=$2, white_clock_ms=3000,
        black_clock_ms=300000, turn_started_at=$3, move_due_at=null where id=$1`,
      [gameId, { kind: 'live', initialMs: 300_000, incrementMs: 2_000 }, clock.now()],
    );
    clock.advance(3_000);
    await expect(
      repository.submit(context(world, 'white'), {
        ...input(62, 0, { from: 'e2', to: 'e4' }),
        receivedAt: clock.now(),
      }),
    ).resolves.toMatchObject({
      flagged: true,
      result: 'black_win',
      clock: { whiteMs: 0, blackMs: 300_000, turnStartedAt: null },
    });
    await expect(
      database.query(
        `select state, result, result_reason, version, current_ply, white_clock_ms,
        turn_started_at, season_completion_sequence::text from games where id=$1`,
        [gameId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          state: 'completed',
          result: 'black_win',
          result_reason: 'flag',
          version: 1,
          current_ply: 0,
          white_clock_ms: 0,
          turn_started_at: null,
          season_completion_sequence: '1',
        },
      ],
    });
    await expect(
      database.query('select count(*)::int as count from moves where game_id=$1', [gameId]),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    await expect(
      database.query('select topic from outbox_events where aggregate_id=$1 order by sequence', [
        gameId,
      ]),
    ).resolves.toMatchObject({
      rows: [{ topic: 'game.completed' }, { topic: 'game.analysis-requested' }],
    });
  });

  it('[BM-041] leaves both live clocks untouched when a Move is illegal', async () => {
    await database.query(
      `update games set mode='live', clock_policy=$2, white_clock_ms=300000,
        black_clock_ms=300000, turn_started_at=$3, move_due_at=null where id=$1`,
      [gameId, { kind: 'live', initialMs: 300_000, incrementMs: 2_000 }, receivedAt],
    );
    await expect(
      repository.submit(context(world, 'white'), input(68, 0, { from: 'e2', to: 'e5' })),
    ).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(
      database.query(
        'select white_clock_ms, black_clock_ms, turn_started_at from games where id=$1',
        [gameId],
      ),
    ).resolves.toMatchObject({
      rows: [{ white_clock_ms: 300_000, black_clock_ms: 300_000, turn_started_at: receivedAt }],
    });
  });

  it('[BM-041] serializes a live same-turn race so only one clock update wins', async () => {
    await database.query(
      `update games set mode='live', clock_policy=$2, white_clock_ms=300000,
        black_clock_ms=300000, turn_started_at=$3, move_due_at=null where id=$1`,
      [gameId, { kind: 'live', initialMs: 300_000, incrementMs: 2_000 }, receivedAt],
    );
    const outcomes = await Promise.allSettled([
      repository.submit(context(world, 'white'), input(63, 0, { from: 'e2', to: 'e4' })),
      repository.submit(context(world, 'white'), input(64, 0, { from: 'd2', to: 'd4' })),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    const winning = outcomes.find(
      (outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof repository.submit>>> =>
        outcome.status === 'fulfilled',
    );
    if (winning === undefined) throw new Error('No winning live Move');
    await expect(
      database.query('select white_clock_ms, current_ply from games where id=$1', [gameId]),
    ).resolves.toMatchObject({
      rows: [
        {
          white_clock_ms: winning.value.clock.kind === 'live' ? winning.value.clock.whiteMs : -1,
          current_ply: 1,
        },
      ],
    });
  });

  it('[BM-041] rejects an opponent proposal received before the prior Move commits', async () => {
    await database.query(
      `update games set mode='live', clock_policy=$2, white_clock_ms=300000,
        black_clock_ms=300000, turn_started_at=$3, move_due_at=null where id=$1`,
      [gameId, { kind: 'live', initialMs: 300_000, incrementMs: 2_000 }, receivedAt],
    );
    const blocker = await database.connect();
    try {
      await blocker.query('begin');
      await blocker.query('select id from games where id=$1 for update', [gameId]);
      const whiteOutcome = repository
        .submit(context(world, 'white'), input(65, 0, { from: 'e2', to: 'e4' }))
        .then(
          (value) => ({ accepted: value }),
          (error: unknown) => ({ error }),
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
      const blackOutcome = repository
        .submit(context(world, 'black'), input(66, 1, { from: 'e7', to: 'e5' }))
        .then(
          (value) => ({ accepted: value }),
          (error: unknown) => ({ error }),
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
      await blocker.query('commit');
      expect(await whiteOutcome).toMatchObject({ accepted: { ply: 1 } });
      expect(await blackOutcome).toMatchObject({
        error: { code: 'conflict', message: 'Live Move arrived before the turn began' },
      });
      await expect(
        database.query(
          'select current_ply, white_clock_ms, black_clock_ms from games where id=$1',
          [gameId],
        ),
      ).resolves.toMatchObject({
        rows: [{ current_ply: 1, white_clock_ms: 237_000, black_clock_ms: 300_000 }],
      });
    } finally {
      await blocker.query('rollback').catch(() => undefined);
      blocker.release();
    }
  });

  it('[BM-041] starts the opponent clock after Move processing and rejects a queued premove', async () => {
    await database.query(
      `update games set mode='live', clock_policy=$2, white_clock_ms=300000,
        black_clock_ms=300000, turn_started_at=$3, move_due_at=null where id=$1`,
      [gameId, { kind: 'live', initialMs: 300_000, incrementMs: 2_000 }, receivedAt],
    );
    const whiteReceived = new Date(receivedAt.getTime() + 10_000);
    const whiteProcessed = new Date(receivedAt.getTime() + 20_000);
    const first = await repository.submit(context(world, 'white'), {
      ...input(69, 0, { from: 'e2', to: 'e4' }),
      receivedAt: whiteReceived,
      turnStartAt: () => whiteProcessed,
    });
    expect(first.clock).toMatchObject({
      kind: 'live',
      whiteMs: 292_000,
      blackMs: 300_000,
      turnStartedAt: whiteProcessed,
    });
    await expect(
      database.query(
        `select g.turn_started_at, m.server_received_at, m.clock_snapshot, o.payload
         from games g join moves m on m.game_id=g.id
         join outbox_events o on o.aggregate_id=g.id and o.topic='game.move-accepted'
        where g.id=$1`,
        [gameId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          turn_started_at: whiteProcessed,
          server_received_at: whiteReceived,
          clock_snapshot: {
            whiteMs: 292_000,
            blackMs: 300_000,
            turnStartedAt: whiteProcessed.toISOString(),
          },
          payload: { turnStartedAt: whiteProcessed.toISOString() },
        },
      ],
    });
    await expect(
      repository.submit(context(world, 'black'), {
        ...input(70, 1, { from: 'e7', to: 'e5' }),
        receivedAt: new Date(receivedAt.getTime() + 15_000),
      }),
    ).rejects.toMatchObject({
      code: 'conflict',
      message: 'Live Move arrived before the turn began',
    });
    await expect(
      repository.submit(context(world, 'black'), {
        ...input(71, 1, { from: 'e7', to: 'e5' }),
        receivedAt: new Date(receivedAt.getTime() + 21_000),
      }),
    ).resolves.toMatchObject({ clock: { blackMs: 301_000 } });
  });

  it('[BM-041] stops the returned clock when a legal live Move ends the Game', async () => {
    await database.query(
      `update games set mode='live', clock_policy=$2, white_clock_ms=300000,
        black_clock_ms=300000, turn_started_at=$3, move_due_at=null where id=$1`,
      [gameId, { kind: 'live', initialMs: 300_000, incrementMs: 2_000 }, receivedAt],
    );
    const command = input(
      67,
      0,
      { from: 'e2', to: 'e4' },
      id(867),
      terminalRules(terminalCases[0]),
    );
    const accepted = await repository.submit(context(world, 'white'), command);
    expect(accepted).toMatchObject({
      completedNow: true,
      clock: { kind: 'live', whiteMs: 235_000, blackMs: 300_000, turnStartedAt: null },
    });
    await expect(
      database.query(
        `select turn_started_at, m.clock_snapshot from games g
        join moves m on m.game_id=g.id where g.id=$1`,
        [gameId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          turn_started_at: null,
          clock_snapshot: { whiteMs: 235_000, blackMs: 300_000, turnStartedAt: null },
        },
      ],
    });
    await expect(repository.submit(context(world, 'white'), command)).resolves.toMatchObject({
      replayed: true,
      clock: { turnStartedAt: null },
    });
  });

  it('[BM-024] [DR-MOVE-02] rolls back every write when the rules adapter fails', async () => {
    const adapter: RulesAdapter = {
      applyMove() {
        throw new Error('rules unavailable');
      },
    };
    await expect(
      repository.submit(
        context(world, 'white'),
        input(10, 0, { from: 'e2', to: 'e4' }, id(860), adapter),
      ),
    ).rejects.toThrow('rules unavailable');
    await expect(
      database.query(
        `select g.current_ply, g.version,
                (select count(*)::int from moves where game_id=g.id) as moves,
                (select count(*)::int from outbox_events where aggregate_id=g.id) as events
           from games g where g.id=$1`,
        [gameId],
      ),
    ).resolves.toMatchObject({ rows: [{ current_ply: 0, version: 0, moves: 0, events: 0 }] });
  });

  it.each(terminalCases)(
    '[BM-028] completes a terminal $name Move with scoring and analysis events',
    async (terminal) => {
      await expect(
        repository.submit(
          context(world, 'white'),
          input(40, 0, { from: 'e2', to: 'e4' }, id(870), terminalRules(terminal)),
        ),
      ).resolves.toMatchObject({ completedNow: true, clock: { moveDueAt: null } });
      const persisted = await database.query(
        `select g.state, g.result, g.result_reason, g.completed_at,
              g.season_completion_sequence::text,
              o.topic, o.sequence::text, o.payload
         from games g join outbox_events o on o.aggregate_id=g.id
        where g.id=$1 order by o.sequence`,
        [gameId],
      );
      expect(persisted.rows).toEqual([
        expect.objectContaining({ topic: 'game.move-accepted', sequence: '1' }),
        expect.objectContaining({
          state: 'completed',
          result: terminal.result,
          result_reason: terminal.reason,
          season_completion_sequence: '1',
          topic: 'game.completed',
          sequence: '2',
          payload: expect.objectContaining({
            result: terminal.result,
            resultReason: terminal.reason,
          }),
        }),
        expect.objectContaining({ topic: 'game.analysis-requested', sequence: '3' }),
      ]);
    },
  );

  it("[BM-028] [DR-DRAW-02] clears a pending draw offer on the opponent's legal Move", async () => {
    await database.query(
      'update games set draw_offer_membership_id=$2, draw_offer_ply=0 where id=$1',
      [gameId, world.first.nonOwner.membershipId],
    );

    await repository.submit(context(world, 'white'), input(41, 0, { from: 'e2', to: 'e4' }));

    await expect(
      database.query('select draw_offer_membership_id, draw_offer_ply from games where id=$1', [
        gameId,
      ]),
    ).resolves.toMatchObject({
      rows: [{ draw_offer_membership_id: null, draw_offer_ply: null }],
    });
  });

  it('[BM-028] rolls back a terminal Move when either completion event cannot be appended', async () => {
    const command = input(
      42,
      0,
      { from: 'e2', to: 'e4' },
      id(1_500),
      terminalRules(terminalCases[0]),
    );
    await database.query(
      `insert into outbox_events
        (id, topic, aggregate_id, sequence, house_id, payload, available_at, created_at)
       values ($1,'seed.event',$2,1,null,'{}',$3,$3)`,
      [command.completedEventId, id(1_901), command.receivedAt],
    );

    await expect(repository.submit(context(world, 'white'), command)).rejects.toMatchObject({
      code: '23505',
    });
    await expect(
      database.query(
        `select g.state, g.result, g.current_ply,
                (select count(*)::int from moves m where m.game_id=g.id) moves,
                (select count(*)::int from outbox_events o where o.aggregate_id=g.id) events
           from games g where g.id=$1`,
        [gameId],
      ),
    ).resolves.toMatchObject({
      rows: [{ state: 'active', result: null, current_ply: 0, moves: 0, events: 0 }],
    });
  });

  it('[BM-024] [DR-GAME-03] replaying durable Moves reproduces the Game snapshot', async () => {
    const sequence = [
      { actor: 'white' as const, move: { from: 'e2' as const, to: 'e4' as const } },
      { actor: 'black' as const, move: { from: 'e7' as const, to: 'e5' as const } },
      { actor: 'white' as const, move: { from: 'g1' as const, to: 'f3' as const } },
      { actor: 'black' as const, move: { from: 'b8' as const, to: 'c6' as const } },
    ];
    for (const [index, step] of sequence.entries()) {
      await repository.submit(context(world, step.actor), input(20 + index, index, step.move));
    }

    const durableMoves = await database.query<{ from: string; to: string }>(
      `select substring(uci,1,2) as from, substring(uci,3,2) as to
         from moves where game_id=$1 order by ply`,
      [gameId],
    );
    let replayedFen = standardFen;
    let replayedSide: 'white' | 'black' = 'white';
    for (const [index, move] of durableMoves.rows.entries()) {
      const applied = rules.applyMove(
        replayedFen,
        { from: square(move.from), to: square(move.to) },
        [],
      );
      expect(applied.legal).toBe(true);
      if (!applied.legal) throw new Error('Replay unexpectedly failed');
      replayedFen = applied.fen;
      replayedSide = applied.sideToMove;
      expect(applied.ply).toBe(index + 1);
    }
    await expect(
      database.query(
        'select current_fen, current_ply, side_to_move, result from games where id=$1',
        [gameId],
      ),
    ).resolves.toMatchObject({
      rows: [
        { current_fen: replayedFen, current_ply: 4, side_to_move: replayedSide, result: null },
      ],
    });
  });
});
