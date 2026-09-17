import type { SeasonStandings } from '@between-moves/domain';
import { z } from 'zod';
import { problemResponse } from '../../../../../../../kernel/request';
import {
  getSeasonStandings,
  type SeasonStandingsReader,
} from '../../../../../../../modules/seasons/standings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const idSchema = z.string().uuid();

/** [BM-034] [DR-SCORE-07] Return one private House Season's ledger totals. */
export async function createSeasonStandingsResponse(
  request: Request,
  houseId: string,
  seasonId: string,
  readStandings: SeasonStandingsReader = getSeasonStandings,
): Promise<Response> {
  if (!idSchema.safeParse(houseId).success || !idSchema.safeParse(seasonId).success) {
    return problemResponse(
      request,
      422,
      'validation_failed',
      'Validation failed',
      'House ID or Season ID is invalid.',
    );
  }
  const result: SeasonStandings | null = await readStandings(request, houseId, seasonId);
  if (result === null) {
    return problemResponse(
      request,
      404,
      'not_found',
      'Standings not available',
      'These Season standings are not available.',
    );
  }
  return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
}

interface StandingsRouteContext {
  readonly params: Promise<{ readonly houseId: string; readonly seasonId: string }>;
}

export async function GET(request: Request, context: StandingsRouteContext): Promise<Response> {
  const { houseId, seasonId } = await context.params;
  return createSeasonStandingsResponse(request, houseId, seasonId);
}
