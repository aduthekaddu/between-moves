import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FenPiece, Piece } from './piece';

describe('Piece', () => {
  it('is decorative: the square, not the sprite, carries the name', () => {
    const html = renderToStaticMarkup(<Piece color="white" kind="knight" />);
    expect(html).toContain('data-piece="white-knight"');
    expect(html).toContain('aria-hidden="true"');
  });

  it('reads FEN letters by case and ignores empty squares', () => {
    expect(renderToStaticMarkup(<FenPiece letter="q" />)).toContain('black-queen');
    expect(renderToStaticMarkup(<FenPiece letter="P" />)).toContain('white-pawn');
    expect(renderToStaticMarkup(<FenPiece letter="" />)).toBe('');
  });
});
