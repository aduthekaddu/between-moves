// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MoveEntry } from './move-entry';
import type { MoveEntryPosition } from './move-entry-wire';

const initial: MoveEntryPosition = {
  mode: 'live',
  currentFen: '8/8/8/8/8/8/4P3/8 w - - 0 1',
  currentPly: 0,
  sideToMove: 'white',
  version: 0,
  state: 'active',
  viewerColor: 'white',
  white: { name: 'Ada' },
  black: { name: 'Bea' },
  moveDueAt: null,
  result: null,
  inCheck: false,
  moves: [],
  serverNow: '2026-09-24T12:00:00.000Z',
  liveClock: { whiteMs: 60_000, blackMs: 120_000, turnStartedAt: '2026-09-24T12:00:00.000Z' },
};
const afterMove: MoveEntryPosition = {
  ...initial,
  currentFen: '8/8/8/8/4P3/8/8/8 b - - 0 1',
  currentPly: 1,
  sideToMove: 'black',
  version: 1,
  moves: [{ ply: 1, uci: 'e2e4', san: 'e4' }],
  serverNow: '2026-09-24T12:00:02.000Z',
  liveClock: { whiteMs: 59_000, blackMs: 120_000, turnStartedAt: '2026-09-24T12:00:02.000Z' },
};

let container: HTMLDivElement;
let root: Root;
let matches: boolean;
let changeViewport: (() => void) | undefined;
let fetchMock: ReturnType<typeof vi.fn>;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  close = vi.fn();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  FakeEventSource.instances = [];
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  matches = true;
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return matches;
    },
    addEventListener: (_event: string, listener: () => void) => {
      changeViewport = listener;
    },
    removeEventListener: () => {
      changeViewport = undefined;
    },
  }));
  fetchMock = vi.fn().mockResolvedValue(json(initial));
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mount(position = initial) {
  await act(async () =>
    root.render(<MoveEntry houseId="house" gameId="game" initial={position} />),
  );
}

async function click(selector: string) {
  const element = container.querySelector<HTMLElement>(selector);
  expect(element, selector).not.toBeNull();
  await act(async () => element!.click());
}

async function proposeMove() {
  await click('[data-square="e2"]');
  await click('[data-square="e4"]');
}

describe('live move entry', () => {
  it('[BM-043] subscribes a spectator and reconciles only scoped Game events', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const token = {
      token: 'scoped-spectator-token',
      channel: 'opaque-game-channel',
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    };
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        json(url.endsWith('/realtime-token') ? token : { ...initial, viewerColor: null }),
      ),
    );
    await mount({ ...initial, viewerColor: null });

    const source = FakeEventSource.instances[0];
    expect(source?.url).toContain('/games/game/live?token=scoped-spectator-token');
    expect(container.textContent).toContain("Only seated players can move. You're spectating.");
    expect(container.querySelector('.move-entry__submit')).toBeNull();
    expect(container.querySelectorAll('[role="gridcell"][aria-disabled="true"]')).toHaveLength(64);

    const readsOnAttach = fetchMock.mock.calls.length;
    await act(async () => source?.onopen?.());
    expect(fetchMock.mock.calls.length).toBeGreaterThan(readsOnAttach);

    const event = (channel: string, houseId = 'house', gameId = 'game') =>
      new MessageEvent<string>('message', {
        data: JSON.stringify({
          channel,
          name: 'game.move-accepted',
          data: { houseId, aggregateId: gameId },
        }),
      });
    const readsBefore = fetchMock.mock.calls.length;
    await act(async () => source?.onmessage?.(event('wrong-channel')));
    await act(async () => source?.onmessage?.(event(token.channel, 'other-house')));
    await act(async () => source?.onmessage?.(new MessageEvent('message', { data: '{' })));
    expect(fetchMock).toHaveBeenCalledTimes(readsBefore);

    fetchMock.mockResolvedValue(json({ ...afterMove, viewerColor: null }));
    await act(async () => source?.onmessage?.(event(token.channel)));
    expect(container.querySelector('[data-square="e4"]')?.getAttribute('aria-label')).toBe(
      'e4, white pawn',
    );
    expect(container.textContent).toContain('Move list (1)');
    expect(container.querySelector('.move-entry__submit')).toBeNull();

    await act(async () => root.render(<></>));
    expect(source?.close).toHaveBeenCalledOnce();
  });

  it('reconciles an opponent move and clears an outdated selection', async () => {
    await mount();
    await click('[data-square="e2"]');
    fetchMock.mockResolvedValue(json(afterMove));
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(container.querySelector('[data-testid="turn-status"]')?.textContent).toBe(
      'Black to move',
    );
    expect(container.querySelector('[data-square="e4"]')?.getAttribute('aria-label')).toBe(
      'e4, white pawn',
    );
    expect(container.querySelectorAll('[aria-selected="true"]')).toHaveLength(0);
    expect(container.textContent).toContain('Move list (1)');
  });

  it('keeps entry disabled after a failed or malformed refresh until recovery', async () => {
    await mount();
    fetchMock.mockResolvedValueOnce(json({}, 503));
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(container.textContent).toContain('Could not sync the Game. Refresh before moving.');
    expect(container.querySelector('[data-square="e2"]')?.getAttribute('aria-disabled')).toBe(
      'true',
    );
    fetchMock.mockResolvedValue(
      json({ ...initial, liveClock: { ...initial.liveClock, whiteMs: -1 } }),
    );
    await click('.move-entry__banner button');
    expect(container.textContent).toContain('Could not sync the Game. Refresh before moving.');
    fetchMock.mockResolvedValue(json(initial));
    await click('.move-entry__banner button');
    expect(container.textContent).toContain('Your move');
  });

  it('submits a move and replaces the optimistic board with the accepted snapshot', async () => {
    await mount();
    await proposeMove();
    fetchMock.mockImplementation((_url: string, options?: RequestInit) =>
      Promise.resolve(
        options?.method === 'POST'
          ? json({
              ply: 1,
              uci: 'e2e4',
              san: 'e4',
              fenAfter: afterMove.currentFen,
              sideToMove: 'black',
              version: 1,
            })
          : json(afterMove),
      ),
    );
    await click('.move-entry__submit');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/moves'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(container.textContent).toContain('Move accepted: e4');
    expect(container.querySelector('[data-testid="turn-status"]')?.textContent).toBe(
      'Black to move',
    );
    expect(container.querySelector('[data-square="e4"]')?.getAttribute('aria-label')).toBe(
      'e4, white pawn',
    );
  });

  it('confirms flag fall from the server before ending the game', async () => {
    await mount();
    await proposeMove();
    fetchMock.mockImplementation((_url: string, options?: RequestInit) =>
      Promise.resolve(
        options?.method === 'POST'
          ? json({ state: 'completed', resultReason: 'flag', result: 'black_win' })
          : json({ ...initial, state: 'completed', result: 'black_win' }),
      ),
    );
    await click('.move-entry__submit');
    expect(container.textContent).toContain('Time expired. Game complete.');
    expect(container.textContent).toContain('Bea won');
  });

  it('switches live play to read-only below the viewport boundary', async () => {
    await mount();
    matches = false;
    await act(async () => changeViewport?.());
    expect(container.textContent).toContain('Live play needs a screen at least 768 px wide.');
    expect(container.querySelector('.move-entry__submit')).toBeNull();
    matches = true;
    await act(async () => changeViewport?.());
    expect(container.querySelector('.move-entry__submit')).not.toBeNull();
  });
});
