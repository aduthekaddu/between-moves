import type { GamePosition } from '@between-moves/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GameView } from './game-view';

const position: GamePosition = {
  gameId: '01941f29-7c00-7000-8000-000000000702',
  mode: 'correspondence',
  state: 'active',
  currentFen: '8/8/8/8/8/8/4P3/8 w - - 0 1',
  currentPly: 0,
  sideToMove: 'white',
  version: 0,
  white: { membershipId: 'white', name: 'Ada' },
  black: { membershipId: 'black', name: 'Bea' },
  viewerColor: 'white',
  canMove: true,
  moveDueAt: new Date('2026-09-10T08:00:00.000Z'),
  result: null,
  inCheck: false,
  moves: [],
  pendingDrawOffer: null,
};

describe('Game view', () => {
  it('[BM-041] renders live Move entry using the same server-owned command path', () => {
    const html = renderToStaticMarkup(
      <GameView
        houseId="01941f29-7c00-7000-8000-000000000701"
        position={{
          ...position,
          mode: 'live',
          moveDueAt: null,
          liveClock: {
            whiteMs: 180_000,
            blackMs: 180_000,
            turnStartedAt: new Date('2026-09-02T09:00:00.000Z'),
          },
        }}
      />,
    );
    expect(html).toContain('Live Game');
    expect(html).toContain('Live board');
    expect(html.match(/role="timer"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="White time remaining"');
    expect(html).toContain('aria-live="off"');
    expect(html).toContain('Submit Move');
  });

  it('[BM-027] [UX-CMP-01] renders an accessible canonical board and move controls', () => {
    const html = renderToStaticMarkup(
      <GameView houseId="01941f29-7c00-7000-8000-000000000701" position={position} />,
    );

    expect(html).toContain('role="grid"');
    expect(html).toContain('aria-label="e2, white pawn"');
    expect(html).toContain('aria-label="a8, empty"');
    expect(html).toContain('White to move');
    expect(html).toContain('Submit Move');
    expect(html).toContain('Move list (0)');
    expect(html).toContain('Ada plays White. Bea plays Black.');
  });

  it('[BM-027] [PR-EDGE-16] labels a spectator and disables every board square', () => {
    const html = renderToStaticMarkup(
      <GameView
        houseId="01941f29-7c00-7000-8000-000000000701"
        position={{ ...position, viewerColor: null, canMove: false }}
      />,
    );

    expect(html).toContain('Only seated players can move. You&#x27;re spectating.');
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(65);
  });

  it('[BM-027] [UX-CMP-01] identifies check with text and a non-color marker', () => {
    const html = renderToStaticMarkup(
      <GameView
        houseId="01941f29-7c00-7000-8000-000000000701"
        position={{
          ...position,
          state: 'completed',
          result: 'black_win',
          sideToMove: 'white',
          currentFen: '4k3/8/8/8/7q/8/8/4K3 w - - 0 1',
          inCheck: true,
          moves: [{ ply: 4, uci: 'd8h4', san: 'Qh4#' }],
          canMove: false,
          moveDueAt: null,
        }}
      />,
    );

    expect(html).toContain('white king is in check');
    expect(html).toContain('aria-label="e1, white king, in check"');
    expect(html).toContain('data-check="true"');
    expect(html).toContain('Game complete');
  });
});
