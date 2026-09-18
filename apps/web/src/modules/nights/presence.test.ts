import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { EphemeralNightPresenceStore } from './presence';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const nightId = '01941f29-7c00-7000-8000-000000000901';
const userId = '01941f29-7c00-7000-8000-000000000101';
const context = fakeAuthorizationContext({ viewerId: userId, houseId });
const now = new Date('2026-09-04T14:00:00.000Z');
const entry = {
  clientId: userId,
  displayName: 'Ada',
  signature: 'a'.repeat(43),
  leaseId: 'ada-tab-one',
  expiresAt: new Date('2026-09-04T14:15:00.000Z'),
};

describe('Ephemeral Night presence store', () => {
  it('[BM-039] publishes idempotent enter/leave snapshots', async () => {
    const store = new EphemeralNightPresenceStore();
    const listener = vi.fn();
    store.subscribe(houseId, nightId, listener);

    await expect(store.enter(context, nightId, entry, now)).resolves.toEqual({
      members: [{ clientId: userId, displayName: 'Ada', signature: 'a'.repeat(43) }],
    });
    await expect(store.enter(context, nightId, entry, now)).resolves.toMatchObject({
      members: [{ clientId: userId }],
    });
    await expect(
      store.leave(context, nightId, { clientId: userId, leaseId: entry.leaseId }, now),
    ).resolves.toEqual({ members: [] });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('[BM-039] expires presence without touching durable attendance', async () => {
    const store = new EphemeralNightPresenceStore();
    await store.enter(context, nightId, entry, now);
    await expect(
      store.read(context, nightId, new Date('2026-09-04T14:15:00.000Z')),
    ).resolves.toEqual({ members: [] });
  });

  it('[BM-039] rejects a context trying to write another client identity', async () => {
    const store = new EphemeralNightPresenceStore();
    await expect(
      store.enter(
        context,
        nightId,
        { ...entry, clientId: '01941f29-7c00-7000-8000-000000000102' },
        now,
      ),
    ).rejects.toThrow(/context mismatch/);
  });

  it('[BM-039] keeps a Member present while another signed tab lease remains', async () => {
    const store = new EphemeralNightPresenceStore();
    const second = { ...entry, leaseId: 'ada-tab-two', signature: 'b'.repeat(43) };
    await store.enter(context, nightId, entry, now);
    await store.enter(context, nightId, second, now);

    await expect(
      store.leave(context, nightId, { clientId: userId, leaseId: entry.leaseId }, now),
    ).resolves.toEqual({
      members: [{ clientId: userId, displayName: 'Ada', signature: 'b'.repeat(43) }],
    });
  });
});
