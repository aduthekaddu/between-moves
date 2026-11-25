import { signAnalysisCallback } from '@between-moves/adapters';
import {
  migrateDown,
  migrateUp,
  PgAnalysisJobRepository,
  PgPuzzleCandidateRepository,
} from '@between-moves/db';
import { twoHousesWithMembers } from '@between-moves/db/testing';
import { createAnalysisMetricStubs } from '@between-moves/observability';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { handleAnalysisCallback } from './analysis-callback-handler';
import { requireTestDatabaseUrl } from '@between-moves/db/test-database';

const testDatabaseUrl = requireTestDatabaseUrl();
const migrationsDirectory = fileURLToPath(
  new URL('../../../../packages/db/migrations', import.meta.url),
);
const id = (number: number) => `01941f29-7c00-7000-8000-${String(number).padStart(12, '0')}`;
const now = new Date('2026-09-26T10:00:00Z');
const secret = 'candidate-integration-secret';
const gameId = id(4901);
const jobId = id(4902);

describe('BM-045 analyzed Game to puzzle candidate', () => {
  const database = new Pool({ connectionString: testDatabaseUrl });
  const jobs = new PgAnalysisJobRepository(database);
  const candidates = new PgPuzzleCandidateRepository(database);
  let houseId: string;
  let otherHouseId: string;

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    const world = await twoHousesWithMembers(database);
    houseId = world.first.houseId;
    otherHouseId = world.second.houseId;
    await database.query(
      `insert into seasons (id, house_id, title, state, created_at, updated_at)
       values ($1, $2, 'Puzzle season', 'draft', $3, $3)`,
      [id(4903), houseId, now],
    );
    await database.query(
      `insert into games (id, house_id, season_id, mode, state, white_membership_id,
         black_membership_id, clock_policy, current_ply, created_at, completed_at)
       values ($1, $2, $3, 'correspondence', 'completed', $4, $5, $6, 1, $7, $7)`,
      [
        gameId,
        houseId,
        id(4903),
        world.first.member.membershipId,
        world.first.nonOwner.membershipId,
        { kind: 'correspondence', perMoveHours: 48 },
        now,
      ],
    );
    await database.query(
      `insert into moves (id, game_id, house_id, ply, actor_membership_id, uci, san,
         fen_after, client_command_id, accepted_version, server_received_at)
       values ($1, $2, $3, 1, $4, 'e2e4', 'e4', $5, $6, 1, $7)`,
      [
        id(4904),
        gameId,
        houseId,
        world.first.member.membershipId,
        'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
        id(4905),
        now,
      ],
    );
    await jobs.enqueue({ eventId: jobId, gameId, houseId, engineVersion: 'v1', now });
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  async function callback(centipawnsAfter: number, ply = 1) {
    const lease = await jobs.claim(now, new Date(now.getTime() + 120_000), 3);
    const payload = {
      jobId,
      leaseToken: lease!.leaseToken,
      status: 'completed',
      result: {
        swings: [{ ply, centipawnsBefore: 0, centipawnsAfter, bestLine: ['d2d4', 'd7d5'] }],
      },
    };
    const body = JSON.stringify(payload);
    const request = new Request('https://app.example.test/api/internal/analysis/callback', {
      method: 'POST',
      body,
      headers: { 'x-analysis-signature': signAnalysisCallback(secret, body) },
    });
    const metrics = createAnalysisMetricStubs();
    const response = await handleAnalysisCallback(request, {
      secret,
      jobs,
      candidateWriter: (client) => new PgPuzzleCandidateRepository(client),
      metrics,
      now: () => new Date(now.getTime() + 1000),
    });
    return { response, metrics };
  }

  it('creates a pending candidate from a seeded 200cp swing with canonical position and line', async () => {
    const { response, metrics } = await callback(-200);
    expect(response.status).toBe(204);
    const result = await database.query(
      `select house_id, season_id, source_ply, position_fen, best_line,
              evaluation_swing_cp, state, reviewer_membership_id
         from puzzle_candidates where game_id = $1`,
      [gameId],
    );
    expect(result.rows).toEqual([
      {
        house_id: houseId,
        season_id: id(4903),
        source_ply: 1,
        position_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        best_line: ['d2d4', 'd7d5'],
        evaluation_swing_cp: 200,
        state: 'pending',
        reviewer_membership_id: null,
      },
    ]);
    expect(metrics.snapshot().puzzle_candidate_created_total).toBe(1);
  });

  it('creates no candidate below the threshold', async () => {
    const { response, metrics } = await callback(-199);
    expect(response.status).toBe(204);
    const result = await database.query('select id from puzzle_candidates where game_id = $1', [
      gameId,
    ]);
    expect(result.rows).toEqual([]);
    expect(metrics.snapshot().puzzle_candidate_created_total).toBe(0);
  });

  it('denies a cross-House candidate write and keeps duplicates idempotent', async () => {
    await callback(-199);
    expect(
      await candidates.create({
        jobId,
        houseId: otherHouseId,
        sourcePly: 1,
        bestLine: ['e2e4'],
        evaluationSwingCp: 300,
        now,
      }),
    ).toBe(false);
    expect(
      await candidates.create({
        jobId,
        houseId,
        sourcePly: 1,
        bestLine: ['e2e4'],
        evaluationSwingCp: 300,
        now,
      }),
    ).toBe(true);
    expect(
      await candidates.create({
        jobId,
        houseId,
        sourcePly: 1,
        bestLine: ['e2e4'],
        evaluationSwingCp: 300,
        now,
      }),
    ).toBe(false);
    const rows = await database.query(
      'select house_id, count(*)::integer as count from puzzle_candidates group by house_id',
    );
    expect(rows.rows).toEqual([{ house_id: houseId, count: 1 }]);
  });

  it('rolls back completion when candidate creation fails, then accepts the same lease', async () => {
    const lease = await jobs.claim(now, new Date(now.getTime() + 120_000), 3);
    const result = {
      swings: [{ ply: 1, centipawnsBefore: 0, centipawnsAfter: -200, bestLine: ['d2d4'] }],
    };
    await expect(
      jobs.completeWithCandidates(jobId, lease!.leaseToken, result, now, async () => {
        throw new Error('Candidate insert failed');
      }),
    ).rejects.toThrow('Candidate insert failed');
    const job = await database.query('select state, result from analysis_jobs where id = $1', [
      jobId,
    ]);
    expect(job.rows).toEqual([{ state: 'leased', result: null }]);
    const completion = await jobs.completeWithCandidates(
      jobId,
      lease!.leaseToken,
      result,
      now,
      (scope, client) =>
        new PgPuzzleCandidateRepository(client)
          .create({
            jobId,
            houseId: scope,
            sourcePly: 1,
            bestLine: ['d2d4'],
            evaluationSwingCp: 200,
            now,
          })
          .then((created) => Number(created)),
    );
    expect(completion).toMatchObject({ outcome: 'processed', candidatesCreated: 1 });
  });

  it('does not generate from a different callback after completion', async () => {
    await callback(-200);
    const completion = await jobs.completeWithCandidates(
      jobId,
      id(4999),
      { swings: [{ ply: 1, centipawnsBefore: 0, centipawnsAfter: 400, bestLine: ['e2e4'] }] },
      new Date(now.getTime() + 1000),
      async () => {
        throw new Error('Duplicate must not generate candidates');
      },
    );
    expect(completion).toEqual({ outcome: 'duplicate', durationMs: null, candidatesCreated: 0 });
    const rows = await database.query(
      'select best_line, evaluation_swing_cp from puzzle_candidates',
    );
    expect(rows.rows).toEqual([{ best_line: ['d2d4', 'd7d5'], evaluation_swing_cp: 200 }]);
  });

  it('uses initial FEN for the first recorded move at a nonstandard ply', async () => {
    const initialFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 50';
    await database.query('update games set initial_fen = $2, current_ply = 99 where id = $1', [
      gameId,
      initialFen,
    ]);
    await database.query('update moves set ply = 99 where game_id = $1', [gameId]);
    const { response } = await callback(-200, 99);
    expect(response.status).toBe(204);
    const rows = await database.query(
      'select source_ply, position_fen from puzzle_candidates where game_id = $1',
      [gameId],
    );
    expect(rows.rows).toEqual([{ source_ply: 99, position_fen: initialFen }]);
  });

  it('uses the preceding canonical Move position for a later swing', async () => {
    const firstMoveFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    const membership = await database.query<{ black_membership_id: string }>(
      'select black_membership_id from games where id = $1',
      [gameId],
    );
    await database.query('update games set current_ply = 2 where id = $1', [gameId]);
    await database.query(
      `insert into moves (id, game_id, house_id, ply, actor_membership_id, uci, san,
         fen_after, client_command_id, accepted_version, server_received_at)
       values ($1, $2, $3, 2, $4, 'e7e5', 'e5', $5, $6, 2, $7)`,
      [
        id(4906),
        gameId,
        houseId,
        membership.rows[0]!.black_membership_id,
        'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
        id(4907),
        now,
      ],
    );
    const { response } = await callback(-200, 2);
    expect(response.status).toBe(204);
    const rows = await database.query(
      'select source_ply, position_fen from puzzle_candidates where game_id = $1',
      [gameId],
    );
    expect(rows.rows).toEqual([{ source_ply: 2, position_fen: firstMoveFen }]);
  });
});
