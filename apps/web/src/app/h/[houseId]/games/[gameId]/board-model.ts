import type { ChessSquare } from '@between-moves/domain';

export type PieceColor = 'white' | 'black';
export type PieceKind = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';

export interface BoardPiece {
  readonly color: PieceColor;
  readonly kind: PieceKind;
}

export type BoardPieces = Partial<Record<ChessSquare, BoardPiece>>;

const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const fenKinds: Readonly<Record<string, PieceKind>> = {
  k: 'king',
  q: 'queen',
  r: 'rook',
  b: 'bishop',
  n: 'knight',
  p: 'pawn',
};

function square(fileIndex: number, rank: number): ChessSquare {
  const file = files[fileIndex];
  if (file === undefined || rank < 1 || rank > 8) throw new Error('Invalid FEN square');
  return `${file}${rank}` as ChessSquare;
}

/** [BM-027] Parse only the piece-placement field; all other FEN truth stays server-owned. */
export function parseFenPieces(fen: string): BoardPieces {
  const placement = fen.split(' ')[0];
  const ranks = placement?.split('/');
  if (ranks === undefined || ranks.length !== 8) throw new Error('Invalid Game FEN');
  const pieces: BoardPieces = {};

  ranks.forEach((rankValue, rankIndex) => {
    let fileIndex = 0;
    for (const token of rankValue) {
      if (/^[1-8]$/.test(token)) {
        fileIndex += Number(token);
        continue;
      }
      const kind = fenKinds[token.toLowerCase()];
      if (kind === undefined || fileIndex >= 8) throw new Error('Invalid Game FEN');
      pieces[square(fileIndex, 8 - rankIndex)] = {
        color: token === token.toUpperCase() ? 'white' : 'black',
        kind,
      };
      fileIndex += 1;
    }
    if (fileIndex !== 8) throw new Error('Invalid Game FEN');
  });

  return pieces;
}

export function squareName(chessSquare: ChessSquare, piece?: BoardPiece): string {
  return piece === undefined
    ? `${chessSquare}, empty`
    : `${chessSquare}, ${piece.color} ${piece.kind}`;
}
