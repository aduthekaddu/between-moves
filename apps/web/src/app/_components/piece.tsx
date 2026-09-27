/**
 * A folded-paper piece, rendered from the same 3D House Set as the landing page. Purely
 * visual: squares carry the accessible names.
 */
export function Piece({
  color,
  kind,
  className = 'piece',
}: {
  readonly color: 'white' | 'black';
  readonly kind: 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';
  readonly className?: string;
}) {
  return <span className={className} data-piece={`${color}-${kind}`} aria-hidden="true" />;
}

const fenKinds = {
  k: 'king',
  q: 'queen',
  r: 'rook',
  b: 'bishop',
  n: 'knight',
  p: 'pawn',
} as const;

/** Map one FEN piece letter to a Piece, or nothing for an empty square. */
export function FenPiece({
  letter,
  className,
}: {
  readonly letter: string;
  readonly className?: string;
}) {
  const kind = fenKinds[letter.toLowerCase() as keyof typeof fenKinds];
  if (kind === undefined) return null;
  return (
    <Piece
      color={letter === letter.toUpperCase() ? 'white' : 'black'}
      kind={kind}
      {...(className === undefined ? {} : { className })}
    />
  );
}
