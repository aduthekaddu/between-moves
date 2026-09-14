import {
  AuthenticationRequiredError,
  AuthorizationDeniedError,
  MoveConflictError,
  type AuthenticatedViewer,
} from '@between-moves/domain';
import type { StructuredLogger } from '@between-moves/observability';
import { describe, expect, it, vi } from 'vitest';
import {
  createDrawGameHandler,
  createResignGameHandler,
  type GameCompletionHandlerDependencies,
} from './game-completion-handler';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const gameId = '01941f29-7c00-7000-8000-000000000301';
const clientCommandId = '01941f29-7c00-7000-8000-000000000401';
const completedAt = new Date('2026-09-10T08:00:00.000Z');
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};

function request(path: 'resign' | 'draw', body: unknown, origin = 'https://app.example.test') {
  return new Request(`https://app.example.test/api/houses/${houseId}/games/${gameId}/${path}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', 'x-request-id': 'bm-028-request' },
    body: JSON.stringify(body),
  });
}

function dependencies(
  overrides: Partial<GameCompletionHandlerDependencies> = {},
): GameCompletionHandlerDependencies {
  return {
    expectedOrigin: 'https://app.example.test',
    requireViewer: vi.fn(async () => viewer),
    resignGame: vi.fn(async () => ({
      gameId,
      houseId,
      state: 'completed' as const,
      result: 'black_win' as const,
      resultReason: 'resign' as const,
      completedAt,
      pendingDrawOffer: null,
      completedNow: true,
      replayed: false,
    })),
    handleDraw: vi.fn(async () => ({
      gameId,
      houseId,
      state: 'active' as const,
      result: null,
      resultReason: null,
      completedAt: null,
      pendingDrawOffer: { offeringMembershipId: 'membership-id', ply: 4 },
      completedNow: false,
      replayed: false,
    })),
    logger: { log: vi.fn() } satisfies StructuredLogger,
    clock: { now: vi.fn(() => completedAt) },
    ...overrides,
  };
}

describe('BM-028 Game completion HTTP boundaries', () => {
  it('[BM-028] returns a resignation result and logs game.completed without Member details', async () => {
    const deps = dependencies();
    const response = await createResignGameHandler(deps)(
      request('resign', { clientCommandId }),
      houseId,
      gameId,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      state: 'completed',
      result: 'black_win',
      resultReason: 'resign',
      completedAt: completedAt.toISOString(),
    });
    expect(deps.resignGame).toHaveBeenCalledWith({ houseId, gameId, clientCommandId, viewer });
    expect(deps.logger.log).toHaveBeenCalledWith({
      level: 'info',
      requestId: 'bm-028-request',
      actorId: viewer.userId,
      houseId,
      gameId,
      commandId: clientCommandId,
      event: 'game.completed',
      outcome: 'success',
      durationMs: 0,
      data: { source: 'resign', result: 'black_win', resultReason: 'resign' },
    });
  });

  it('[BM-028] submits draw offers and returns the canonical pending offer', async () => {
    const deps = dependencies();
    const response = await createDrawGameHandler(deps)(
      request('draw', { action: 'offer', clientCommandId }),
      houseId,
      gameId,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      state: 'active',
      result: null,
      pendingDrawOffer: { offeringMembershipId: 'membership-id', ply: 4 },
    });
    expect(deps.handleDraw).toHaveBeenCalledWith({
      houseId,
      gameId,
      action: 'offer',
      clientCommandId,
      viewer,
    });
    expect(deps.logger.log).not.toHaveBeenCalled();
  });

  it('[BM-028] maps and observes non-seated denial and cleared draw offers safely', async () => {
    const denied = dependencies({
      resignGame: vi.fn(async () => {
        throw new AuthorizationDeniedError();
      }),
    });
    const cleared = dependencies({
      handleDraw: vi.fn(async () => {
        throw new MoveConflictError({ version: 4, currentPly: 4, fen: 'canonical-fen' });
      }),
    });

    const deniedResponse = await createResignGameHandler(denied)(
      request('resign', { clientCommandId }),
      houseId,
      gameId,
    );
    const clearedResponse = await createDrawGameHandler(cleared)(
      request('draw', { action: 'accept', clientCommandId }),
      houseId,
      gameId,
    );

    expect(deniedResponse.status).toBe(403);
    expect(clearedResponse.status).toBe(409);
    await expect(clearedResponse.json()).resolves.toMatchObject({ code: 'move_conflict' });
    expect(denied.logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'game.completion-rejected',
        outcome: 'rejected',
        data: { source: 'resign', code: 'authorization_denied' },
      }),
    );
  });

  it('[BM-028] rejects bad origins, anonymous viewers, routes, and bodies', async () => {
    const deps = dependencies();
    const anonymous = dependencies({
      requireViewer: vi.fn(async () => {
        throw new AuthenticationRequiredError();
      }),
    });

    expect(
      (
        await createResignGameHandler(deps)(
          request('resign', { clientCommandId }, 'https://evil.example.test'),
          houseId,
          gameId,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await createResignGameHandler(anonymous)(
          request('resign', { clientCommandId }),
          houseId,
          gameId,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await createDrawGameHandler(deps)(
          request('draw', { action: 'decline', clientCommandId }),
          houseId,
          gameId,
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await createResignGameHandler(deps)(
          request('resign', { clientCommandId }),
          'bad-house',
          gameId,
        )
      ).status,
    ).toBe(422);
  });
});
