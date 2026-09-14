import {
  HouseAuthorizationDeniedError,
  MoveConflictError,
  RetryableTransactionError,
  type AuthenticatedViewer,
  type SubmitMoveRepository,
} from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { submitMove } from './submit-move';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const gameId = '01941f29-7c00-7000-8000-000000000301';
const clientCommandId = '01941f29-7c00-7000-8000-000000000401';
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};
const context = fakeAuthorizationContext({ viewerId: viewer.userId, houseId });
const receivedAt = new Date('2026-09-02T08:00:00.000Z');

function dependencies(repository: Partial<SubmitMoveRepository> = {}) {
  const moves: SubmitMoveRepository = {
    submit: vi.fn(async () => ({
      gameId,
      houseId,
      ply: 1,
      uci: 'e2e4',
      san: 'e4',
      fenAfter: 'canonical-fen',
      sideToMove: 'black' as const,
      version: 1,
      clock: { kind: 'correspondence' as const, moveDueAt: new Date('2026-09-04T08:00:00Z') },
      completedNow: false,
      replayed: false,
    })),
    ...repository,
  };
  const ids = [
    '01941f29-7c00-7000-8000-000000000501',
    '01941f29-7c00-7000-8000-000000000502',
    '01941f29-7c00-7000-8000-000000000503',
    '01941f29-7c00-7000-8000-000000000504',
  ];
  return {
    authorizeHouseAction: vi.fn(async () => context),
    clock: { now: vi.fn(() => receivedAt) },
    ids: { generate: vi.fn(() => ids.shift()!) },
    rules: { applyMove: vi.fn() },
    moves,
  };
}

describe('BM-024 durable Move command', () => {
  it('[BM-024] [DR-MOVE-01/02] authorizes and submits one server-timestamped command', async () => {
    const deps = dependencies();
    const request = {
      houseId,
      gameId,
      expectedPly: 0,
      clientCommandId,
      move: { from: 'e2' as const, to: 'e4' as const },
      viewer,
    };

    await expect(submitMove(request, deps)).resolves.toMatchObject({ ply: 1, uci: 'e2e4' });
    expect(deps.authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'create_or_join_game' },
      houseId,
      viewer,
    );
    expect(deps.moves.submit).toHaveBeenCalledWith(context, {
      gameId,
      expectedPly: 0,
      clientCommandId,
      move: request.move,
      moveId: '01941f29-7c00-7000-8000-000000000501',
      outboxEventId: '01941f29-7c00-7000-8000-000000000502',
      completedEventId: '01941f29-7c00-7000-8000-000000000503',
      analysisEventId: '01941f29-7c00-7000-8000-000000000504',
      receivedAt,
      rules: deps.rules,
    });
  });

  it('[BM-024] [DR-SEC-01] denies a non-Member before persistence', async () => {
    const deps = dependencies();
    deps.authorizeHouseAction.mockRejectedValue(
      new HouseAuthorizationDeniedError('not_a_member', true),
    );

    await expect(
      submitMove(
        {
          houseId,
          gameId,
          expectedPly: 0,
          clientCommandId,
          move: { from: 'e2', to: 'e4' },
          viewer,
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'authorization_denied' });
    expect(deps.moves.submit).not.toHaveBeenCalled();
  });

  it('[BM-024] retries transient transactions with stable command IDs and preserves conflicts', async () => {
    const deps = dependencies();
    const accepted = {
      gameId,
      houseId,
      ply: 1,
      uci: 'e2e4',
      san: 'e4',
      fenAfter: 'canonical-fen',
      sideToMove: 'black' as const,
      version: 1,
      clock: { kind: 'correspondence' as const, moveDueAt: new Date('2026-09-04T08:00:00Z') },
      completedNow: false,
      replayed: false,
    };
    vi.mocked(deps.moves.submit)
      .mockRejectedValueOnce(new RetryableTransactionError())
      .mockResolvedValueOnce(accepted);

    const command = {
      houseId,
      gameId,
      expectedPly: 0,
      clientCommandId,
      move: { from: 'e2' as const, to: 'e4' as const },
      viewer,
    };
    await expect(submitMove(command, deps)).resolves.toEqual(accepted);
    expect(deps.moves.submit).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deps.moves.submit).mock.calls[0]?.[1]).toEqual(
      vi.mocked(deps.moves.submit).mock.calls[1]?.[1],
    );

    vi.mocked(deps.moves.submit).mockRejectedValue(
      new MoveConflictError({ version: 2, currentPly: 2, fen: 'current-fen' }),
    );
    await expect(submitMove(command, deps)).rejects.toMatchObject({
      code: 'move_conflict',
      current: { version: 2, currentPly: 2, fen: 'current-fen' },
    });
  });
});
