import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  type HouseChatMessage,
  type RateLimitResult,
} from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { createChatRateLimit } from '../kernel/chat-rate-limit';
import { InMemoryRateLimiter } from '../kernel/rate-limit';
import {
  createDeleteHouseChatHandler,
  createPostHouseChatHandler,
  createReadHouseChatHandler,
} from './house-chat-handler';

const houseId = '01941f29-7c00-7000-8000-000000000601';
const nightId = '01941f29-7c00-7000-8000-000000000901';
const messageId = '01941f29-7c00-7000-8000-000000000801';
const viewer = {
  kind: 'authenticated' as const,
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};

function postRequest(body: unknown = { body: '<script>alert(1)</script>' }) {
  return new Request(`https://betweenmoves.test/api/houses/${houseId}/nights/${nightId}/chat`, {
    method: 'POST',
    headers: {
      origin: 'https://betweenmoves.test',
      'content-type': 'application/json',
      'x-request-id': 'bm-040-chat',
    },
    body: JSON.stringify(body),
  });
}

function dependencies() {
  return {
    expectedOrigin: 'https://betweenmoves.test',
    requireViewer: vi.fn(async () => viewer),
    limitChat: vi.fn(async (): Promise<RateLimitResult> => ({
      allowed: true,
      retryAfterSeconds: 0,
    })),
    postHouseChat: vi.fn(async (input: { readonly body: string }): Promise<HouseChatMessage> => ({
      id: messageId,
      membershipId: '01941f29-7c00-7000-8000-000000000201',
      authorDisplayName: 'Ada',
      body: input.body,
      sequence: 1n,
      createdAt: new Date('2026-09-18T14:00:00.000Z'),
    })),
    deleteHouseChat: vi.fn(async () => undefined),
    logger: { log: vi.fn() },
    metrics: {
      incrementChatSend: vi.fn(),
      incrementChatDelete: vi.fn(),
      incrementRateLimitHit: vi.fn(),
      snapshot: vi.fn(),
    },
    clock: { now: () => new Date('2026-09-18T14:00:00.000Z') },
  };
}

describe('House chat HTTP boundary', () => {
  it('[BM-040] stores raw plain text and observes metadata-only night.chat-posted', async () => {
    const deps = dependencies();
    const incoming = postRequest();
    const response = await createPostHouseChatHandler(deps)(incoming, houseId, nightId);

    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toMatchObject({
      id: messageId,
      body: '<script>alert(1)</script>',
      sequence: '1',
    });
    expect(deps.limitChat).toHaveBeenCalledWith(incoming, viewer.userId);
    expect(deps.postHouseChat).toHaveBeenCalledWith({
      houseId,
      nightId,
      body: '<script>alert(1)</script>',
      viewer,
    });
    expect(deps.metrics.incrementChatSend).toHaveBeenCalledOnce();
    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'night.chat-posted',
        actorId: viewer.userId,
        houseId,
        data: {
          night_id: nightId,
          message_id: messageId,
          actor_membership_id: '01941f29-7c00-7000-8000-000000000201',
        },
      }),
    );
    expect(JSON.stringify(deps.logger.log.mock.calls)).not.toContain('<script>');
    expect(JSON.stringify(deps.logger.log.mock.calls)).not.toContain('alert');
  });

  it('[BM-040] rejects empty and over-length chat before persistence', async () => {
    for (const body of ['', 'a'.repeat(2_001)]) {
      const deps = dependencies();
      const response = await createPostHouseChatHandler(deps)(
        postRequest({ body }),
        houseId,
        nightId,
      );
      expect(response.status).toBe(422);
      expect(deps.postHouseChat).not.toHaveBeenCalled();
    }
  });

  it('[BM-040] rate-limits chat without logging a body', async () => {
    const deps = dependencies();
    const handler = createPostHouseChatHandler({
      ...deps,
      limitChat: createChatRateLimit({
        primary: new InMemoryRateLimiter(),
        fallback: new InMemoryRateLimiter(),
        incrementRateLimitHit: deps.metrics.incrementRateLimitHit,
        onStoreError: vi.fn(),
      }),
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(
        (await handler(postRequest({ body: `msg ${String(attempt)}` }), houseId, nightId)).status,
      ).toBe(201);
    }
    const limited = await handler(postRequest({ body: 'too many' }), houseId, nightId);
    expect(limited.status).toBe(429);
    expect(JSON.stringify(deps.logger.log.mock.calls)).not.toContain('too many');
  });

  it('[BM-040] reads a durable snapshot without bodies in diagnostics', async () => {
    const lines: unknown[] = [];
    const response = await createReadHouseChatHandler({
      readHouseChat: vi.fn(async () => ({
        houseId,
        nightId,
        chatSequence: 1n,
        currentMembershipId: '01941f29-7c00-7000-8000-000000000201',
        canModerate: false,
        messages: [
          {
            id: messageId,
            membershipId: '01941f29-7c00-7000-8000-000000000201',
            authorDisplayName: 'Ada',
            body: 'secret chat body',
            sequence: 1n,
            createdAt: new Date('2026-09-18T14:00:00.000Z'),
          },
        ],
      })),
    })(
      new Request(`https://betweenmoves.test/api/houses/${houseId}/nights/${nightId}/chat`),
      houseId,
      nightId,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      chatSequence: '1',
      messages: [expect.objectContaining({ body: 'secret chat body' })],
    });
    expect(lines).toEqual([]);
  });

  it('[BM-040] soft-deletes as owner/steward without logging the body', async () => {
    const deps = dependencies();
    const request = new Request(
      `https://betweenmoves.test/api/houses/${houseId}/nights/${nightId}/chat/${messageId}`,
      {
        method: 'DELETE',
        headers: { origin: 'https://betweenmoves.test', 'x-request-id': 'bm-040-chat-delete' },
      },
    );
    const response = await createDeleteHouseChatHandler(deps)(request, houseId, nightId, messageId);
    expect(response.status).toBe(204);
    expect(deps.deleteHouseChat).toHaveBeenCalledWith({ houseId, nightId, messageId, viewer });
    expect(deps.metrics.incrementChatDelete).toHaveBeenCalledOnce();
    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'night.chat-deleted',
        data: { night_id: nightId, message_id: messageId },
      }),
    );
  });

  it('[BM-040] forbids a member from moderating chat', async () => {
    const deps = dependencies();
    deps.deleteHouseChat.mockRejectedValue(
      new HouseAuthorizationDeniedError('role_not_permitted', false),
    );
    const request = new Request(
      `https://betweenmoves.test/api/houses/${houseId}/nights/${nightId}/chat/${messageId}`,
      {
        method: 'DELETE',
        headers: { origin: 'https://betweenmoves.test' },
      },
    );
    const response = await createDeleteHouseChatHandler(deps)(request, houseId, nightId, messageId);
    expect(response.status).toBe(403);
  });

  it('[BM-040] rejects bad origins, invalid routes, and unauthenticated commands', async () => {
    const deps = dependencies();
    const post = createPostHouseChatHandler(deps);
    const wrongOrigin = new Request('https://betweenmoves.test/chat', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'blocked' }),
    });
    expect((await post(wrongOrigin, houseId, nightId)).status).toBe(403);
    expect((await post(postRequest(), 'not-a-house-id', nightId)).status).toBe(422);

    deps.requireViewer.mockRejectedValueOnce(new AuthenticationRequiredError());
    expect((await post(postRequest(), houseId, nightId)).status).toBe(401);

    const deleteRequest = new Request(
      `https://betweenmoves.test/api/houses/${houseId}/nights/${nightId}/chat/${messageId}`,
      { method: 'DELETE', headers: { origin: 'https://evil.example' } },
    );
    expect(
      (await createDeleteHouseChatHandler(deps)(deleteRequest, houseId, nightId, messageId)).status,
    ).toBe(403);
  });

  it('[BM-040] rejects oversized and malformed payloads before persistence', async () => {
    const deps = dependencies();
    const post = createPostHouseChatHandler(deps);
    const oversized = new Request('https://betweenmoves.test/chat', {
      method: 'POST',
      headers: {
        origin: 'https://betweenmoves.test',
        'content-type': 'application/json',
        'content-length': '20000',
      },
      body: '{}',
    });
    expect((await post(oversized, houseId, nightId)).status).toBe(413);

    const malformed = new Request('https://betweenmoves.test/chat', {
      method: 'POST',
      headers: { origin: 'https://betweenmoves.test', 'content-type': 'application/json' },
      body: '{not json',
    });
    expect((await post(malformed, houseId, nightId)).status).toBe(422);
    expect(deps.postHouseChat).not.toHaveBeenCalled();
  });

  it('[BM-040] maps authorization and domain failures from the post boundary', async () => {
    const cases = [
      [new HouseAuthorizationDeniedError('not_a_member', true), 403],
      [new DomainError('not_found', 'unavailable'), 404],
      [new DomainError('validation_failed', 'invalid body'), 422],
    ] as const;
    for (const [error, status] of cases) {
      const deps = dependencies();
      deps.postHouseChat.mockRejectedValueOnce(error);
      expect((await createPostHouseChatHandler(deps)(postRequest(), houseId, nightId)).status).toBe(
        status,
      );
    }
  });

  it('[BM-040] preserves a committed post when metrics or diagnostics are unavailable', async () => {
    const deps = dependencies();
    deps.metrics.incrementChatSend.mockImplementation(() => {
      throw new Error('metrics unavailable');
    });
    deps.logger.log.mockImplementation(() => {
      throw new Error('logger unavailable');
    });
    expect((await createPostHouseChatHandler(deps)(postRequest(), houseId, nightId)).status).toBe(
      201,
    );
  });

  it('[BM-040] maps missing reads and validates the read route', async () => {
    const read = createReadHouseChatHandler({ readHouseChat: vi.fn(async () => null) });
    expect(
      (await read(new Request('https://betweenmoves.test/chat'), 'bad-house', nightId)).status,
    ).toBe(422);
    expect(
      (await read(new Request('https://betweenmoves.test/chat'), houseId, nightId)).status,
    ).toBe(404);
  });

  it('[BM-040] maps delete authentication and not-found failures', async () => {
    const unauthenticated = dependencies();
    unauthenticated.requireViewer.mockRejectedValueOnce(new AuthenticationRequiredError());
    const request = new Request('https://betweenmoves.test/chat', {
      method: 'DELETE',
      headers: { origin: 'https://betweenmoves.test' },
    });
    expect(
      (await createDeleteHouseChatHandler(unauthenticated)(request, houseId, nightId, messageId))
        .status,
    ).toBe(401);

    const missing = dependencies();
    missing.deleteHouseChat.mockRejectedValueOnce(new DomainError('not_found', 'missing'));
    expect(
      (await createDeleteHouseChatHandler(missing)(request, houseId, nightId, messageId)).status,
    ).toBe(404);
  });

  it('[BM-040] preserves a committed delete when metrics or diagnostics are unavailable', async () => {
    const deps = dependencies();
    deps.metrics.incrementChatDelete.mockImplementation(() => {
      throw new Error('metrics unavailable');
    });
    deps.logger.log.mockImplementation(() => {
      throw new Error('logger unavailable');
    });
    const request = new Request('https://betweenmoves.test/chat', {
      method: 'DELETE',
      headers: { origin: 'https://betweenmoves.test' },
    });
    expect(
      (await createDeleteHouseChatHandler(deps)(request, houseId, nightId, messageId)).status,
    ).toBe(204);
  });
});
