import { publishHousePuzzle } from '../../../../../modules/stories/puzzles';
import { createPuzzlePublishHandler } from '../../../../../server/puzzle-publish-handler';
import { requireViewer } from '../../../../../server/viewer';
import { getConfig } from '../../../../../config';
import { getLogger } from '../../../../../server/logger';
import { createPuzzleMetricStubs } from '@between-moves/observability';

const metrics = createPuzzleMetricStubs();

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  request: Request,
  context: { params: Promise<{ houseId: string }> },
): Promise<Response> {
  const { houseId } = await context.params;
  return createPuzzlePublishHandler({
    expectedOrigin: getConfig().appOrigin.origin,
    requireViewer,
    publish: publishHousePuzzle,
    recordPublished: ({ houseId, puzzleId, actorId }) => {
      metrics.incrementPublished();
      getLogger().log({
        level: 'info',
        requestId: request.headers.get('x-request-id') ?? 'request-unavailable',
        actorId,
        houseId,
        gameId: null,
        commandId: null,
        event: 'bm.puzzle.published',
        outcome: 'success',
        durationMs: 0,
        data: { puzzle_id: puzzleId, ...metrics.snapshot() },
      });
    },
  })(request, houseId);
}
