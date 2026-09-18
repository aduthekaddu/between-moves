import type { RealtimePublishEnvelope } from '@between-moves/adapters';
import { z } from 'zod';
import { problemResponse } from '../../../../../../../../kernel/request';
import { getNightRail } from '../../../../../../../../modules/nights/rail';
import { getRealtimeNightFanout } from '../../../../../../../../server/realtime-fanout';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly houseId: string; readonly nightId: string }>;
}

const idSchema = z.string().uuid();

/** [BM-038] Cookie-authenticated Night rail event stream after the durable snapshot. */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { houseId, nightId } = await context.params;
  if (!idSchema.safeParse(houseId).success || !idSchema.safeParse(nightId).success) {
    return problemResponse(
      request,
      422,
      'validation_failed',
      'Validation failed',
      'House ID or Night ID is invalid.',
    );
  }
  const snapshot = await getNightRail(request, houseId, nightId);
  if (snapshot === null) {
    return problemResponse(
      request,
      404,
      'not_found',
      'Rail not available',
      'This Night rail is not available.',
    );
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  const stream = new ReadableStream({
    start(controller) {
      unsubscribe = getRealtimeNightFanout().subscribe(
        nightId,
        (envelope: RealtimePublishEnvelope) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(envelope)}\n\n`));
        },
      );
      controller.enqueue(encoder.encode(': attached\n\n'));
    },
    cancel() {
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': 'text/event-stream',
      Connection: 'keep-alive',
    },
  });
}
