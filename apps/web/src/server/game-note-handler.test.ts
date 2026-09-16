import {
  HouseAuthorizationDeniedError,
  type GameNote,
  type RateLimitResult,
} from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { createNoteRateLimit } from '../kernel/note-rate-limit';
import { InMemoryRateLimiter } from '../kernel/rate-limit';
import { createGameNoteHandler } from './game-note-handler';

const houseId = '01941f29-7c00-7000-8000-000000000601';
const gameId = '01941f29-7c00-7000-8000-000000000701';
const viewer = {
  kind: 'authenticated' as const,
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};

function request(body: unknown = { body: '<script>alert(1)</script>' }) {
  return new Request(`https://betweenmoves.test/api/houses/${houseId}/games/${gameId}/note`, {
    method: 'POST',
    headers: {
      origin: 'https://betweenmoves.test',
      'content-type': 'application/json',
      'x-request-id': 'bm-032-note',
    },
    body: JSON.stringify(body),
  });
}

function dependencies() {
  return {
    expectedOrigin: 'https://betweenmoves.test',
    requireViewer: vi.fn(async () => viewer),
    limitNote: vi.fn(async (): Promise<RateLimitResult> => ({
      allowed: true,
      retryAfterSeconds: 0,
    })),
    saveGameNote: vi.fn(async (input: { readonly body: string }): Promise<GameNote> => ({
      membershipId: '01941f29-7c00-7000-8000-000000000201',
      authorDisplayName: 'Ada',
      body: input.body,
      createdAt: new Date('2026-09-16T08:00:00.000Z'),
      editedAt: null,
    })),
    logger: { log: vi.fn() },
    metrics: { incrementNoteSave: vi.fn(), incrementRateLimitHit: vi.fn(), snapshot: vi.fn() },
    clock: { now: () => new Date('2026-09-16T08:00:00.000Z') },
  };
}

describe('POST /api/houses/{houseId}/games/{gameId}/note', () => {
  it('[BM-032] saves raw plain text and observes metadata-only bm.note.created', async () => {
    const deps = dependencies();
    const incoming = request();
    const response = await createGameNoteHandler(deps)(incoming, houseId, gameId);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toMatchObject({
      body: '<script>alert(1)</script>',
      editedAt: null,
    });
    expect(deps.limitNote).toHaveBeenCalledWith(incoming, viewer.userId);
    expect(deps.saveGameNote).toHaveBeenCalledWith({
      houseId,
      gameId,
      body: '<script>alert(1)</script>',
      viewer,
    });
    expect(deps.metrics.incrementNoteSave).toHaveBeenCalledOnce();
    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'bm.note.created',
        actorId: viewer.userId,
        houseId,
        gameId,
        data: {
          actor_membership_id: '01941f29-7c00-7000-8000-000000000201',
          edited: false,
        },
      }),
    );
    expect(JSON.stringify(deps.logger.log.mock.calls)).not.toContain('<script>');
  });

  it('[BM-032] rejects empty and over-length notes before persistence', async () => {
    for (const body of ['', 'a'.repeat(2_001)]) {
      const deps = dependencies();
      const response = await createGameNoteHandler(deps)(request({ body }), houseId, gameId);
      expect(response.status).toBe(422);
      expect(deps.saveGameNote).not.toHaveBeenCalled();
    }
  });

  it('[BM-032] records edits as operational saves without inventing an analytics event', async () => {
    const deps = dependencies();
    deps.saveGameNote.mockResolvedValue({
      membershipId: '01941f29-7c00-7000-8000-000000000201',
      authorDisplayName: 'Ada',
      body: 'Edited reflection',
      createdAt: new Date('2026-09-16T08:00:00.000Z'),
      editedAt: new Date('2026-09-16T08:05:00.000Z'),
    });
    const response = await createGameNoteHandler(deps)(
      request({ body: 'Edited reflection' }),
      houseId,
      gameId,
    );
    expect(response.status).toBe(200);
    expect(deps.metrics.incrementNoteSave).toHaveBeenCalledOnce();
    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'game.note-saved',
        data: expect.objectContaining({ edited: true }),
      }),
    );
    expect(JSON.stringify(deps.logger.log.mock.calls)).not.toContain('Edited reflection');
  });

  it('[BM-032] [DR-SEC-04] returns 429 at the real account boundary', async () => {
    const deps = dependencies();
    const handler = createGameNoteHandler({
      ...deps,
      limitNote: createNoteRateLimit({
        primary: new InMemoryRateLimiter(),
        fallback: new InMemoryRateLimiter(),
        incrementRateLimitHit: deps.metrics.incrementRateLimitHit,
        onStoreError: vi.fn(),
      }),
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(handler(request(), houseId, gameId)).resolves.toMatchObject({ status: 200 });
    }
    const response = await handler(request(), houseId, gameId);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBeTruthy();
    expect(deps.saveGameNote).toHaveBeenCalledTimes(10);
    expect(deps.metrics.incrementRateLimitHit).toHaveBeenCalledOnce();
  });

  it('[BM-032] rejects cross-House Members without recording a save', async () => {
    const deps = dependencies();
    deps.saveGameNote.mockRejectedValue(new HouseAuthorizationDeniedError('not_a_member', true));
    const response = await createGameNoteHandler(deps)(request(), houseId, gameId);
    expect(response.status).toBe(403);
    expect(deps.metrics.incrementNoteSave).not.toHaveBeenCalled();
  });
});
