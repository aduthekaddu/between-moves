import type {
  AuthenticatedViewer,
  ClosedSeasonReadRepository,
  ClosedSeasonView,
  HouseSeasonView,
  SeasonReadRepository,
} from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { readHouseSeason, readLastClosedSeason } from './read-house-season';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};
const context = fakeAuthorizationContext({ houseId, viewerId: viewer.userId });
const activeSeason: HouseSeasonView = {
  seasonId: '01941f29-7c00-7000-8000-000000000701',
  title: 'Autumn tables',
  state: 'active',
  startsAt: new Date('2026-09-04T00:00:00.000Z'),
  endsAt: new Date('2026-10-02T00:00:00.000Z'),
  charter: {
    version: 1,
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
  },
};

describe('readHouseSeason', () => {
  it('[BM-019] [PR-JRN-03] returns the current House Season through a member context', async () => {
    const seasons: SeasonReadRepository = { readCurrent: vi.fn(async () => activeSeason) };
    const authorizeHouseAction = vi.fn(async () => context);

    await expect(
      readHouseSeason({ houseId, viewer }, { authorizeHouseAction, seasons }),
    ).resolves.toEqual(activeSeason);
    expect(authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'view_house_content' },
      houseId,
      viewer,
    );
    expect(seasons.readCurrent).toHaveBeenCalledWith(context);
  });
});

describe('readLastClosedSeason', () => {
  it('[BM-047] returns final standings through a member context', async () => {
    const closed: ClosedSeasonView = {
      seasonId: '01941f29-7c00-7000-8000-000000000701',
      title: 'Autumn tables',
      state: 'closed',
      startsAt: new Date('2026-09-04T00:00:00.000Z'),
      endsAt: new Date('2026-10-02T00:00:00.000Z'),
      closedAt: new Date('2026-10-02T09:00:00.000Z'),
      standings: [
        {
          membershipId: '01941f29-7c00-7000-8000-000000000202',
          displayName: 'Ada',
          points: 6,
          rank: 1,
        },
      ],
    };
    const seasons: ClosedSeasonReadRepository = { readLatestClosed: vi.fn(async () => closed) };
    const authorizeHouseAction = vi.fn(async () => context);

    await expect(
      readLastClosedSeason({ houseId, viewer }, { authorizeHouseAction, seasons }),
    ).resolves.toEqual(closed);
    expect(authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'view_house_content' },
      houseId,
      viewer,
    );
    expect(seasons.readLatestClosed).toHaveBeenCalledWith(context);
  });
});
