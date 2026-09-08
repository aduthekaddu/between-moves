import type { ChessMoveProposal, ChessSquare } from '@between-moves/domain';

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

function promotionKind(promotion: ChessMoveProposal['promotion']): PieceKind | undefined {
  switch (promotion) {
    case 'q':
      return 'queen';
    case 'r':
      return 'rook';
    case 'b':
      return 'bishop';
    case 'n':
      return 'knight';
    case undefined:
      return undefined;
  }
}

/** Preview only. A response always replaces this with the server's canonical FEN. */
export function applyOptimisticMove(current: BoardPieces, move: ChessMoveProposal): BoardPieces {
  const next = { ...current };
  const moving = current[move.from];
  if (moving === undefined) return next;

  delete next[move.from];
  delete next[move.to];

  const fromFile = move.from.charCodeAt(0);
  const toFile = move.to.charCodeAt(0);
  const fromRank = Number(move.from[1]);
  const toRank = Number(move.to[1]);

  if (moving.kind === 'pawn' && fromFile !== toFile && current[move.to] === undefined) {
    delete next[`${move.to[0]}${fromRank}` as ChessSquare];
  }

  if (moving.kind === 'king' && Math.abs(fromFile - toFile) === 2) {
    const kingSide = toFile > fromFile;
    const rookFrom = `${kingSide ? 'h' : 'a'}${fromRank}` as ChessSquare;
    const rookTo = `${kingSide ? 'f' : 'd'}${toRank}` as ChessSquare;
    const rook = current[rookFrom];
    if (rook !== undefined) {
      delete next[rookFrom];
      next[rookTo] = rook;
    }
  }

  const promoted = promotionKind(move.promotion);
  next[move.to] = promoted === undefined ? moving : { ...moving, kind: promoted };
  return next;
}
