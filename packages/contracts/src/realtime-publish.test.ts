import { describe, expect, it } from 'vitest';
import { realtimePublishEnvelopeSchema } from './realtime-publish';

const rootKey = 'realtime-test-server-key';
const valid = {
  id: '01941f29-7c00-7000-8000-000000000501',
  channel: 'n'.repeat(22),
  name: 'game.move-accepted',
  sequence: '2',
  data: { aggregateId: '01941f29-7c00-7000-8000-000000000801', san: 'e5' },
  occurredAt: '2026-09-04T14:00:00.000Z',
};

describe('Realtime publish contract', () => {
  it('[BM-038] accepts a sequenced opaque envelope and rejects a UUID channel', () => {
    expect(realtimePublishEnvelopeSchema.parse(valid)).toEqual(valid);
    expect(
      realtimePublishEnvelopeSchema.safeParse({
        ...valid,
        channel: '01941f29-7c00-7000-8000-000000000901',
      }).success,
    ).toBe(false);
    expect(realtimePublishEnvelopeSchema.safeParse({ ...valid, serverKey: rootKey }).success).toBe(
      false,
    );
  });
});
