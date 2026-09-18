import { signRealtimePublish } from '@between-moves/adapters';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { RealtimeNightFanout } from './realtime-fanout';
import { handleRealtimePublish } from './realtime-publish-handler';

const serverKey = 'realtime-test-server-key';
const envelope = {
  id: '01941f29-7c00-7000-8000-000000000501',
  channel: 'n'.repeat(22),
  name: 'night.started',
  sequence: '1',
  data: {
    houseId: '01941f29-7c00-7000-8000-000000000201',
    aggregateId: '01941f29-7c00-7000-8000-000000000901',
    at: '2026-09-04T14:00:00.000Z',
  },
  occurredAt: '2026-09-04T14:00:00.000Z',
};

describe('Realtime publish HTTP seam', () => {
  it('[BM-038] rejects a missing or invalid signature and fans out a Night event', async () => {
    const body = JSON.stringify(envelope);
    const fanout = new RealtimeNightFanout();
    const listener = vi.fn();
    fanout.subscribe(envelope.data.aggregateId, listener);
    const dependencies = {
      serverKey,
      database: { query: vi.fn() } as unknown as Pool,
      fanout,
    };

    const unsigned = await handleRealtimePublish(
      new Request('https://app.example.test/api/internal/realtime/publish', {
        method: 'POST',
        body,
      }),
      dependencies,
    );
    expect(unsigned.status).toBe(401);

    const forged = await handleRealtimePublish(
      new Request('https://app.example.test/api/internal/realtime/publish', {
        method: 'POST',
        headers: { 'x-realtime-signature': signRealtimePublish('other-key', body) },
        body,
      }),
      dependencies,
    );
    expect(forged.status).toBe(401);

    const published = await handleRealtimePublish(
      new Request('https://app.example.test/api/internal/realtime/publish', {
        method: 'POST',
        headers: { 'x-realtime-signature': signRealtimePublish(serverKey, body) },
        body,
      }),
      dependencies,
    );
    expect(published.status).toBe(204);
    expect(listener).toHaveBeenCalledOnce();
  });
});
