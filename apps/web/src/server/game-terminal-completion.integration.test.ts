import { ChessJsRulesAdapter } from '@between-moves/adapters';
import { migrateDown, migrateUp, PgSubmitMoveRepository } from '@between-moves/db';
import { twoHousesWithMembers, type TwoHousesWithMembers } from '@between-moves/db/testing';
import type { ChessMoveProposal, ChessSquare, SubmitMoveInput } from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import fc from 'fast-check';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const migrationsDirectory = fileURLToPath(
  new URL('../../../../packages/db/migrations', import.meta.url),
);
const seasonId = '01941f29-7c00-7000-8000-000000000701';
const charterId = '01941f29-7c00-7000-8000-000000000702';
const occurredAt = new Date('2026-09-10T09:00:00.000Z');
const standardFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

interface TerminalScenario {
  readonly name: string;
  readonly initialFen: string;
  readonly moves: readonly ChessMoveProposal[];
  readonly result: 'white_win' | 'black_win' | 'draw';
  readonly resultReason:
    'checkmate' | 'stalemate' | 'insufficient_material' | 'repetition' | 'fifty_move';
}

const terminalScenarios = [
  {
    name: 'checkmate',
    initialFen: standardFen,
    moves: [
      { from: 'f2', to: 'f3' },
      { from: 'e7', to: 'e5' },
      { from: 'g2', to: 'g4' },
      { from: 'd8', to: 'h4' },
    ],
    result: 'black_win',
    resultReason: 'checkmate',
  },
  {
    name: 'stalemate',
    initialFen: 'k7/2Q5/2K5/8/8/8/8/8 w - - 0 1',
    moves: [{ from: 'c7', to: 'b6' }],
    result: 'draw',
    resultReason: 'stalemate',
  },
  {
    name: 'insufficient material',
    initialFen: 'k7/1R6/8/3K4/8/8/8/8 b - - 0 1',
    moves: [{ from: 'a8', to: 'b7' }],
    result: 'draw',
    resultReason: 'insufficient_material',
  },
  {
    name: 'repetition',
    initialFen: standardFen,
    moves: [
      { from: 'g1', to: 'f3' },
      { from: 'g8', to: 'f6' },
      { from: 'f3', to: 'g1' },
      { from: 'f6', to: 'g8' },
      { from: 'g1', to: 'f3' },
      { from: 'g8', to: 'f6' },
      { from: 'f3', to: 'g1' },
      { from: 'f6', to: 'g8' },
    ],
    result: 'draw',
    resultReason: 'repetition',
  },
  {
    name: 'fifty-move rule',
    initialFen: '7k/8/8/8/8/8/R7/K7 w - - 99 50',
    moves: [{ from: 'a2', to: 'b2' }],
    result: 'draw',
    resultReason: 'fifty_move',
  },
] as const satisfies readonly TerminalScenario[];

function id(suffix: number): string {
  return `01941f29-7c00-7000-8000-${suffix.toString().padStart(12, '0')}`;
}

function plyFromFen(fen: string): number {
  const fields = fen.split(' ');
  const fullmove = Number(fields[5]);
  return (fullmove - 1) * 2 + (fields[1] === 'b' ? 1 : 0);
}

function square(value: string): ChessSquare {
  if (!/^[a-h][1-8]$/.test(value)) throw new Error('Invalid durable Move square');
  return value as ChessSquare;
}

function moveInput(
  gameId: string,
  expectedPly: number,
  move: ChessMoveProposal,
  sequence: number,
  rules: ChessJsRulesAdapter,
): SubmitMoveInput {
  return {
    gameId,
    expectedPly,
    move,
    clientCommandId: id(10_000 + sequence * 5),
    moveId: id(10_001 + sequence * 5),
    outboxEventId: id(10_002 + sequence * 5),
    completedEventId: id(10_003 + sequence * 5),
    analysisEventId: id(10_004 + sequence * 5),
    receivedAt: new Date(occurredAt.getTime() + sequence * 1_000),
    rules,
  };
}

function actorContext(world: TwoHousesWithMembers, fen: string) {
  return fakeAuthorizationContext({
    houseId: world.first.houseId,
    viewerId: fen.split(' ')[1] === 'w' ? world.first.member.userId : world.first.nonOwner.userId,
  });
}

async function seedSeason(database: Pool, world: TwoHousesWithMembers): Promise<void> {
  await database.query(
    `insert into seasons (id, house_id, title, state, created_at, updated_at)
     values ($1,$2,'Terminal replay','draft',$3,$3)`,
    [seasonId, world.first.houseId, occurredAt],
  );
  await database.query(
    `insert into season_charters
      (id, season_id, version, correspondence_pace_hours, night_recurrence, points_recipe,
       published_at, created_at)
     values ($1, $2, 1, 48, '{"weekday":5,"localTime":"19:30","count":4}', '{}', $3, $3)`,
    [charterId, seasonId, occurredAt],
  );
  await database.query(
    `update seasons
        set state = 'active', starts_at = $2, ends_at = $3,
            published_charter_version = 1, updated_at = $2
      where id = $1`,
    [seasonId, occurredAt, new Date('2026-10-08T09:00:00.000Z')],
  );
}

async function playScenario(
  database: Pool,
  repository: PgSubmitMoveRepository,
  world: TwoHousesWithMembers,
  scenario: TerminalScenario,
  run: number,
) {
  const gameId = id(20_000 + run);
  const initialPly = plyFromFen(scenario.initialFen);
  await database.query(
    `insert into games
      (id, house_id, season_id, mode, state, white_membership_id, black_membership_id,
       initial_fen, current_fen, current_ply, side_to_move, clock_policy, move_due_at, created_at)
     values ($1,$2,$3,'correspondence','active',$4,$5,$6,$6,$7,$8,$9,$10,$10)`,
    [
      gameId,
      world.first.houseId,
      seasonId,
      world.first.member.membershipId,
      world.first.nonOwner.membershipId,
      scenario.initialFen,
      initialPly,
      scenario.initialFen.split(' ')[1] === 'w' ? 'white' : 'black',
      { kind: 'correspondence', perMoveHours: 48 },
      occurredAt,
    ],
  );
  const rules = new ChessJsRulesAdapter();
  let currentFen = scenario.initialFen;
  let expectedPly = initialPly;
  for (const [index, move] of scenario.moves.entries()) {
    const result = await repository.submit(
      actorContext(world, currentFen),
      moveInput(gameId, expectedPly, move, run * 16 + index, rules),
    );
    currentFen = result.fenAfter;
    expectedPly = result.ply;
  }
  return { gameId, initialPly };
}

async function replaySnapshot(database: Pool, gameId: string, initialFen: string) {
  const durable = await database.query<{ uci: string }>(
    'select uci from moves where game_id=$1 order by ply',
    [gameId],
  );
  const rules = new ChessJsRulesAdapter();
  const history = [initialFen];
  let fen = initialFen;
  let applied = null;
  for (const row of durable.rows) {
    applied = rules.applyMove(
      fen,
      { from: square(row.uci.slice(0, 2)), to: square(row.uci.slice(2, 4)) },
      history,
    );
    if (!applied.legal) throw new Error('Durable Move replay failed');
    fen = applied.fen;
    history.push(fen);
  }
  return applied;
}

integration('BM-028 real-adapter terminal Game completion', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 8 });
  const repository = new PgSubmitMoveRepository(database);
  let world: TwoHousesWithMembers;
  let nextRun = 0;

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    world = await twoHousesWithMembers(database);
    await seedSeason(database, world);
    nextRun = 0;
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it.each(terminalScenarios)(
    '[BM-028] records $name and emits move, completion, and analysis events',
    async (scenario) => {
      nextRun += 1;
      const { gameId } = await playScenario(database, repository, world, scenario, nextRun);
      await expect(
        database.query(
          `select state, result, result_reason,
                  array_agg(o.topic order by o.sequence) topics
             from games g join outbox_events o on o.aggregate_id=g.id
            where g.id=$1 group by g.id`,
          [gameId],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            state: 'completed',
            result: scenario.result,
            result_reason: scenario.resultReason,
            topics: [
              ...scenario.moves.map(() => 'game.move-accepted'),
              'game.completed',
              'game.analysis-requested',
            ],
          },
        ],
      });
    },
  );

  it('[BM-028] [DR-GAME-03] property: legal terminal histories replay the stored snapshot', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.shuffledSubarray<TerminalScenario>([...terminalScenarios], {
          minLength: terminalScenarios.length,
          maxLength: terminalScenarios.length,
        }),
        async (scenarios) => {
          for (const scenario of scenarios) {
            nextRun += 1;
            const { gameId } = await playScenario(database, repository, world, scenario, nextRun);
            const replayed = await replaySnapshot(database, gameId, scenario.initialFen);
            if (replayed === null || !replayed.legal) throw new Error('Replay produced no Move');
            await expect(
              database.query(
                `select current_fen, current_ply, side_to_move, result, result_reason
                   from games where id=$1`,
                [gameId],
              ),
            ).resolves.toMatchObject({
              rows: [
                {
                  current_fen: replayed.fen,
                  current_ply: replayed.ply,
                  side_to_move: replayed.sideToMove,
                  result: scenario.result,
                  result_reason: replayed.terminalReason,
                },
              ],
            });
          }
        },
      ),
      { numRuns: 3 },
    );
  });
});
