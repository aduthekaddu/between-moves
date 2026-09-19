import { HouseAuthorizationDeniedError, type HouseChatSnapshot } from '@between-moves/domain';
import { createStructuredLogger } from '@between-moves/observability';
import { describe, expect, it, vi } from 'vitest';
import { createHouseChatReader } from './chat';

const houseId = '01941f29-7c00-7000-8000-000000000601';
const nightId = '01941f29-7c00-7000-8000-000000000901';
const viewer = {
  kind: 'authenticated' as const,
  userId: '01941f29-7c00-7000-8000-000000000611',
  displayName: 'Ada',
  imageUrl: null,
};
const snapshot: HouseChatSnapshot = {
  houseId,
  nightId,
  chatSequence: 1n,
  currentMembershipId: '01941f29-7c00-7000-8000-000000000621',
  canModerate: true,
  messages: [
    {
      id: '01941f29-7c00-7000-8000-000000000801',
      membershipId: '01941f29-7c00-7000-8000-000000000623',
      authorDisplayName: 'Bea',
      body: 'private House chat text',
      sequence: 1n,
      createdAt: new Date('2026-09-18T14:00:00.000Z'),
    },
  ],
};

describe('House chat request seam', () => {
  it('[BM-040] logs a body-free chat view and reconnect repair', async () => {
    const lines: string[] = [];
    const reader = createHouseChatReader({
      getViewer: vi.fn(async () => viewer),
      readHouseChat: vi.fn(async () => snapshot),
      logger: createStructuredLogger({
        clock: { now: () => new Date('2026-09-18T14:05:00.000Z') },
        sink: (line) => lines.push(line),
      }),
      clock: { now: () => new Date('2026-09-18T14:05:00.000Z') },
    });

    await expect(
      reader(
        new Request(`https://betweenmoves.test/h/${houseId}/nights/${nightId}`),
        houseId,
        nightId,
      ),
    ).resolves.toEqual(snapshot);
    await expect(
      reader(
        new Request(
          `https://betweenmoves.test/api/houses/${houseId}/nights/${nightId}/chat?repair=1`,
        ),
        houseId,
        nightId,
      ),
    ).resolves.toEqual(snapshot);
    expect(lines.join('\n')).toContain('night.chat-viewed');
    expect(lines.join('\n')).toContain('night.chat-repaired');
    expect(lines.join('\n')).not.toContain('private House chat text');
  });

  it('[BM-040] [DR-SEC-01] hides chat after a cross-House denial', async () => {
    const reader = createHouseChatReader({
      getViewer: vi.fn(async () => viewer),
      readHouseChat: vi.fn(async () => {
        throw new HouseAuthorizationDeniedError('not_a_member', true);
      }),
      logger: { log: vi.fn() },
      clock: { now: () => new Date('2026-09-18T14:05:00.000Z') },
    });
    await expect(
      reader(
        new Request(`https://betweenmoves.test/h/${houseId}/nights/${nightId}`),
        houseId,
        nightId,
      ),
    ).resolves.toBeNull();
  });
});
