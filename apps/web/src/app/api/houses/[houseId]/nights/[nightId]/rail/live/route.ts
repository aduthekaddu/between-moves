import type { RealtimePublishEnvelope } from '@between-moves/adapters';
import type { NightPresenceSnapshot } from '@between-moves/domain';
import { z } from 'zod';
import { problemResponse } from '../../../../../../../../kernel/request';
import { getNightRail } from '../../../../../../../../modules/nights/rail';
import { getNightPresenceStore } from '../../../../../../../../modules/nights/presence';
import { getRealtimeNightFanout } from '../../../../../../../../server/realtime-fanout';
import { getRealtimeMetrics } from '../../../../../../../../server/rate-limit';

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
  let unsubscribeRail: (() => void) | undefined;
  let unsubscribePresence: (() => void) | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  let polling = false;
  const presenceStore = getNightPresenceStore();
  const presenceEvent = (presence: NightPresenceSnapshot) =>
    encoder.encode(
      `event: presence\ndata: ${JSON.stringify({
        presence: presence.members,
        presenceCount: presence.members.length,
      })}\n\n`,
    );
  const stream = new ReadableStream({
    start(controller) {
      let lastPresence = JSON.stringify(snapshot.presence);
      const emitPresence = (presence: NightPresenceSnapshot) => {
        if (closed) return;
        const fingerprint = JSON.stringify(presence.members);
        if (fingerprint === lastPresence) return;
        lastPresence = fingerprint;
        getRealtimeMetrics().setPresenceCount(presence.members.length);
        controller.enqueue(presenceEvent(presence));
      };
      const refreshPresence = async () => {
        if (closed || polling) return;
        polling = true;
        try {
          emitPresence(await presenceStore.readPublic(houseId, nightId, new Date()));
        } catch {
          // A transient shared-store failure does not terminate an authenticated rail stream.
        } finally {
          polling = false;
        }
      };
      unsubscribeRail = getRealtimeNightFanout().subscribe(
        nightId,
        (envelope: RealtimePublishEnvelope) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(envelope)}\n\n`));
        },
      );
      unsubscribePresence = presenceStore.subscribe?.(houseId, nightId, emitPresence);
      // Shared-store polling carries presence changes across serverless instances.
      poll = setInterval(() => void refreshPresence(), 2_000);
      heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(': heartbeat\n\n'));
      }, 30_000);
      controller.enqueue(encoder.encode(': attached\n\n'));
    },
    cancel() {
      closed = true;
      unsubscribeRail?.();
      unsubscribePresence?.();
      if (poll !== undefined) clearInterval(poll);
      if (heartbeat !== undefined) clearInterval(heartbeat);
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
