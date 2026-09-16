import type { AuthenticatedViewer } from '@between-moves/domain';
import { HouseAuthorizationDeniedError } from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { readCurrentGameReaction, setGameReaction } from './reactions';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const gameId = '01941f29-7c00-7000-8000-000000000202';
const reactionId = '01941f29-7c00-7000-8000-000000000203';
const reactedAt = new Date('2026-09-16T08:00:00.000Z');
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};
const context = fakeAuthorizationContext({ houseId, viewerId: viewer.userId });

describe('Game Reactions', () => {
  it('[BM-031] [DR-REACT-01] authorizes an active Member and upserts one current Reaction', async () => {
    const authorizeHouseAction = vi.fn(async () => context);
    const reactions = {
      set: vi.fn(async () => ({
        membershipId: '01941f29-7c00-7000-8000-000000000204',
        reaction: 'brilliant' as const,
        reactedAt,
      })),
      readCurrent: vi.fn(),
    };

    await expect(
      setGameReaction(
        { houseId, gameId, reaction: 'brilliant', viewer },
        {
          authorizeHouseAction,
          reactions,
          clock: { now: () => reactedAt },
          ids: { generate: () => reactionId },
        },
      ),
    ).resolves.toEqual({
      membershipId: '01941f29-7c00-7000-8000-000000000204',
      reaction: 'brilliant',
      reactedAt,
    });

    expect(authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'set_game_reaction' },
      houseId,
      viewer,
    );
    expect(reactions.set).toHaveBeenCalledWith(context, {
      id: reactionId,
      gameId,
      reaction: 'brilliant',
      reactedAt,
    });
  });

  it('[BM-031] [DR-SEC-01] never writes after a cross-House denial', async () => {
    const set = vi.fn();
    await expect(
      setGameReaction(
        { houseId, gameId, reaction: 'funny', viewer },
        {
          authorizeHouseAction: vi.fn(async () => {
            throw new HouseAuthorizationDeniedError('not_a_member', true);
          }),
          reactions: { set, readCurrent: vi.fn() },
          clock: { now: () => reactedAt },
          ids: { generate: () => reactionId },
        },
      ),
    ).rejects.toMatchObject({ reason: 'not_a_member', crossHouse: true });
    expect(set).not.toHaveBeenCalled();
  });

  it('[BM-031] reads the viewer current Reaction behind House authorization', async () => {
    const authorizeHouseAction = vi.fn(async () => context);
    const readCurrent = vi.fn(async () => 'dramatic' as const);

    await expect(
      readCurrentGameReaction(
        { houseId, gameId, viewer },
        { authorizeHouseAction, reactions: { set: vi.fn(), readCurrent } },
      ),
    ).resolves.toBe('dramatic');
    expect(authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'view_house_content' },
      houseId,
      viewer,
    );
    expect(readCurrent).toHaveBeenCalledWith(context, gameId);
  });
});
