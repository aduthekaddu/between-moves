import { HouseAuthorizationDeniedError, type SeasonStandings } from '@between-moves/domain';
import { createStructuredLogger } from '@between-moves/observability';
import { describe, expect, it, vi } from 'vitest';
import { createSeasonStandingsReader } from './standings';

const houseId = '01941f29-7c00-7000-8000-000000000601';
const seasonId = '01941f29-7c00-7000-8000-000000000691';
const viewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000611',
  displayName: 'Ada',
  imageUrl: null,
} as const;
const result: SeasonStandings = { houseId, seasonId, standings: [] };
const now = new Date('2026-09-12T12:00:00.000Z');

function request(): Request {
  return new Request(`https://betweenmoves.test/h/${houseId}`, {
    headers: { 'x-request-id': 'bm-034-standings' },
  });
}

describe('Season standings request seam', () => {
  it('[BM-034] logs a PII-free successful standings view', async () => {
    const lines: string[] = [];
    const readSeasonStandings = vi.fn(async () => result);
    const reader = createSeasonStandingsReader({
      getViewer: vi.fn(async () => viewer),
      readSeasonStandings,
      logger: createStructuredLogger({
        clock: { now: () => now },
        sink: (line) => lines.push(line),
      }),
      clock: { now: () => now },
    });

    await expect(reader(request(), houseId, seasonId)).resolves.toEqual(result);
    expect(readSeasonStandings).toHaveBeenCalledWith({ houseId, seasonId, viewer });
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      house_id: houseId,
      event: 'season.standings-viewed',
      data: { season_id: seasonId },
    });
    expect(lines[0]).not.toContain(viewer.displayName);
  });

  it('[BM-034] [DR-SEC-01] hides House authorization denials', async () => {
    const logger = { log: vi.fn() };
    const reader = createSeasonStandingsReader({
      getViewer: vi.fn(async () => viewer),
      readSeasonStandings: vi.fn(async () => {
        throw new HouseAuthorizationDeniedError('not_a_member', true);
      }),
      logger,
      clock: { now: () => now },
    });

    await expect(reader(request(), houseId, seasonId)).resolves.toBeNull();
    expect(logger.log).not.toHaveBeenCalled();
  });
});
