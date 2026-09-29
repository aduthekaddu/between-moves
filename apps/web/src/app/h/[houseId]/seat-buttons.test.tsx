// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AcceptSeatButton } from './accept-seat-button';
import { CancelSeatButton } from './cancel-seat-button';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  push.mockReset();
  refresh.mockReset();
  fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
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

async function click() {
  const button = container.querySelector('button');
  if (button === null) throw new Error('Missing seat button');
  await act(async () => button.click());
}

async function mountAccept(mode: 'correspondence' | 'live' = 'correspondence') {
  await act(async () =>
    root.render(<AcceptSeatButton houseId="house" gameId="game" mode={mode} label="Accept" />),
  );
}

async function mountCancel() {
  await act(async () =>
    root.render(
      <CancelSeatButton
        houseId="house"
        gameId="game"
        label="Cancel seat"
        pendingLabel="Cancelling…"
      />,
    ),
  );
}

describe('Game seat actions', () => {
  it('[BM-023] accepts a correspondence seat and opens the board', async () => {
    await mountAccept();
    await click();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/houses/house/games/game/accept');
    expect(push).toHaveBeenCalledWith('/h/house/games/game');
  });

  it('[BM-023] accepts a live challenge and opens its live board', async () => {
    await mountAccept('live');
    await click();
    expect(push).toHaveBeenCalledWith('/h/house/games/game/live');
  });

  it('[BM-023] refreshes a contested seat so the stale offer disappears', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 409 }));
    await mountAccept();
    await click();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Someone took this seat first.',
    );
    expect(refresh).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLButtonElement>('button')?.disabled).toBe(false);
  });

  it('[BM-022] cancels a seat and refreshes the House page', async () => {
    await mountCancel();
    await click();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/houses/house/games/game/cancel');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('[BM-022] explains when a seat has already closed', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await mountCancel();
    await click();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'This seat has already closed.',
    );
    expect(refresh).toHaveBeenCalledOnce();
    expect(container.querySelector<HTMLButtonElement>('button')?.disabled).toBe(false);
  });
});
