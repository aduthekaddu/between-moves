import { describe, expect, it } from 'vitest';
import { nightPresenceCommandSchema, nightPresenceResponseSchema } from './night-presence';

const presence = {
  clientId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  signature: 'a'.repeat(43),
};

describe('Night presence contracts', () => {
  it('[BM-039] accepts signed enter/leave commands and consistent counts', () => {
    expect(
      nightPresenceCommandSchema.parse({ kind: 'enter', token: 't'.repeat(32), presence }),
    ).toEqual({ kind: 'enter', token: 't'.repeat(32), presence });
    expect(nightPresenceResponseSchema.parse({ presence: [presence], presenceCount: 1 })).toEqual({
      presence: [presence],
      presenceCount: 1,
    });
  });

  it('[BM-039] rejects unsigned identity and mismatched counts', () => {
    expect(
      nightPresenceCommandSchema.safeParse({
        kind: 'enter',
        token: 't'.repeat(32),
        presence: { ...presence, signature: '' },
      }).success,
    ).toBe(false);
    expect(
      nightPresenceResponseSchema.safeParse({ presence: [presence], presenceCount: 2 }).success,
    ).toBe(false);
  });
});
