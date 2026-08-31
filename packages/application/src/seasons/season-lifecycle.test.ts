import type {
  AuthenticatedViewer,
  CharterDraftInput,
  SeasonDraftInput,
  SeasonPublishInput,
  SeasonRepository,
} from '@between-moves/domain';
import { DomainError } from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { draftSeason, draftSeasonCharter, publishSeason } from './season-lifecycle';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const seasonId = '01941f29-7c00-7000-8000-000000000701';
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};
const context = fakeAuthorizationContext({ viewerId: viewer.userId, houseId });

function dependencies(repository: Partial<SeasonRepository> = {}) {
  const seasons: SeasonRepository = {
    draft: vi.fn(async (_context, input: SeasonDraftInput) => ({
      seasonId: input.seasonId,
      houseId,
      state: 'draft' as const,
    })),
    draftCharter: vi.fn(async (_context, input: CharterDraftInput) => ({
      seasonId: input.seasonId,
      version: 1,
    })),
    publish: vi.fn(async (_context, input: SeasonPublishInput) => ({
      seasonId: input.seasonId,
      houseId,
      state: 'active' as const,
      publishedCharterVersion: 1,
      activatedNow: true,
    })),
    ...repository,
  };
  return {
    authorizeHouseAction: vi.fn(async () => context),
    clock: { now: () => new Date('2026-09-01T12:00:00.000Z') },
    ids: {
      generate: vi
        .fn()
        .mockReturnValueOnce(seasonId)
        .mockReturnValue('01941f29-7c00-7000-8000-000000000702'),
    },
    seasons,
    transitions: { record: vi.fn() },
  };
}

describe('Season lifecycle commands', () => {
  it('[BM-018] [DR-SEASON-01] authorizes and creates a normalized draft Season', async () => {
    const deps = dependencies();

    await expect(
      draftSeason({ houseId, title: '  Autumn tables ', viewer }, deps),
    ).resolves.toEqual({ seasonId, houseId, state: 'draft' });
    expect(deps.authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'draft_or_publish_charter' },
      houseId,
      viewer,
    );
    expect(deps.seasons.draft).toHaveBeenCalledWith(context, {
      seasonId,
      title: 'Autumn tables',
      createdAt: new Date('2026-09-01T12:00:00.000Z'),
    });
    expect(deps.transitions.record).toHaveBeenCalledWith({
      actorId: viewer.userId,
      houseId,
      seasonId,
      event: 'draft_season',
      from: null,
      to: 'draft',
      outcome: 'success',
    });
  });

  it('[BM-018] [DR-SEASON-02/03] versions a validated draft Charter with fixed points', async () => {
    const deps = dependencies();

    await expect(
      draftSeasonCharter(
        {
          houseId,
          seasonId,
          correspondencePaceHours: 24,
          nightRecurrence: { weekday: 5, localTime: '19:30', count: 4 },
          viewer,
        },
        deps,
      ),
    ).resolves.toEqual({ seasonId, version: 1 });
    expect(deps.seasons.draftCharter).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        seasonId,
        correspondencePaceHours: 24,
        nightRecurrence: { weekday: 5, localTime: '19:30', count: 4 },
        pointsRecipe: {
          completedGame: 1,
          win: 2,
          draw: 1,
          nightAttendance: 1,
          publishedPuzzle: 1,
          caps: { games: 8, nights: 4, puzzles: 2 },
        },
      }),
    );
  });

  it('[BM-018] [DR-SEASON-03..05] publishes an exact four-week Season and observes it', async () => {
    const deps = dependencies();
    const startsAt = new Date('2026-09-04T12:00:00.000Z');
    const endsAt = new Date('2026-10-02T12:00:00.000Z');

    await expect(
      publishSeason({ houseId, seasonId, title: 'Autumn tables', startsAt, endsAt, viewer }, deps),
    ).resolves.toMatchObject({
      state: 'active',
      publishedCharterVersion: 1,
      activatedNow: true,
    });
    expect(deps.seasons.publish).toHaveBeenCalledWith(context, {
      seasonId,
      title: 'Autumn tables',
      startsAt,
      endsAt,
      publishedAt: new Date('2026-09-01T12:00:00.000Z'),
    });
    expect(deps.transitions.record).toHaveBeenCalledWith({
      actorId: viewer.userId,
      houseId,
      seasonId,
      event: 'publish_season',
      from: 'draft',
      to: 'active',
      outcome: 'success',
    });
  });

  it('[BM-018] does not report an idempotent active publish replay as a state transition', async () => {
    const deps = dependencies({
      publish: vi.fn(async () => ({
        seasonId,
        houseId,
        state: 'active' as const,
        publishedCharterVersion: 1,
        activatedNow: false,
      })),
    });

    await expect(
      publishSeason(
        {
          houseId,
          seasonId,
          title: 'Autumn tables',
          startsAt: new Date('2026-09-04T12:00:00.000Z'),
          endsAt: new Date('2026-10-02T12:00:00.000Z'),
          viewer,
        },
        deps,
      ),
    ).resolves.toMatchObject({ activatedNow: false });
    expect(deps.transitions.record).not.toHaveBeenCalled();
  });

  it('[BM-018] records a rejected publish transition without leaking payload content', async () => {
    const deps = dependencies({
      publish: vi.fn(async () => {
        throw new DomainError('conflict', 'Season conflict');
      }),
    });

    await expect(
      publishSeason(
        {
          houseId,
          seasonId,
          title: 'Autumn tables',
          startsAt: new Date('2026-09-04T12:00:00.000Z'),
          endsAt: new Date('2026-10-02T12:00:00.000Z'),
          viewer,
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(deps.transitions.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: viewer.userId,
        houseId,
        seasonId,
        event: 'publish_season',
        outcome: 'rejected',
      }),
    );
  });

  it('[BM-018] does not turn a committed transition into a failure when logging fails', async () => {
    const deps = dependencies();
    deps.transitions.record.mockImplementation(() => {
      throw new Error('log sink unavailable');
    });

    await expect(draftSeason({ houseId, title: 'Autumn tables', viewer }, deps)).resolves.toEqual({
      seasonId,
      houseId,
      state: 'draft',
    });
  });
});
