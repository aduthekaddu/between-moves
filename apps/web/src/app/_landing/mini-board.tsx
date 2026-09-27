const files = 'abcdefgh';
const kinds: Readonly<Record<string, string>> = {
  k: 'king',
  q: 'queen',
  r: 'rook',
  b: 'bishop',
  n: 'knight',
  p: 'pawn',
};

export type MiniPieces = Readonly<Record<string, string>>;

/** FEN placement → { e4: 'white-pawn', … } */
export function fenToPieces(fen: string): MiniPieces {
  const pieces: Record<string, string> = {};
  (fen.split(' ')[0] ?? '').split('/').forEach((row, r) => {
    let f = 0;
    for (const token of row) {
      const empty = Number(token);
      if (Number.isInteger(empty) && empty > 0) {
        f += empty;
        continue;
      }
      const kind = kinds[token.toLowerCase()];
      if (kind !== undefined) {
        pieces[`${files[f]}${8 - r}`] =
          `${token === token.toUpperCase() ? 'white' : 'black'}-${kind}`;
      }
      f += 1;
    }
  });
  return pieces;
}

export function squaresFromWhite(): string[] {
  const out: string[] = [];
  for (let rank = 8; rank >= 1; rank -= 1) {
    for (const file of files) out.push(`${file}${rank}`);
  }
  return out;
}

/** a1 is dark: file index + rank is odd on dark squares. */
export function isDark(square: string): boolean {
  return (files.indexOf(square[0] ?? 'a') + Number(square[1])) % 2 === 1;
}

/** A small printed board: paper squares, indigo squares, folded-paper pieces. */
export function MiniBoard({
  pieces,
  label,
  highlight = [],
  className = '',
}: {
  readonly pieces: MiniPieces;
  readonly label: string;
  readonly highlight?: readonly string[];
  readonly className?: string;
}) {
  return (
    <div className={`lp-mini ${className}`} role="img" aria-label={label}>
      {squaresFromWhite().map((square) => {
        const piece = pieces[square];
        return (
          <span
            key={square}
            className="lp-mini__sq"
            data-dark={isDark(square) || undefined}
            data-hot={highlight.includes(square) || undefined}
          >
            {piece === undefined ? null : (
              <span
                className="lp-piece"
                style={{ backgroundImage: `url(/pieces/${piece}.webp)` }}
              />
            )}
          </span>
        );
      })}
    </div>
  );
}
