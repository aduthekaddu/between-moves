import {
  DomainError,
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
  type NightPresenceDependencies,
} from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { changeNightPresence } from './presence';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const nightId = '01941f29-7c00-7000-8000-000000000901';
const userId = '01941f29-7c00-7000-8000-000000000101';
const now = new Date('2026-09-04T14:00:00.000Z');
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId,
  displayName: 'Ada',
  imageUrl: null,
};
const signed = { clientId: userId, displayName: 'Ada', signature: 'a'.repeat(43) };
const context = fakeAuthorizationContext({ viewerId: userId, houseId });

function dependencies(
  overrides: Partial<NightPresenceDependencies> = {},
): NightPresenceDependencies {
  return {
    authorizeHouseAction: vi.fn(async () => context),
    clock: { now: () => now },
    nights: { read: vi.fn(async () => ({ houseId, nightId, gameIds: [] })) },
    presence: {
      read: vi.fn(async () => ({ members: [] })),
      enter: vi.fn(async (_context, _nightId, entry) => ({ members: [entry] })),
      leave: vi.fn(async () => ({ members: [] })),
    },
    verifyPresence: vi.fn(() => ({
      expiresAt: new Date('2026-09-04T14:15:00.000Z'),
      leaseId: 'presence-lease',
    })),
    ...overrides,
  };
}

describe('Night presence command', () => {
  it('[BM-039] re-authorizes and enters with verified signed identity', async () => {
    const deps = dependencies();
    await expect(
      changeNightPresence(
        { houseId, nightId, viewer, command: { kind: 'enter', token: 'token', presence: signed } },
        deps,
      ),
    ).resolves.toMatchObject({ members: [signed] });
    expect(deps.authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'view_house_content' },
      houseId,
      viewer,
    );
    expect(deps.verifyPresence).toHaveBeenCalledWith({
      scope: { houseId, nightId, gameIds: [] },
      token: 'token',
      presence: signed,
      now,
    });
    expect(deps.presence.enter).toHaveBeenCalledWith(
      context,
      nightId,
      {
        ...signed,
        expiresAt: new Date('2026-09-04T14:15:00.000Z'),
        leaseId: 'presence-lease',
      },
      now,
    );
  });

  it('[BM-039] rejects a claimed identity before signature verification', async () => {
    const deps = dependencies();
    await expect(
      changeNightPresence(
        {
          houseId,
          nightId,
          viewer,
          command: { kind: 'enter', token: 'token', presence: { ...signed, displayName: 'Bea' } },
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(DomainError);
    expect(deps.verifyPresence).not.toHaveBeenCalled();
    expect(deps.presence.enter).not.toHaveBeenCalled();
  });

  it('[BM-039] leaves idempotently after re-verifying the signed identity', async () => {
    const deps = dependencies();
    await expect(
      changeNightPresence(
        {
          houseId,
          nightId,
          viewer,
          command: { kind: 'leave', token: 'token', presence: signed },
        },
        deps,
      ),
    ).resolves.toEqual({ members: [] });
    expect(deps.verifyPresence).toHaveBeenCalledOnce();
    expect(deps.presence.leave).toHaveBeenCalledWith(
      context,
      nightId,
      { clientId: userId, leaseId: 'presence-lease' },
      now,
    );
  });

  it('[BM-039] rejects an expired signed identity before changing presence', async () => {
    const deps = dependencies({
      verifyPresence: vi.fn(() => ({ expiresAt: now, leaseId: 'expired-lease' })),
    });
    await expect(
      changeNightPresence(
        { houseId, nightId, viewer, command: { kind: 'enter', token: 'token', presence: signed } },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(deps.presence.enter).not.toHaveBeenCalled();
  });

  it('[BM-039] re-authorizes leave and stops before Night access after a denial', async () => {
    const denied = dependencies({
      authorizeHouseAction: vi.fn(async () => {
        throw new HouseAuthorizationDeniedError('not_a_member', true);
      }),
    });
    await expect(
      changeNightPresence(
        { houseId, nightId, viewer, command: { kind: 'leave', token: 'token', presence: signed } },
        denied,
      ),
    ).rejects.toMatchObject({ reason: 'not_a_member', crossHouse: true });
    expect(denied.nights.read).not.toHaveBeenCalled();
    expect(denied.presence.leave).not.toHaveBeenCalled();
  });
});
