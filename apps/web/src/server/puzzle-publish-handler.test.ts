import { AuthenticationRequiredError, HouseAuthorizationDeniedError } from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { createPuzzlePublishHandler } from './puzzle-publish-handler';

const houseId = '01941f29-7c00-7000-8000-000000000601';
const candidateId = '01941f29-7c00-7000-8000-000000004601';
const puzzleId = '01941f29-7c00-7000-8000-000000004602';
const origin = 'https://betweenmoves.example';
const viewer = {
  kind: 'authenticated' as const,
  userId: '01941f29-7c00-7000-8000-000000000611',
  displayName: 'Ada',
  imageUrl: null,
};

function request(body: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/houses/${houseId}/puzzles`, {
    method: 'POST',
    headers: { origin: requestOrigin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function setup() {
  const publish = vi.fn(async () => ({
    id: puzzleId,
    prompt: 'Find the best move',
    positionFen: '8/8/8/8/8/8/8/8 w - - 0 1',
    contributorName: 'Ada',
    publishedAt: new Date('2026-09-26T10:00:00Z'),
  }));
  const recordPublished = vi.fn();
  const requireViewer = vi.fn(async () => viewer);
  return {
    publish,
    recordPublished,
    requireViewer,
    handle: createPuzzlePublishHandler({
      expectedOrigin: origin,
      publish,
      recordPublished,
      requireViewer,
    }),
  };
}

describe('BM-046 puzzle publication boundary', () => {
  it('requires explicit position confirmation and a bounded prompt', async () => {
    const { handle, publish } = setup();
    for (const body of [
      { candidateId, prompt: 'Find the best move', positionConfirmed: false },
      { candidateId, prompt: ' ', positionConfirmed: true },
      { candidateId, prompt: 'x'.repeat(281), positionConfirmed: true },
    ])
      expect((await handle(request(body), houseId)).status).toBe(422);
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes a confirmed position and records one metric', async () => {
    const { handle, publish, recordPublished } = setup();
    const response = await handle(
      request({ candidateId, prompt: ' Find the best move ', positionConfirmed: true }),
      houseId,
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: puzzleId, prompt: 'Find the best move' });
    expect(publish).toHaveBeenCalledWith(expect.any(Request), houseId, {
      candidateId,
      prompt: 'Find the best move',
      positionConfirmed: true,
    });
    expect(recordPublished).toHaveBeenCalledTimes(1);
  });

  it('rejects foreign origins, anonymous viewers and non-members', async () => {
    const valid = { candidateId, prompt: 'Find the move', positionConfirmed: true };
    const first = setup();
    expect((await first.handle(request(valid, 'https://elsewhere.example'), houseId)).status).toBe(
      403,
    );
    expect(first.publish).not.toHaveBeenCalled();
    const anonymous = setup();
    anonymous.requireViewer.mockRejectedValue(new AuthenticationRequiredError());
    expect((await anonymous.handle(request(valid), houseId)).status).toBe(401);
    const outsider = setup();
    outsider.publish.mockRejectedValue(new HouseAuthorizationDeniedError('not_a_member', true));
    expect((await outsider.handle(request(valid), houseId)).status).toBe(403);
    expect(outsider.recordPublished).not.toHaveBeenCalled();
  });
});
