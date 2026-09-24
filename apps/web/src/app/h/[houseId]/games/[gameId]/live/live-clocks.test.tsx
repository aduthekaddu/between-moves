// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MoveEntryPosition } from '../move-entry-wire';
import { LiveClocks } from './live-clocks';

const position: MoveEntryPosition = {
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

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function render(positionToRender: MoveEntryPosition) {
  await act(async () => root.render(<LiveClocks position={positionToRender} />));
}

describe('live clocks', () => {
  it('counts down only the running side using monotonic elapsed time', async () => {
    vi.useFakeTimers();
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(1000);
    await render(position);
    expect(container.querySelector('[data-testid="white-clock"]')?.textContent).toBe('1:00');
    expect(container.querySelector('[data-testid="black-clock"]')?.textContent).toBe('2:00');
    now.mockReturnValue(2500);
    await act(async () => vi.advanceTimersByTime(100));
    expect(container.querySelector('[data-testid="white-clock"]')?.textContent).toBe('0:59');
    expect(container.querySelector('.live-clock[data-running="true"]')?.textContent).toContain(
      'Ada',
    );
  });

  it('reorders clocks for Black and freezes a completed game', async () => {
    await render({ ...position, viewerColor: 'black', state: 'completed', result: 'black_win' });
    expect(container.querySelector('.live-clock')?.textContent).toContain('Black · Bea');
    expect(container.querySelectorAll('.live-clock[data-running="true"]')).toHaveLength(0);
    expect(container.textContent).toContain('Final');
    const withoutClock = { ...position };
    Reflect.deleteProperty(withoutClock, 'liveClock');
    await render(withoutClock);
    expect(container.querySelectorAll('[role="timer"]')).toHaveLength(0);
  });
});
