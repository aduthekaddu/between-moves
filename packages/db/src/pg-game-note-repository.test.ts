import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PgGameNoteRepository } from './pg-game-note-repository';

const context = fakeAuthorizationContext({
  houseId: '01941f29-7c00-7000-8000-000000000601',
  viewerId: '01941f29-7c00-7000-8000-000000000101',
});
const gameId = '01941f29-7c00-7000-8000-000000000701';
const membershipId = '01941f29-7c00-7000-8000-000000000201';

interface TestNoteRow {
  readonly current_membership_id?: unknown;
  readonly membership_id: unknown;
  readonly author_display_name: unknown;
  readonly body: unknown;
  readonly created_at: unknown;
  readonly edited_at: unknown;
}

function database(rows: readonly TestNoteRow[]) {
  const query = vi.fn().mockResolvedValue({ rows: [...rows], rowCount: rows.length });
  return { pool: { query } as unknown as Pool, query };
}

function row(overrides: Partial<TestNoteRow> = {}): TestNoteRow {
  return {
    current_membership_id: membershipId,
    membership_id: membershipId,
    author_display_name: 'Ada',
    body: 'A sharp finish',
    created_at: new Date('2026-09-16T08:00:00.000Z'),
    edited_at: null,
    ...overrides,
  };
}

// The database schema cannot return these rows, so only a stub pool can reach the parse guards.
describe('PostgreSQL Game-note row guards', () => {
  it('[BM-032] rejects malformed rows and timestamps instead of exposing invalid notes', async () => {
    const malformed = database([row({ membership_id: null })]);
    await expect(
      new PgGameNoteRepository(malformed.pool).save(context, {
        id: '01941f29-7c00-7000-8000-000000000704',
        gameId,
        body: 'Malformed',
        savedAt: new Date('2026-09-16T08:00:00.000Z'),
      }),
    ).rejects.toThrow('Invalid Game note row');

    const invalidDate = database([row({ created_at: 'not-a-date' })]);
    await expect(
      new PgGameNoteRepository(invalidDate.pool).save(context, {
        id: '01941f29-7c00-7000-8000-000000000705',
        gameId,
        body: 'Invalid timestamp',
        savedAt: new Date('2026-09-16T08:00:00.000Z'),
      }),
    ).rejects.toThrow('Invalid Game note created timestamp');

    const invalidMembership = database([row({ current_membership_id: 42 })]);
    await expect(
      new PgGameNoteRepository(invalidMembership.pool).readForGame(context, gameId),
    ).rejects.toThrow('Invalid current Game note membership');
  });
});
