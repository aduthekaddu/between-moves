// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { GameActions } from './game-actions';
import type { MoveEntryPosition } from './move-entry-wire';

const ada = '01941f29-7c00-7000-8000-000000000301';
const bea = '01941f29-7c00-7000-8000-000000000302';
const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const position: MoveEntryPosition = {
  mode: 'correspondence',
  currentFen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
  currentPly: 1,
  sideToMove: 'black',
  version: 1,
  state: 'active',
  viewerColor: 'white',
  white: { name: 'Ada', membershipId: ada },
  black: { name: 'Bea', membershipId: bea },
  moveDueAt: null,
  result: null,
  inCheck: false,
  moves: [{ ply: 1, uci: 'e2e4', san: 'e4' }],
  pendingDrawOffer: null,
};

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let onSettled: Mock<() => Promise<unknown>>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ state: 'active', pendingDrawOffer: null }), { status: 200 }),
    );
  vi.stubGlobal('fetch', fetchMock);
  onSettled = vi.fn<() => Promise<unknown>>(async () => null);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount(value: MoveEntryPosition, disabled = false) {
  await act(async () =>
    root.render(
      <GameActions
        houseId="house"
        gameId="game"
        position={value}
        disabled={disabled}
        onSettled={onSettled}
      />,
    ),
  );
}

function button(name: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === name,
  );
  expect(found, name).toBeDefined();
  return found!;
}

function sentBody(): Record<string, unknown> {
  const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe('Game draw and resignation controls', () => {
  it('[BM-028] shows nothing to spectators or once the Game is over', async () => {
    await mount({ ...position, viewerColor: null });
    expect(container.innerHTML).toBe('');
    await mount({ ...position, state: 'completed', result: 'white_win' });
    expect(container.innerHTML).toBe('');
  });

  it('[BM-028] [DR-DRAW-02] offers a draw only while the opponent is to move', async () => {
    await mount({ ...position, sideToMove: 'white' });
    expect(button('Offer a draw').disabled).toBe(true);
    expect(container.textContent).toContain('You can offer a draw after your Move');

    await mount(position);
    await act(async () => button('Offer a draw').click());

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/houses/house/games/game/draw',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(sentBody()).toMatchObject({ action: 'offer' });
    expect(sentBody().clientCommandId).toMatch(uuidV7);
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('[BM-028] tells the offerer their offer stands until the opponent moves', async () => {
    await mount({ ...position, pendingDrawOffer: { offeringMembershipId: ada, ply: 1 } });

    expect(container.textContent).toContain(
      'You offered a draw. It stands until Bea answers or moves.',
    );
    expect(container.textContent).not.toContain('Offer a draw');
    expect(container.textContent).not.toContain('Accept the draw');
  });

  it('[BM-028] lets the opponent accept a pending offer', async () => {
    await mount({
      ...position,
      viewerColor: 'black',
      pendingDrawOffer: { offeringMembershipId: ada, ply: 1 },
    });

    expect(container.textContent).toContain('Ada offers a draw.');
    await act(async () => button('Accept the draw').click());
    expect(sentBody()).toMatchObject({ action: 'accept' });
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('[BM-028] [DR-DRAW-02] lets the opponent decline a pending offer', async () => {
    await mount({
      ...position,
      viewerColor: 'black',
      pendingDrawOffer: { offeringMembershipId: ada, ply: 1 },
    });

    await act(async () => button('Decline').click());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/houses/house/games/game/draw',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(sentBody()).toMatchObject({ action: 'decline' });
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('[BM-028] tells the offerer their offer was declined and waits for their next Move', async () => {
    await mount({ ...position, drawOfferDeclined: true });

    expect(container.textContent).toContain(
      'Bea declined your draw offer. You can offer again after your next Move.',
    );
    expect(container.textContent).not.toContain('Offer a draw');

    await mount({ ...position, viewerColor: 'black', drawOfferDeclined: true });
    expect(container.textContent).toContain('You declined the draw. Play on.');
  });

  it('[BM-028] explains a House rule conflict instead of a generic refresh', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 'game_conflict',
          detail: 'Your draw offer was declined. You can offer again after your next Move.',
        }),
        { status: 409 },
      ),
    );
    await mount(position);
    await act(async () => button('Offer a draw').click());

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Your draw offer was declined. You can offer again after your next Move.',
    );
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('[BM-028] resigns only after an explicit second step', async () => {
    await mount(position);
    await act(async () => button('Resign').click());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Resign this Game? Bea wins');

    await act(async () => button('Keep playing').click());
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => button('Resign').click());
    await act(async () => button('Resign').click());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/houses/house/games/game/resign',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(Object.keys(sentBody())).toEqual(['clientCommandId']);
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('[BM-028] keeps the same command id when a request never reached the server', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await mount(position);
    await act(async () => button('Offer a draw').click());
    const first = sentBody().clientCommandId;
    expect(container.textContent).toContain('Could not connect');
    expect(onSettled).not.toHaveBeenCalled();

    await act(async () => button('Offer a draw').click());
    expect(sentBody().clientCommandId).toBe(first);
  });

  it('[BM-028] shows the server reason when a draw offer is refused', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ detail: 'A draw may be offered only on the opponent’s turn.' }),
        { status: 403 },
      ),
    );
    await mount(position);
    await act(async () => button('Offer a draw').click());

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'A draw may be offered only on the opponent’s turn.',
    );
    expect(onSettled).not.toHaveBeenCalled();
  });
});
