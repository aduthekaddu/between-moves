import type { SeasonStandings } from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { createSeasonStandingsResponse } from './route';

const houseId = '01941f29-7c00-7000-8000-000000000601';
const seasonId = '01941f29-7c00-7000-8000-000000000691';
const request = new Request(
  `https://betweenmoves.test/api/houses/${houseId}/seasons/${seasonId}/standings`,
);
const standings: SeasonStandings = {
  houseId,
  seasonId,
  standings: [
    { membershipId: '01941f29-7c00-7000-8000-000000000621', points: 17 },
    { membershipId: '01941f29-7c00-7000-8000-000000000623', points: 11 },
  ],
};

describe('GET /api/houses/{houseId}/seasons/{seasonId}/standings', () => {
  it('[BM-034] [DR-SCORE-07] returns one private House Season ledger sum', async () => {
    const readStandings = vi.fn(async () => standings);
    const response = await createSeasonStandingsResponse(request, houseId, seasonId, readStandings);

    expect(readStandings).toHaveBeenCalledWith(request, houseId, seasonId);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual(standings);
  });

  it('[BM-034] [DR-SCORE-07] hides an unavailable House or Season', async () => {
    const response = await createSeasonStandingsResponse(
      request,
      houseId,
      seasonId,
      vi.fn(async () => null),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: 'not_found',
      detail: 'These Season standings are not available.',
    });
  });

  it('[BM-034] [DR-SEC-03] rejects invalid scope identifiers before reading', async () => {
    const readStandings = vi.fn(async () => standings);
    const response = await createSeasonStandingsResponse(
      request,
      houseId,
      'not-a-season',
      readStandings,
    );

    expect(response.status).toBe(422);
    expect(readStandings).not.toHaveBeenCalled();
  });
});
