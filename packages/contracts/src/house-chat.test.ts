import { describe, expect, it } from 'vitest';
import { houseChatBodySchema, houseChatSnapshotSchema } from './house-chat';

describe('House chat contracts', () => {
  it('[BM-040] accepts a bounded plain-text body and rejects extra fields', () => {
    expect(houseChatBodySchema.parse({ body: '<script>alert(1)</script>' })).toEqual({
      body: '<script>alert(1)</script>',
    });
    expect(houseChatBodySchema.safeParse({ body: '' }).success).toBe(false);
    expect(houseChatBodySchema.safeParse({ body: 'a'.repeat(2_001) }).success).toBe(false);
    expect(houseChatBodySchema.safeParse({ body: 'ok', extra: true }).success).toBe(false);
  });

  it('[BM-040] accepts a durable chat snapshot without extra fields', () => {
    const snapshot = {
      houseId: '01941f29-7c00-7000-8000-000000000201',
      nightId: '01941f29-7c00-7000-8000-000000000901',
      chatSequence: '1',
      currentMembershipId: '01941f29-7c00-7000-8000-000000000621',
      canModerate: true,
      messages: [
        {
          id: '01941f29-7c00-7000-8000-000000000801',
          membershipId: '01941f29-7c00-7000-8000-000000000623',
          authorDisplayName: 'Bea',
          body: 'Hello from the rail',
          sequence: '1',
          createdAt: '2026-09-18T14:00:00.000Z',
        },
      ],
    };
    expect(houseChatSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(houseChatSnapshotSchema.safeParse({ ...snapshot, extra: true }).success).toBe(false);
  });
});
