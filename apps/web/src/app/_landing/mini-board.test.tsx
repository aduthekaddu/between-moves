import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MiniBoard, fenToPieces, isDark, squaresFromWhite } from './mini-board';

describe('mini board', () => {
  it('maps a FEN placement to coloured pieces by square', () => {
    const pieces = fenToPieces('6k1/5ppp/8/8/8/8/2r2PPP/3R2K1 w - - 0 1');
    expect(pieces.g8).toBe('black-king');
    expect(pieces.d1).toBe('white-rook');
    expect(pieces.c2).toBe('black-rook');
    expect(Object.keys(pieces)).toHaveLength(10);
  });

  it('colours a1 dark and h1 light', () => {
    expect(isDark('a1')).toBe(true);
    expect(isDark('h1')).toBe(false);
    expect(isDark('h8')).toBe(true);
  });

  it('lists squares from White’s side, a8 first and h1 last', () => {
    const squares = squaresFromWhite();
    expect(squares).toHaveLength(64);
    expect(squares[0]).toBe('a8');
    expect(squares[63]).toBe('h1');
  });

  it('skips letters that are not pieces without shifting the file', () => {
    const pieces = fenToPieces('x6k/8/8/8/8/8/8/K7 w - - 0 1');
    expect(pieces).toEqual({ h8: 'black-king', a1: 'white-king' });
  });

  it('prints one labelled image of 64 squares with pieces and highlights', () => {
    const html = renderToStaticMarkup(
      <MiniBoard
        pieces={{ e4: 'white-pawn' }}
        label="After 1. e4"
        highlight={['e4']}
        className="lp-mini--small"
      />,
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="After 1. e4"');
    expect(html).toContain('class="lp-mini lp-mini--small"');
    expect(html.match(/class="lp-mini__sq"/g)).toHaveLength(64);
    expect(html.match(/data-hot="true"/g)).toHaveLength(1);
    expect(html).toContain('url(/pieces/white-pawn.webp)');
  });

  it('defaults to no highlights and no extra class', () => {
    const html = renderToStaticMarkup(<MiniBoard pieces={{}} label="Empty board" />);
    expect(html).not.toContain('data-hot');
    expect(html).not.toContain('lp-piece');
  });
});
