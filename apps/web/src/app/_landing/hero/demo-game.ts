/** Légal's mate (1750), replayed as a Thursday game between two members of one House. */
export interface DemoMove {
  readonly uci: string;
  readonly san: string;
  readonly caption: string;
  readonly check?: boolean;
  readonly mate?: boolean;
}

export const DEMO_PLAYERS = { white: 'Meera', black: 'Kabir' } as const;

export const DEMO_GAME: readonly DemoMove[] = [
  { uci: 'e2e4', san: '1. e4', caption: 'Meera opens with the king’s pawn. Of course she does.' },
  { uci: 'e7e5', san: '1… e5', caption: 'Kabir answers in kind. Chai is poured.' },
  { uci: 'g1f3', san: '2. Nf3', caption: 'The knight comes out to look around.' },
  { uci: 'd7d6', san: '2… d6', caption: 'Kabir holds the centre. Solid. Sensible.' },
  { uci: 'f1c4', san: '3. Bc4', caption: 'The bishop eyes f7. Nobody says anything.' },
  { uci: 'c8g4', san: '3… Bg4', caption: 'Kabir pins the knight and leans back, pleased.' },
  { uci: 'b1c3', san: '4. Nc3', caption: 'Another knight. The rail starts whispering.' },
  { uci: 'g7g6', san: '4… g6', caption: 'A quiet move. Too quiet.' },
  { uci: 'f3e5', san: '5. Nxe5!', caption: 'Meera walks away from her queen.' },
  { uci: 'g4d1', san: '5… Bxd1', caption: 'Kabir takes it. Who wouldn’t?' },
  { uci: 'c4f7', san: '6. Bxf7+', caption: 'Check.', check: true },
  { uci: 'e8e7', san: '6… Ke7', caption: 'The only square left.' },
  { uci: 'c3d5', san: '7. Nd5#', caption: 'Mate in seven. Kabir wants a rematch.', mate: true },
];

export type PieceKind = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';
export type PieceColor = 'white' | 'black';

export interface SetupPiece {
  readonly kind: PieceKind;
  readonly color: PieceColor;
  readonly square: string;
}

const backRank: readonly PieceKind[] = [
  'rook',
  'knight',
  'bishop',
  'queen',
  'king',
  'bishop',
  'knight',
  'rook',
];
const files = 'abcdefgh';

export const START_POSITION: readonly SetupPiece[] = [
  ...backRank.map((kind, i) => ({ kind, color: 'white' as const, square: `${files[i]}1` })),
  ...backRank.map((_, i) => ({
    kind: 'pawn' as const,
    color: 'white' as const,
    square: `${files[i]}2`,
  })),
  ...backRank.map((_, i) => ({
    kind: 'pawn' as const,
    color: 'black' as const,
    square: `${files[i]}7`,
  })),
  ...backRank.map((kind, i) => ({ kind, color: 'black' as const, square: `${files[i]}8` })),
];

/** Board space: one unit per square, a1 at (-3.5, +3.5), h8 at (+3.5, -3.5). */
export function squareToXZ(square: string): { x: number; z: number } {
  const file = files.indexOf(square[0] ?? 'a');
  const rank = Number(square[1] ?? '1');
  return { x: file - 3.5, z: 3.5 - (rank - 1) };
}
