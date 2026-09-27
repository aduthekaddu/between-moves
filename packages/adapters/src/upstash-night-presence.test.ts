import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpstashNightPresenceStore, type NightPresenceRedisClient } from './upstash-night-presence';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const nightId = '01941f29-7c00-7000-8000-000000000901';
const userId = '01941f29-7c00-7000-8000-000000000101';
const otherUserId = '01941f29-7c00-7000-8000-000000000102';
const context = fakeAuthorizationContext({ viewerId: userId, houseId });
const otherContext = fakeAuthorizationContext({ viewerId: otherUserId, houseId });
const now = new Date('2026-09-04T14:00:00.000Z');

function fakeRedis() {
  const hashes = new Map<string, Record<string, unknown>>();
  const client: NightPresenceRedisClient = {
    hset: vi.fn(async (key, fields) => {
      hashes.set(key, { ...hashes.get(key), ...fields });
      return Object.keys(fields).length;
    }),
    hgetall: vi.fn(async (key) => (hashes.get(key) ?? null) as never),
    hdel: vi.fn(async (key, ...fields) => {
      const hash = hashes.get(key);
      if (hash === undefined) return 0;
      for (const field of fields) delete hash[field];
      return 1;
    }),
    expire: vi.fn(async (): Promise<0 | 1> => 1),
  };
  return { client, hashes };
}

describe('Upstash Night presence store', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('[BM-039] shares signed token leases and deduplicates a Member across tabs', async () => {
    const { client } = fakeRedis();
    const writer = new UpstashNightPresenceStore({ client });
    const reader = new UpstashNightPresenceStore({ client });
    const first = {
      clientId: userId,
      displayName: 'Ada',
      signature: 'a'.repeat(43),
      leaseId: 'tab-one',
      expiresAt: new Date('2026-09-04T14:15:00.000Z'),
    };
    const second = { ...first, leaseId: 'tab-two', signature: 'b'.repeat(43) };

    await writer.enter(context, nightId, first, now);
    await writer.enter(context, nightId, second, now);
    await expect(reader.readPublic(houseId, nightId, now)).resolves.toEqual({
      members: [{ clientId: userId, displayName: 'Ada', signature: 'b'.repeat(43) }],
    });
    await expect(
      reader.leave(context, nightId, { clientId: userId, leaseId: first.leaseId }, now),
    ).resolves.toEqual({
      members: [{ clientId: userId, displayName: 'Ada', signature: 'b'.repeat(43) }],
    });
    expect(client.expire).toHaveBeenCalledWith(expect.stringContaining(nightId), 3_600);
  });

  it('[BM-039] prunes expired and malformed leases from shared storage', async () => {
    const { client, hashes } = fakeRedis();
    const store = new UpstashNightPresenceStore({ client });
    const key = `between-moves:night-presence:${houseId}:${nightId}`;
    hashes.set(key, {
      expired: {
        clientId: userId,
        displayName: 'Ada',
        signature: 'a'.repeat(43),
        expiresAt: '2026-09-04T13:59:59.000Z',
      },
      malformed: { clientId: userId },
    });

    await expect(store.read(context, nightId, now)).resolves.toEqual({ members: [] });
    expect(client.hdel).toHaveBeenCalledWith(key, 'expired', 'malformed');
  });

  it('[BM-039] rejects a context that writes or removes another identity', async () => {
    const { client, hashes } = fakeRedis();
    const store = new UpstashNightPresenceStore({ client });
    const otherId = '01941f29-7c00-7000-8000-000000000102';

    await expect(
      store.enter(
        context,
        nightId,
        {
          clientId: otherId,
          displayName: 'Mallory',
          signature: 'm'.repeat(43),
          leaseId: 'forged',
          expiresAt: new Date('2026-09-04T14:15:00.000Z'),
        },
        now,
      ),
    ).rejects.toThrow(/context mismatch/);

    hashes.set(`between-moves:night-presence:${houseId}:${nightId}`, {
      forged: {
        clientId: otherId,
        displayName: 'Mallory',
        signature: 'm'.repeat(43),
        expiresAt: '2026-09-04T14:15:00.000Z',
      },
    });
    await expect(
      store.leave(context, nightId, { clientId: userId, leaseId: 'forged' }, now),
    ).rejects.toThrow(/context mismatch/);
  });

  it('[BM-039] orders distinct Members with the same display name by client id', async () => {
    const { client } = fakeRedis();
    const store = new UpstashNightPresenceStore({ client });
    await store.enter(
      otherContext,
      nightId,
      {
        clientId: otherUserId,
        displayName: 'Ada',
        signature: 'b'.repeat(43),
        leaseId: 'bea-tab-one',
        expiresAt: new Date('2026-09-04T14:15:00.000Z'),
      },
      now,
    );
    await store.enter(
      context,
      nightId,
      {
        clientId: userId,
        displayName: 'Ada',
        signature: 'a'.repeat(43),
        leaseId: 'ada-tab-one',
        expiresAt: new Date('2026-09-04T14:15:00.000Z'),
      },
      now,
    );

    await expect(store.readPublic(houseId, nightId, now)).resolves.toEqual({
      members: [
        { clientId: userId, displayName: 'Ada', signature: 'a'.repeat(43) },
        { clientId: otherUserId, displayName: 'Ada', signature: 'b'.repeat(43) },
      ],
    });
  });

  it('[BM-039] rejects on the first store failure so presence degrades without retry sleeps', async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => {
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', fetchMock);
    const store = new UpstashNightPresenceStore({ url: 'https://presence.test', token: 'token' });

    await expect(store.readPublic(houseId, nightId, now)).rejects.toThrow('fetch failed');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('[BM-039] rejects a hung store request at the deadline', async () => {
    const fetchMock = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const store = new UpstashNightPresenceStore({ url: 'https://presence.test', token: 'token' });

    await expect(store.readPublic(houseId, nightId, now)).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
