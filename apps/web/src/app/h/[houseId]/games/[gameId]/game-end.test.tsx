// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameEnd } from './game-end';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ gameId: 'g2' }), { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const opponent = { name: 'Bea', membershipId: '01941f29-7c00-7000-8000-000000000623' };

function button(text: string) {
  return [...container.querySelectorAll('button')].find((node) => node.textContent === text);
}

describe('after a finished Game', () => {
  it('challenges the same opponent again with the colours swapped', async () => {
    await act(async () =>
      root.render(
        <GameEnd
          houseId="house"
          viewerColor="white"
          opponent={opponent}
          perMoveHours={24}
          incomingRematch={null}
        />,
      ),
    );
    await act(async () => button('Rematch Bea')?.click());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/houses/house/games');
    expect(JSON.parse(String(init.body))).toEqual({
      mode: 'correspondence',
      clockPolicy: { kind: 'correspondence', perMoveHours: 24 },
      offeredColor: 'white',
      intendedMembershipId: opponent.membershipId,
    });
    expect(container.textContent).toContain('Rematch sent. Bea will see it on the House page.');
  });

  it('offers the rematch the opponent already sent instead of a second one', async () => {
    await act(async () =>
      root.render(
        <GameEnd
          houseId="house"
          viewerColor="black"
          opponent={opponent}
          perMoveHours={24}
          incomingRematch={{ gameId: 'waiting-game' }}
        />,
      ),
    );
    expect(button('Accept Bea’s rematch')).toBeDefined();
    expect(button('Rematch Bea')).toBeUndefined();
  });

  it('copies a short result for the group chat when the browser cannot share', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await act(async () =>
      root.render(
        <GameEnd
          houseId="house"
          viewerColor="white"
          opponent={opponent}
          perMoveHours={24}
          incomingRematch={null}
          share={{
            headline: 'Ada won by checkmate',
            moves: [
              { ply: 1, uci: 'e2e4', san: 'e4' },
              { ply: 2, uci: 'f7f6', san: 'f6' },
            ],
          }}
        />,
      ),
    );
    await act(async () => button('Share result')?.click());
    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/^Ada won by checkmate in 1 move\.\n1\. e4 f6\nBetween Moves · http/),
    );
    expect(button('Copied')).toBeDefined();
  });

  it('has no rematch when no Season is open', async () => {
    await act(async () =>
      root.render(
        <GameEnd
          houseId="house"
          viewerColor="white"
          opponent={opponent}
          perMoveHours={null}
          incomingRematch={null}
        />,
      ),
    );
    expect(button('Rematch Bea')).toBeUndefined();
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/h/house');
  });
});
