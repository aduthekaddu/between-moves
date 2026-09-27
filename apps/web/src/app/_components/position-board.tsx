import { FenPiece } from './piece';

/** A read-only paper board for one FEN position, with the side to move printed above it. */
export function PositionBoard({ fen }: { fen: string }) {
  const rows = fen.split(' ')[0]?.split('/') ?? [];
  const squares = rows.flatMap((row, rank) => {
    const pieces = [...row].flatMap((symbol) => {
      const empty = Number(symbol);
      return Number.isInteger(empty) && empty > 0
        ? Array.from({ length: empty }, () => '')
        : [symbol];
    });
    return pieces.map((piece, file) => ({
      piece,
      dark: (rank + file) % 2 === 1,
      key: `${rank}-${file}`,
    }));
  });
  return (
    <div>
      <p className="puzzle-turn">{fen.split(' ')[1] === 'b' ? 'Black to move' : 'White to move'}</p>
      <div className="puzzle-board" role="img" aria-label={`Chess position: ${fen}`}>
        {squares.map((square) => (
          <span
            key={square.key}
            className={
              square.dark
                ? 'puzzle-board__square puzzle-board__square--dark'
                : 'puzzle-board__square'
            }
            aria-hidden="true"
          >
            <FenPiece letter={square.piece} className="puzzle-board__piece" />
          </span>
        ))}
      </div>
    </div>
  );
}
