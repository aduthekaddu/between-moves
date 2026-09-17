import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
  type IssuedRealtimeToken,
  type NightRealtimeScopeRepository,
  type RealtimeTokenIssuer,
} from '@between-moves/domain';
import { fakeAuthorizationContext, FakeClock } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { mintRealtimeToken } from './realtime-token';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const nightId = '01941f29-7c00-7000-8000-000000000901';
const otherNightId = '01941f29-7c00-7000-8000-000000000902';
const gameId = '01941f29-7c00-7000-8000-000000000801';
const issuedAt = new Date('2026-09-04T14:00:00.000Z');
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};
const context = fakeAuthorizationContext({ viewerId: viewer.userId, houseId });

function issuedToken(nightChannel = 'night-channel'): IssuedRealtimeToken {
  return {
    token: 'signed-token',
    expiresAt: new Date('2026-09-04T14:15:00.000Z'),
    clientId: viewer.userId,
    publicKey: 'realtime-public-key',
    channels: {
      night: nightChannel,
      games: [{ gameId, channel: 'game-channel' }],
    },
    presence: {
      clientId: viewer.userId,
      displayName: viewer.displayName,
      signature: 'presence-signature',
    },
  };
}

function dependencies(
  nights: Partial<NightRealtimeScopeRepository> = {},
  tokens: Partial<RealtimeTokenIssuer> = {},
) {
  return {
    authorizeHouseAction: vi.fn(async () => context),
    clock: new FakeClock(issuedAt),
    nights: {
      read: vi.fn(async () => ({
        houseId,
        nightId,
        gameIds: [gameId],
      })),
      ...nights,
    },
    tokens: {
      issue: vi.fn(() => issuedToken()),
      ...tokens,
    },
  };
}

describe('Realtime token minting', () => {
  it('[BM-037] mints a token scoped to the authorized Night and its games', async () => {
    const deps = dependencies();

    await expect(mintRealtimeToken({ houseId, nightId, viewer }, deps)).resolves.toEqual(
      issuedToken(),
    );
    expect(deps.authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'view_house_content' },
      houseId,
      viewer,
    );
    expect(deps.nights.read).toHaveBeenCalledWith(context, nightId);
    expect(deps.tokens.issue).toHaveBeenCalledWith({
      houseId,
      nightId,
      gameIds: [gameId],
      clientId: viewer.userId,
      displayName: viewer.displayName,
      issuedAt,
    });
  });

  it('[BM-037] [DR-SEC-01] denies a non-member before reading another Night', async () => {
    const read = vi.fn(async () => ({ houseId, nightId: otherNightId, gameIds: [gameId] }));
    const issue = vi.fn(() => issuedToken('other-night'));
    const deps = dependencies({ read }, { issue });
    deps.authorizeHouseAction.mockRejectedValue(
      new HouseAuthorizationDeniedError('not_a_member', true),
    );

    await expect(
      mintRealtimeToken({ houseId, nightId: otherNightId, viewer }, deps),
    ).rejects.toMatchObject({ reason: 'not_a_member', crossHouse: true });
    expect(read).not.toHaveBeenCalled();
    expect(issue).not.toHaveBeenCalled();
  });

  it('[BM-037] denies anonymous viewers before authorization', async () => {
    const deps = dependencies();

    await expect(
      mintRealtimeToken({ houseId, nightId, viewer: { kind: 'anonymous' } }, deps),
    ).rejects.toBeInstanceOf(AuthenticationRequiredError);
    expect(deps.authorizeHouseAction).not.toHaveBeenCalled();
    expect(deps.tokens.issue).not.toHaveBeenCalled();
  });

  it('[BM-037] [DR-SEC-01] does not mint when the Night is outside the House scope', async () => {
    const issue = vi.fn(() => issuedToken());
    const deps = dependencies({ read: vi.fn(async () => null) }, { issue });

    await expect(mintRealtimeToken({ houseId, nightId, viewer }, deps)).rejects.toBeInstanceOf(
      DomainError,
    );
    await expect(mintRealtimeToken({ houseId, nightId, viewer }, deps)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(issue).not.toHaveBeenCalled();
  });
});
