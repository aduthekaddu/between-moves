'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PUZZLE } from './content';
import { fenToPieces, isDark, squaresFromWhite } from './mini-board';

type State = 'idle' | 'selected' | 'wrong' | 'solved';

/** A House Puzzle postcard you can actually solve: pick the piece, then its square. */
export function PuzzleCard() {
  const start = useMemo(() => fenToPieces(PUZZLE.fen), []);
  const [from, setFrom] = useState<string | null>(null);
  const [state, setState] = useState<State>('idle');
  const [attempt, setAttempt] = useState(0);
  const boardRef = useRef<HTMLDivElement>(null);

  // replay the shake on every wrong try without remounting the squares (and losing focus)
  useEffect(() => {
    if (attempt === 0) return;
    for (const animation of boardRef.current?.getAnimations?.() ?? []) {
      animation.cancel();
      animation.play();
    }
  }, [attempt]);

  const pieces: Record<string, string> = { ...start };
  if (state === 'solved') {
    const rook = pieces[PUZZLE.from];
    delete pieces[PUZZLE.from];
    if (rook !== undefined) pieces[PUZZLE.to] = rook;
  }

  function choose(square: string) {
    if (state === 'solved') return;
    const piece = pieces[square];
    if (from === null || piece?.startsWith('white')) {
      if (piece?.startsWith('white')) {
        setFrom(square);
        setState('selected');
      }
      return;
    }
    if (from === PUZZLE.from && square === PUZZLE.to) {
      setState('solved');
      setFrom(null);
      return;
    }
    setFrom(null);
    setState('wrong');
    setAttempt((value) => value + 1);
  }

  const message =
    state === 'solved'
      ? PUZZLE.solved
      : state === 'wrong'
        ? 'Not that one. Look along the back rank.'
        : state === 'selected'
          ? `${from} picked up. Now its square.`
          : PUZZLE.prompt;

  return (
    <article className="lp-puzzle" data-state={state}>
      <header className="lp-puzzle__head">
        <p className="lp-mono">House Puzzle · {PUZZLE.source}</p>
        <p className="lp-puzzle__stampmark" aria-hidden="true">
          Nº 12
        </p>
      </header>
      <div
        className="lp-puzzle__board"
        role="grid"
        aria-label="House Puzzle board. White to play."
        ref={boardRef}
      >
        {Array.from({ length: 8 }, (_, row) => (
          <div role="row" key={row} className="lp-puzzle__row">
            {squaresFromWhite()
              .slice(row * 8, row * 8 + 8)
              .map((square) => {
                const piece = pieces[square];
                return (
                  <button
                    key={square}
                    type="button"
                    role="gridcell"
                    className="lp-puzzle__sq"
                    data-dark={isDark(square) || undefined}
                    data-from={square === from || undefined}
                    data-to={(state === 'solved' && square === PUZZLE.to) || undefined}
                    aria-label={`${square}${piece === undefined ? '' : `, ${piece.replace('-', ' ')}`}`}
                    onClick={() => choose(square)}
                  >
                    {piece === undefined ? null : <span className="lp-piece" data-piece={piece} />}
                  </button>
                );
              })}
          </div>
        ))}
      </div>
      <p className="lp-puzzle__message" aria-live="polite">
        {message}
      </p>
      {state === 'solved' ? (
        <span className="lp-puzzle__solved" aria-hidden="true">
          Solved
        </span>
      ) : null}
    </article>
  );
}
