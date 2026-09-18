import {
  verifyRealtimePublishSignature,
  type RealtimePublishEnvelope,
} from '@between-moves/adapters';
import { realtimePublishEnvelopeSchema } from '@between-moves/contracts';
import {
  GAME_COMPLETED_TOPIC,
  GAME_MOVE_ACCEPTED_TOPIC,
  NIGHT_CHAT_DELETED_TOPIC,
  NIGHT_CHAT_POSTED_TOPIC,
  NIGHT_ENDED_TOPIC,
  NIGHT_STARTED_TOPIC,
} from '@between-moves/domain';
import type { Pool } from 'pg';
import { getConfig } from '../config';
import { getDatabase } from './database';
import { getRealtimeNightFanout, type RealtimeNightFanout } from './realtime-fanout';

async function readBody(request: Request): Promise<string | null> {
  try {
    return await request.text();
  } catch {
    return null;
  }
}

async function nightIdForEnvelope(
  envelope: RealtimePublishEnvelope,
  database: Pool,
): Promise<string | null> {
  if (envelope.name === NIGHT_STARTED_TOPIC || envelope.name === NIGHT_ENDED_TOPIC) {
    return typeof envelope.data.aggregateId === 'string' ? envelope.data.aggregateId : null;
  }
  if (envelope.name === NIGHT_CHAT_POSTED_TOPIC || envelope.name === NIGHT_CHAT_DELETED_TOPIC) {
    return typeof envelope.data.nightId === 'string' ? envelope.data.nightId : null;
  }
  if (envelope.name !== GAME_MOVE_ACCEPTED_TOPIC && envelope.name !== GAME_COMPLETED_TOPIC) {
    return null;
  }
  const gameId = envelope.data.aggregateId;
  const houseId = envelope.data.houseId;
  if (typeof gameId !== 'string' || typeof houseId !== 'string') return null;
  const result = await database.query<{ night_id: string | null }>(
    `select night_id::text as night_id from games where id = $1 and house_id = $2`,
    [gameId, houseId],
  );
  return result.rows[0]?.night_id ?? null;
}

export interface RealtimePublishHandlerDependencies {
  readonly serverKey: string;
  readonly database: Pool;
  readonly fanout: RealtimeNightFanout;
}

function productionDependencies(): RealtimePublishHandlerDependencies {
  return {
    serverKey: getConfig().realtimeServerKey,
    database: getDatabase().pool,
    fanout: getRealtimeNightFanout(),
  };
}

/** [BM-038] Internal signed publish seam from the outbox worker onto Night subscribers. */
export async function handleRealtimePublish(
  request: Request,
  dependencies: RealtimePublishHandlerDependencies = productionDependencies(),
): Promise<Response> {
  const body = await readBody(request);
  const signature = request.headers.get('x-realtime-signature');
  if (body === null || signature === null) {
    return new Response(null, { status: 401 });
  }
  if (!verifyRealtimePublishSignature(dependencies.serverKey, body, signature)) {
    return new Response(null, { status: 401 });
  }
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(body) as unknown;
  } catch {
    return new Response(null, { status: 422 });
  }
  const parsed = realtimePublishEnvelopeSchema.safeParse(parsedBody);
  if (!parsed.success) {
    return new Response(null, { status: 422 });
  }
  const nightId = await nightIdForEnvelope(parsed.data, dependencies.database);
  if (nightId === null) {
    return new Response(null, { status: 204 });
  }
  const result = dependencies.fanout.publish(nightId, parsed.data);
  return new Response(null, { status: result === 'duplicate' ? 409 : 204 });
}
