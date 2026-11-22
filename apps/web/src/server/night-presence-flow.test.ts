import { HmacRealtimeTokenIssuer, verifyRealtimePresenceIdentity } from '@between-moves/adapters';
import { changeNightPresence } from '@between-moves/application';
import type { AuthenticatedViewer } from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { createRealtimeMetricStubs } from '@between-moves/observability';
import { describe, expect, it } from 'vitest';
import { EphemeralNightPresenceStore } from '../modules/nights/presence';
import {
  createChangeNightPresenceHandler,
  type NightPresenceHandlerDependencies,
} from './night-presence-handler';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const nightId = '01941f29-7c00-7000-8000-000000000901';
const now = new Date('2026-09-04T14:00:00.000Z');
const serverKey = 'bm-039-integration-server-key';
const ada: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};
const bea: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000102',
  displayName: 'Bea',
  imageUrl: null,
};

function request(command: unknown): Request {
  return new Request(`https://app.example.test/api/houses/${houseId}/nights/${nightId}/presence`, {
    method: 'POST',
    headers: { origin: 'https://app.example.test', 'content-type': 'application/json' },
    body: JSON.stringify(command),
  });
}

function dependencies(
  viewer: AuthenticatedViewer,
  presence: EphemeralNightPresenceStore,
): NightPresenceHandlerDependencies {
  return {
    expectedOrigin: 'https://app.example.test',
    requireViewer: async () => viewer,
    limitPresence: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    changePresence: (command) =>
      changeNightPresence(command, {
        authorizeHouseAction: async (_action, scopedHouseId, scopedViewer) =>
          fakeAuthorizationContext({
            houseId: scopedHouseId,
            viewerId: scopedViewer.kind === 'authenticated' ? scopedViewer.userId : 'anonymous',
          }),
        clock: { now: () => now },
        nights: { read: async () => ({ houseId, nightId, gameIds: [] }) },
        presence,
        verifyPresence: ({ token, presence: identity }) =>
          verifyRealtimePresenceIdentity({
            token,
            presence: identity,
            serverKey,
            houseId,
            nightId,
            now,
          }),
      }),
    logger: { log: () => undefined },
    metrics: createRealtimeMetricStubs(),
    clock: { now: () => now },
  };
}

describe('Signed Night presence integration', () => {
  it('[BM-039] accepts server-signed identity and rejects a spectator replaying it', async () => {
    const store = new EphemeralNightPresenceStore();
    const issued = new HmacRealtimeTokenIssuer({
      appId: 'bm-039-integration',
      publicKey: 'bm-039-public-key',
      serverKey,
      random: () => Buffer.alloc(16, 9),
    }).issue({
      houseId,
      nightId,
      gameIds: [],
      clientId: ada.userId,
      displayName: ada.displayName,
      issuedAt: now,
    });
    const command = { kind: 'enter', token: issued.token, presence: issued.presence };

    const accepted = await createChangeNightPresenceHandler(dependencies(ada, store))(
      request(command),
      houseId,
      nightId,
    );
    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toEqual({
      presence: [issued.presence],
      presenceCount: 1,
    });

    const replayed = await createChangeNightPresenceHandler(dependencies(bea, store))(
      request(command),
      houseId,
      nightId,
    );
    expect(replayed.status).toBe(422);
    await expect(store.readPublic(houseId, nightId, now)).resolves.toEqual({
      members: [issued.presence],
    });
  });
});
