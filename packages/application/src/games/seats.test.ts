import {
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
  type GameSeatCreationRepository,
} from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { createGameSeat } from './seats';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};
const context = fakeAuthorizationContext({ viewerId: viewer.userId, houseId });
const ids = [
  '01941f29-7c00-7000-8000-000000000301',
  '01941f29-7c00-7000-8000-000000000302',
] as const;
const now = new Date('2026-09-02T08:00:00.000Z');

function dependencies(repository: Partial<GameSeatCreationRepository> = {}) {
  let nextId = 0;
  const seats: GameSeatCreationRepository = {
    create: vi.fn(async (_context, input) => ({
      gameId: input.gameId,
      openSeatId: input.openSeatId,
      houseId,
      seasonId: '01941f29-7c00-7000-8000-000000000401',
      creatorMembershipId: '01941f29-7c00-7000-8000-000000000501',
      intendedMembershipId: input.intendedMembershipId,
      offeredColor: input.offeredColor,
      creatorColor: input.creatorColor,
      expiresAt: input.expiresAt,
      state: 'waiting' as const,
      createdNow: true,
    })),
    ...repository,
  };
  return {
    authorizeHouseAction: vi.fn(async () => context),
    clock: { now: () => now },
    ids: { generate: vi.fn(() => ids[nextId++]!) },
    colors: { choose: vi.fn(() => 'black' as const) },
    seats,
  };
}

describe('BM-022 Open seat creation', () => {
  it('[BM-022] [DR-SEAT-01..02] creates a waiting correspondence Game with the creator seated', async () => {
    const deps = dependencies();

    await expect(
      createGameSeat(
        {
          houseId,
          mode: 'correspondence',
          clockPolicy: { kind: 'correspondence', perMoveHours: 48 },
          offeredColor: 'black',
          intendedMembershipId: null,
          idempotencyKey: 'seat-command-1',
          viewer,
        },
        deps,
      ),
    ).resolves.toMatchObject({
      gameId: ids[0],
      openSeatId: ids[1],
      offeredColor: 'black',
      creatorColor: 'white',
      state: 'waiting',
    });
    expect(deps.authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'create_or_join_game' },
      houseId,
      viewer,
    );
    expect(deps.colors.choose).not.toHaveBeenCalled();
    expect(deps.seats.create).toHaveBeenCalledWith(context, {
      gameId: ids[0],
      openSeatId: ids[1],
      mode: 'correspondence',
      clockPolicy: { kind: 'correspondence', perMoveHours: 48 },
      offeredColor: 'black',
      creatorColor: 'white',
      intendedMembershipId: null,
      idempotencyKey: 'seat-command-1',
      idempotencyPayload:
        '{"mode":"correspondence","clockPolicy":{"kind":"correspondence","perMoveHours":48},"offeredColor":"black","intendedMembershipId":null}',
      createdAt: now,
      expiresAt: new Date('2026-09-09T08:00:00.000Z'),
    });
  });

  it('[BM-022] records the intended Member and chooses a color for an any-color offer', async () => {
    const deps = dependencies();
    const intendedMembershipId = '01941f29-7c00-7000-8000-000000000502';

    await expect(
      createGameSeat(
        {
          houseId,
          mode: 'correspondence',
          clockPolicy: { kind: 'correspondence', perMoveHours: 24 },
          offeredColor: 'any',
          intendedMembershipId,
          idempotencyKey: null,
          viewer,
        },
        deps,
      ),
    ).resolves.toMatchObject({ intendedMembershipId, creatorColor: 'black' });
    expect(deps.colors.choose).toHaveBeenCalledOnce();
  });

  it('[BM-022] denies a non-member before persistence', async () => {
    const deps = dependencies();
    deps.authorizeHouseAction.mockRejectedValue(
      new HouseAuthorizationDeniedError('not_a_member', true),
    );

    await expect(
      createGameSeat(
        {
          houseId,
          mode: 'correspondence',
          clockPolicy: { kind: 'correspondence', perMoveHours: 24 },
          offeredColor: 'white',
          intendedMembershipId: null,
          idempotencyKey: null,
          viewer,
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'authorization_denied', reason: 'not_a_member' });
    expect(deps.seats.create).not.toHaveBeenCalled();
  });
});
