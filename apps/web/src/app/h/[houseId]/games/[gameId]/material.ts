import type { BoardPieces, PieceColor, PieceKind } from './board-model';

type CountedKind = Exclude<PieceKind, 'king'>;

const pointValues: Readonly<Record<CountedKind, number>> = {
  queen: 9,
  rook: 5,
  bishop: 3,
  knight: 3,
  pawn: 1,
};
const kinds: readonly CountedKind[] = ['queen', 'rook', 'bishop', 'knight', 'pawn'];

export interface SideMaterial {
  /** Opponent pieces this side is up by, most valuable first. */
  readonly ahead: readonly CountedKind[];
  /** Points this side leads by; zero for the side that is behind or level. */
  readonly lead: number;
}

/** Compares what is left on the board, so a promotion counts the way it looks. */
export function materialBalance(pieces: BoardPieces): Readonly<Record<PieceColor, SideMaterial>> {
  const counts: Record<PieceColor, Record<CountedKind, number>> = {
    white: { queen: 0, rook: 0, bishop: 0, knight: 0, pawn: 0 },
    black: { queen: 0, rook: 0, bishop: 0, knight: 0, pawn: 0 },
  };
  for (const piece of Object.values(pieces)) {
    if (piece !== undefined && piece.kind !== 'king') counts[piece.color][piece.kind] += 1;
  }
  const ahead = (side: PieceColor, other: PieceColor) =>
    kinds.flatMap((kind) =>
      Array.from({ length: Math.max(0, counts[side][kind] - counts[other][kind]) }, () => kind),
    );
  const points = (side: PieceColor) =>
    kinds.reduce((total, kind) => total + counts[side][kind] * pointValues[kind], 0);
  const difference = points('white') - points('black');
  return {
    white: { ahead: ahead('white', 'black'), lead: Math.max(0, difference) },
    black: { ahead: ahead('black', 'white'), lead: Math.max(0, -difference) },
  };
}
