import type { AuthenticatedViewer } from '@between-moves/domain';
import { HouseAuthorizationDeniedError } from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { deleteHouseChat, postHouseChat, readHouseChat } from './chat';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const nightId = '01941f29-7c00-7000-8000-000000000901';
const messageId = '01941f29-7c00-7000-8000-000000000801';
const eventId = '01941f29-7c00-7000-8000-000000000802';
const postedAt = new Date('2026-09-18T14:00:00.000Z');
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};
const context = fakeAuthorizationContext({ houseId, viewerId: viewer.userId });
const message = {
  id: messageId,
  membershipId: '01941f29-7c00-7000-8000-000000000204',
  authorDisplayName: 'Ada',
  body: '<b>Hello from the rail</b>',
  sequence: 1n,
  createdAt: postedAt,
};

describe('House chat', () => {
  it('[BM-040] authorizes and posts a durable message before publication', async () => {
    const authorizeHouseAction = vi.fn(async () => context);
    const chat = {
      post: vi.fn(async () => message),
      readRecent: vi.fn(),
      softDelete: vi.fn(),
    };
    let generated = 0;

    await expect(
      postHouseChat(
        { houseId, nightId, body: message.body, viewer },
        {
          authorizeHouseAction,
          chat,
          clock: { now: () => postedAt },
          ids: {
            generate: () => {
              generated += 1;
              return generated === 1 ? messageId : eventId;
            },
          },
        },
      ),
    ).resolves.toEqual(message);
    expect(authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'write_house_chat_or_game_note' },
      houseId,
      viewer,
    );
    expect(chat.post).toHaveBeenCalledWith(context, {
      id: messageId,
      eventId,
      nightId,
      body: message.body,
      postedAt,
    });
  });

  it('[BM-040] [DR-SEC-01] never writes after a cross-House denial', async () => {
    const post = vi.fn();
    await expect(
      postHouseChat(
        { houseId, nightId, body: 'No leak', viewer },
        {
          authorizeHouseAction: vi.fn(async () => {
            throw new HouseAuthorizationDeniedError('not_a_member', true);
          }),
          chat: { post, readRecent: vi.fn(), softDelete: vi.fn() },
          clock: { now: () => postedAt },
          ids: { generate: () => messageId },
        },
      ),
    ).rejects.toMatchObject({ reason: 'not_a_member', crossHouse: true });
    expect(post).not.toHaveBeenCalled();
  });

  it('[BM-040] rejects over-length chat before persistence', async () => {
    const post = vi.fn();
    await expect(
      postHouseChat(
        { houseId, nightId, body: 'a'.repeat(2_001), viewer },
        {
          authorizeHouseAction: vi.fn(async () => context),
          chat: { post, readRecent: vi.fn(), softDelete: vi.fn() },
          clock: { now: () => postedAt },
          ids: { generate: () => messageId },
        },
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(post).not.toHaveBeenCalled();
  });

  it('[BM-040] reads recent durable messages behind House authorization', async () => {
    const authorizeHouseAction = vi.fn(async () => context);
    const view = {
      houseId,
      nightId,
      chatSequence: 1n,
      currentMembershipId: message.membershipId,
      canModerate: false,
      messages: [message],
    };
    const readRecent = vi.fn(async () => view);

    await expect(
      readHouseChat(
        { houseId, nightId, viewer },
        {
          authorizeHouseAction,
          chat: { post: vi.fn(), readRecent, softDelete: vi.fn() },
        },
      ),
    ).resolves.toEqual(view);
    expect(authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'view_house_content' },
      houseId,
      viewer,
    );
    expect(readRecent).toHaveBeenCalledWith(context, nightId);
  });

  it('[BM-040] authorizes owner/steward moderation before a soft-delete', async () => {
    const authorizeHouseAction = vi.fn(async () => context);
    const softDelete = vi.fn(async () => undefined);

    await expect(
      deleteHouseChat(
        { houseId, nightId, messageId, viewer },
        {
          authorizeHouseAction,
          chat: { post: vi.fn(), readRecent: vi.fn(), softDelete },
          clock: { now: () => postedAt },
          ids: { generate: () => eventId },
        },
      ),
    ).resolves.toBeUndefined();
    expect(authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'moderate_house_chat' },
      houseId,
      viewer,
    );
    expect(softDelete).toHaveBeenCalledWith(context, {
      eventId,
      nightId,
      messageId,
      deletedAt: postedAt,
    });
  });

  it('[BM-040] never deletes after a member moderation denial', async () => {
    const softDelete = vi.fn();
    await expect(
      deleteHouseChat(
        { houseId, nightId, messageId, viewer },
        {
          authorizeHouseAction: vi.fn(async () => {
            throw new HouseAuthorizationDeniedError('role_not_permitted', false);
          }),
          chat: { post: vi.fn(), readRecent: vi.fn(), softDelete },
          clock: { now: () => postedAt },
          ids: { generate: () => eventId },
        },
      ),
    ).rejects.toMatchObject({ reason: 'role_not_permitted' });
    expect(softDelete).not.toHaveBeenCalled();
  });
});
