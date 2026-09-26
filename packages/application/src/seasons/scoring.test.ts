import type {
  ClaimedOutboxEvent,
  SeasonScoreAppendResult,
  SeasonScoringRepository,
} from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { createSeasonScoringConsumer, readSeasonStandings } from './scoring';

const houseId = '01941f29-7c00-7000-8000-000000000601';
const seasonId = '01941f29-7c00-7000-8000-000000000691';
const gameId = '01941f29-7c00-7000-8000-000000000701';
const whiteMembershipId = '01941f29-7c00-7000-8000-000000000621';
const blackMembershipId = '01941f29-7c00-7000-8000-000000000623';
const occurredAt = new Date('2026-09-12T12:00:00.000Z');

function event(
  topic: string,
  payload: Readonly<Record<string, unknown>>,
  aggregateId = gameId,
): ClaimedOutboxEvent {
  return {
    id: '01941f29-7c00-7000-8000-000000000801',
    topic,
    aggregateId,
    sequence: 1n,
    houseId,
    payload,
    availableAt: occurredAt,
    occurredAt,
    attempts: 1,
  };
}

function dependencies(outcome: SeasonScoreAppendResult['outcome'] = 'recorded') {
  let nextId = 900;
  const scoring: SeasonScoringRepository = {
    findCompletedGame: vi.fn(async () => ({
      gameId,
      houseId,
      seasonId,
      whiteMembershipId,
      blackMembershipId,
      result: 'white_win' as const,
    })),
    findSeasonAt: vi.fn(async () => seasonId),
    append: vi.fn(async (input: Parameters<SeasonScoringRepository['append']>[0]) => ({
      outcome,
      entries:
        outcome === 'recorded'
          ? input.entries.map((entry) => ({
              ...entry,
              houseId: input.houseId,
              seasonId: input.seasonId,
              createdAt: input.createdAt,
            }))
          : [],
    })),
    readStandings: vi.fn(async () => ({ houseId, seasonId, finalized: false, standings: [] })),
  };
  return {
    scoring,
    ids: {
      generate: vi.fn(() => `01941f29-7c00-7000-8000-${(nextId++).toString().padStart(12, '0')}`),
    },
    events: { record: vi.fn() },
    clock: { now: vi.fn(() => occurredAt) },
  };
}

describe('BM-034 Season scoring consumer', () => {
  it('[BM-034] [DR-SCORE-01..04] consumes a completed Game using durable Game truth', async () => {
    const deps = dependencies();
    const consumer = createSeasonScoringConsumer(deps);

    await expect(
      consumer.consume(event('game.completed', { result: 'black_win', points: 999 })),
    ).resolves.toBe('processed');

    expect(deps.scoring.findCompletedGame).toHaveBeenCalledWith(houseId, gameId);
    expect(deps.scoring.append).toHaveBeenCalledWith(
      expect.objectContaining({
        houseId,
        seasonId,
        recordedAt: occurredAt,
        sourceEventId: '01941f29-7c00-7000-8000-000000000801',
        sourceTopic: 'game.completed',
        entries: [
          expect.objectContaining({
            membershipId: whiteMembershipId,
            sourceKind: 'game_win',
            points: 3,
          }),
          expect.objectContaining({
            membershipId: blackMembershipId,
            sourceKind: 'game_played',
            points: 1,
          }),
        ],
      }),
    );
  });

  it('[BM-034] [DR-SCORE-05/06] consumes fixed attendance and Puzzle awards', async () => {
    const deps = dependencies();
    const consumer = createSeasonScoringConsumer(deps);
    const nightId = '01941f29-7c00-7000-8000-000000000711';
    const puzzleId = '01941f29-7c00-7000-8000-000000000721';

    await consumer.consume(
      event(
        'night.attendance-qualified',
        {
          membershipId: whiteMembershipId,
          nightId,
          points: 1,
          seasonId,
          sourceKey: `night:${nightId}`,
          sourceKind: 'night_attendance',
        },
        '01941f29-7c00-7000-8000-000000000731',
      ),
    );
    await consumer.consume(
      event('puzzle.published', { puzzleId, contributorMembershipId: whiteMembershipId }, houseId),
    );

    expect(deps.scoring.append).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        seasonId,
        entries: [expect.objectContaining({ sourceKey: `night:${nightId}`, cap: 4 })],
      }),
    );
    expect(deps.scoring.findSeasonAt).toHaveBeenCalledWith(houseId, occurredAt);
    expect(deps.scoring.append).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        seasonId,
        entries: [expect.objectContaining({ sourceKey: `puzzle:${puzzleId}`, cap: 2 })],
      }),
    );
  });

  it('[BM-034] [DR-SCORE-08] reports durable source-key duplicates to the dispatcher', async () => {
    const deps = dependencies('duplicate');
    const consumer = createSeasonScoringConsumer(deps);

    await expect(consumer.consume(event('game.completed', {}))).resolves.toBe('duplicate');
    expect(deps.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'duplicate', ledgerEntryCount: 0, points: 0 }),
    );
  });

  it('[BM-034] rejects malformed scoring events without touching the ledger', async () => {
    const deps = dependencies();
    const consumer = createSeasonScoringConsumer(deps);

    await expect(
      consumer.consume(
        event('night.attendance-qualified', {
          membershipId: whiteMembershipId,
          nightId: 'night-id',
          points: 50,
          seasonId,
          sourceKey: 'night:night-id',
          sourceKind: 'night_attendance',
        }),
      ),
    ).rejects.toMatchObject({ name: 'PermanentOutboxError' });
    expect(deps.scoring.append).not.toHaveBeenCalled();
    expect(deps.events.record).toHaveBeenCalledWith(
      expect.objectContaining({
        houseId,
        seasonId,
        topic: 'night.attendance-qualified',
        outcome: 'failed',
      }),
    );
  });
});

describe('BM-034 Season standings query', () => {
  it('[BM-034] [DR-SCORE-07] authorizes and reads within one House and Season', async () => {
    const deps = dependencies();
    const context = fakeAuthorizationContext({ houseId, viewerId: whiteMembershipId });
    const authorizeHouseAction = vi.fn(async () => context);
    const viewer = {
      kind: 'authenticated',
      userId: whiteMembershipId,
      displayName: 'Ada',
      imageUrl: null,
    } as const;

    await expect(
      readSeasonStandings(
        { houseId, seasonId, viewer },
        { authorizeHouseAction, scoring: deps.scoring },
      ),
    ).resolves.toEqual({ houseId, seasonId, finalized: false, standings: [] });
    expect(authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'view_house_content' },
      houseId,
      viewer,
    );
    expect(deps.scoring.readStandings).toHaveBeenCalledWith(context, seasonId);
  });
});
