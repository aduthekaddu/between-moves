import {
  AuthenticationRequiredError,
  AuthorizationDeniedError,
  DomainError,
  MoveConflictError,
  NonSeatedMoveError,
  type AuthenticatedViewer,
} from '@between-moves/domain';
import type { MoveMetricStubs, StructuredLogger } from '@between-moves/observability';
import { describe, expect, it, vi } from 'vitest';
import { createSubmitMoveHandler, type SubmitMoveHandlerDependencies } from './submit-move-handler';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const gameId = '01941f29-7c00-7000-8000-000000000301';
const clientCommandId = '01941f29-7c00-7000-8000-000000000401';
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};

function request(body: unknown = validBody(), headers: Record<string, string> = {}): Request {
  return new Request(`https://app.example.test/api/houses/${houseId}/games/${gameId}/moves`, {
    method: 'POST',
    headers: {
      origin: 'https://app.example.test',
      'content-type': 'application/json',
      'x-request-id': 'bm-024-request',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function validBody() {
  return { expectedPly: 0, clientCommandId, move: { from: 'e2', to: 'e4' } };
}

function acceptedResult(completedNow = false) {
  return {
    gameId,
    houseId,
    ply: 1,
    uci: 'e2e4',
    san: 'e4',
    fenAfter: 'canonical-fen',
    sideToMove: 'black' as const,
    version: 1,
    clock: {
      kind: 'correspondence' as const,
      moveDueAt: new Date('2026-09-04T08:00:00.000Z'),
    },
    completedNow,
    replayed: false,
  };
}

function dependencies(
  overrides: Partial<SubmitMoveHandlerDependencies> = {},
): SubmitMoveHandlerDependencies {
  const metrics: MoveMetricStubs = {
    observeMoveAcceptLatency: vi.fn(),
    observeLiveMoveLatency: vi.fn(),
    incrementLiveFlagFall: vi.fn(),
    incrementMoveConflict: vi.fn(),
    incrementRejectedMoveFromSpectator: vi.fn(),
    incrementRateLimitHit: vi.fn(),
    snapshot: vi.fn(() => ({
      move_accept_latency_ms: [],
      live_move_latency_ms: [],
      live_flag_fall_total: 0,
      move_conflict_total: 0,
      rejected_move_from_spectator_total: 0,
      rate_limit_hit_total: 0,
    })),
  };
  return {
    expectedOrigin: 'https://app.example.test',
    requireViewer: vi.fn(async () => viewer),
    limitMove: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
    submitMove: vi.fn(async () => acceptedResult()),
    logger: { log: vi.fn() } satisfies StructuredLogger,
    metrics,
    clock: {
      now: vi
        .fn()
        .mockReturnValueOnce(new Date('2026-09-02T08:00:00.000Z'))
        .mockReturnValue(new Date('2026-09-02T08:00:00.025Z')),
    },
    ...overrides,
  };
}

describe('BM-024 submit Move HTTP boundary', () => {
  it('[BM-041] reports a server flag with no accepted Move and records live metrics', async () => {
    const deps = dependencies();
    vi.mocked(deps.submitMove).mockResolvedValue({
      flagged: true,
      gameId,
      houseId,
      ply: 0,
      sideToMove: 'white',
      version: 1,
      result: 'black_win',
      clock: { kind: 'live', whiteMs: 0, blackMs: 300_000, turnStartedAt: null },
      completedNow: true,
      replayed: false,
    });
    const response = await createSubmitMoveHandler(deps)(request(), houseId, gameId);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      state: 'completed',
      result: 'black_win',
      resultReason: 'flag',
      ply: 0,
      clock: { whiteMs: 0, blackMs: 300_000, turnStartedAt: null },
    });
    expect(deps.metrics.incrementLiveFlagFall).toHaveBeenCalledOnce();
    expect(deps.metrics.observeLiveMoveLatency).toHaveBeenCalledWith(25);
    expect(deps.metrics.observeMoveAcceptLatency).not.toHaveBeenCalled();
  });

  it('[BM-024] returns and observes the server-derived canonical Move', async () => {
    const deps = dependencies();
    const response = await createSubmitMoveHandler(deps)(request(), houseId, gameId);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      ply: 1,
      uci: 'e2e4',
      san: 'e4',
      fenAfter: 'canonical-fen',
      sideToMove: 'black',
      version: 1,
      clock: { moveDueAt: '2026-09-04T08:00:00.000Z' },
    });
    expect(deps.limitMove).toHaveBeenCalledWith(expect.any(Request), viewer.userId);
    expect(deps.submitMove).toHaveBeenCalledWith({
      houseId,
      gameId,
      expectedPly: 0,
      clientCommandId,
      move: { from: 'e2', to: 'e4' },
      viewer,
    });
    expect(deps.metrics.observeMoveAcceptLatency).toHaveBeenCalledWith(25);
    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'bm-024-request',
        actorId: viewer.userId,
        houseId,
        gameId,
        commandId: clientCommandId,
        event: 'game.move-accepted',
        outcome: 'success',
      }),
    );
  });

  it('[BM-024] [DR-MOVE-05] maps stale Moves to a conflict with the current version', async () => {
    const deps = dependencies({
      submitMove: vi.fn(async () => {
        throw new MoveConflictError({ version: 4, currentPly: 3, fen: 'current-fen' });
      }),
    });
    const response = await createSubmitMoveHandler(deps)(request(), houseId, gameId);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'move_conflict',
      meta: { version: 4, currentPly: 3, fen: 'current-fen' },
    });
    expect(deps.metrics.incrementMoveConflict).toHaveBeenCalledOnce();
  });

  it('[BM-028] logs game.completed when the accepted Move is terminal', async () => {
    const deps = dependencies();
    vi.mocked(deps.submitMove).mockResolvedValue(acceptedResult(true));

    await createSubmitMoveHandler(deps)(request(), houseId, gameId);

    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'game.completed',
        commandId: clientCommandId,
        data: { source: 'move' },
      }),
    );
  });

  it('[BM-024] maps seat/turn denial, illegal Moves, and rate limits safely', async () => {
    const forbidden = dependencies({
      submitMove: vi.fn(async () => {
        throw new AuthorizationDeniedError();
      }),
    });
    const illegal = dependencies({
      submitMove: vi.fn(async () => {
        throw new DomainError('validation_failed', 'Move is not legal');
      }),
    });
    const limited = dependencies({
      limitMove: vi.fn(async () => ({ allowed: false, retryAfterSeconds: 12 })),
    });

    expect((await createSubmitMoveHandler(forbidden)(request(), houseId, gameId)).status).toBe(403);
    expect((await createSubmitMoveHandler(illegal)(request(), houseId, gameId)).status).toBe(422);
    const limitedResponse = await createSubmitMoveHandler(limited)(request(), houseId, gameId);
    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.headers.get('retry-after')).toBe('12');
    expect(limited.submitMove).not.toHaveBeenCalled();
  });

  it('[BM-043] counts a non-seated Move rejection without accepting the command', async () => {
    const deps = dependencies({
      submitMove: vi.fn(async () => {
        throw new NonSeatedMoveError();
      }),
    });
    const response = await createSubmitMoveHandler(deps)(request(), houseId, gameId);
    expect(response.status).toBe(403);
    expect(deps.metrics.incrementRejectedMoveFromSpectator).toHaveBeenCalledOnce();
    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'game.move-rejected', outcome: 'rejected' }),
    );
  });

  it('[BM-024] [DR-SEC-03] rejects bad origin, anonymous, and malformed Move input', async () => {
    const deps = dependencies();
    const anonymous = dependencies({
      requireViewer: vi.fn(async () => {
        throw new AuthenticationRequiredError();
      }),
    });
    const badOrigin = request(validBody(), { origin: 'https://evil.example.test' });
    const malformed = dependencies();
    const versionFour = request({
      ...validBody(),
      clientCommandId: '550e8400-e29b-41d4-a716-446655440000',
    });

    expect((await createSubmitMoveHandler(deps)(badOrigin, houseId, gameId)).status).toBe(403);
    expect((await createSubmitMoveHandler(anonymous)(request(), houseId, gameId)).status).toBe(401);
    expect((await createSubmitMoveHandler(malformed)(versionFour, houseId, gameId)).status).toBe(
      422,
    );
    expect(malformed.limitMove).toHaveBeenCalledWith(expect.any(Request), viewer.userId);
  });
});
