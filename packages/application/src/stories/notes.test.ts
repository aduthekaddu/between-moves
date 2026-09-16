import type { AuthenticatedViewer } from '@between-moves/domain';
import { HouseAuthorizationDeniedError } from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { readGameNotes, saveGameNote } from './notes';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const gameId = '01941f29-7c00-7000-8000-000000000202';
const noteId = '01941f29-7c00-7000-8000-000000000203';
const savedAt = new Date('2026-09-16T08:00:00.000Z');
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};
const context = fakeAuthorizationContext({ houseId, viewerId: viewer.userId });
const note = {
  membershipId: '01941f29-7c00-7000-8000-000000000204',
  authorDisplayName: 'Ada',
  body: '<b>A surprising finish</b>',
  createdAt: savedAt,
  editedAt: null,
};

describe('Game notes', () => {
  it('[BM-032] [DR-NOTE-01] authorizes and upserts one Member note', async () => {
    const authorizeHouseAction = vi.fn(async () => context);
    const notes = { save: vi.fn(async () => note), readForGame: vi.fn() };

    await expect(
      saveGameNote(
        { houseId, gameId, body: note.body, viewer },
        {
          authorizeHouseAction,
          notes,
          clock: { now: () => savedAt },
          ids: { generate: () => noteId },
        },
      ),
    ).resolves.toEqual(note);
    expect(authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'write_house_chat_or_game_note' },
      houseId,
      viewer,
    );
    expect(notes.save).toHaveBeenCalledWith(context, {
      id: noteId,
      gameId,
      body: note.body,
      savedAt,
    });
  });

  it('[BM-032] [DR-SEC-01] never writes after a cross-House denial', async () => {
    const save = vi.fn();
    await expect(
      saveGameNote(
        { houseId, gameId, body: 'No leak', viewer },
        {
          authorizeHouseAction: vi.fn(async () => {
            throw new HouseAuthorizationDeniedError('not_a_member', true);
          }),
          notes: { save, readForGame: vi.fn() },
          clock: { now: () => savedAt },
          ids: { generate: () => noteId },
        },
      ),
    ).rejects.toMatchObject({ reason: 'not_a_member', crossHouse: true });
    expect(save).not.toHaveBeenCalled();
  });

  it('[BM-032] rejects over-length notes before persistence', async () => {
    const save = vi.fn();
    await expect(
      saveGameNote(
        { houseId, gameId, body: 'a'.repeat(2_001), viewer },
        {
          authorizeHouseAction: vi.fn(async () => context),
          notes: { save, readForGame: vi.fn() },
          clock: { now: () => savedAt },
          ids: { generate: () => noteId },
        },
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(save).not.toHaveBeenCalled();
  });

  it('[BM-032] rejects an empty note before persistence', async () => {
    const save = vi.fn();
    await expect(
      saveGameNote(
        { houseId, gameId, body: '', viewer },
        {
          authorizeHouseAction: vi.fn(async () => context),
          notes: { save, readForGame: vi.fn() },
          clock: { now: () => savedAt },
          ids: { generate: () => noteId },
        },
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(save).not.toHaveBeenCalled();
  });

  it('[BM-032] counts Unicode code points consistently with PostgreSQL char_length', async () => {
    const save = vi.fn(async () => note);
    await expect(
      saveGameNote(
        { houseId, gameId, body: '😀'.repeat(2_000), viewer },
        {
          authorizeHouseAction: vi.fn(async () => context),
          notes: { save, readForGame: vi.fn() },
          clock: { now: () => savedAt },
          ids: { generate: () => noteId },
        },
      ),
    ).resolves.toEqual(note);
    expect(save).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ body: '😀'.repeat(2_000) }),
    );
  });

  it('[BM-032] reads completed-Game notes behind House authorization', async () => {
    const authorizeHouseAction = vi.fn(async () => context);
    const view = { currentMembershipId: note.membershipId, notes: [note] };
    const readForGame = vi.fn(async () => view);

    await expect(
      readGameNotes(
        { houseId, gameId, viewer },
        { authorizeHouseAction, notes: { save: vi.fn(), readForGame } },
      ),
    ).resolves.toEqual(view);
    expect(authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'view_house_content' },
      houseId,
      viewer,
    );
    expect(readForGame).toHaveBeenCalledWith(context, gameId);
  });
});
