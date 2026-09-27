'use client';

import type { ChessSquare, SideToMove } from '@between-moves/domain';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Piece } from '../../../../_components/piece';
import { squareName, type BoardPieces } from './board-model';

const ascendingFiles = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const descendingFiles = [...ascendingFiles].reverse();
const ascendingRanks = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const descendingRanks = [...ascendingRanks].reverse();

function boardSquares(orientation: SideToMove): readonly ChessSquare[] {
  const ranks = orientation === 'white' ? descendingRanks : ascendingRanks;
  const files = orientation === 'white' ? ascendingFiles : descendingFiles;
  return ranks.flatMap((rank) => files.map((file) => `${file}${rank}` as ChessSquare));
}

interface ChessBoardProps {
  readonly pieces: BoardPieces;
  readonly orientation: SideToMove;
  readonly sideToMove: SideToMove;
  readonly active: boolean;
  readonly lastMove: string | null;
  readonly inCheck: boolean;
  readonly selectedFrom: ChessSquare | null;
  readonly selectedTo: ChessSquare | null;
  readonly disabled: boolean;
  readonly pending: boolean;
  readonly onSquare: (square: ChessSquare) => void;
}

/** [BM-027] [UX-CMP-01] Roving-focus chessboard with named squares and non-drag entry. */
export function ChessBoard({
  pieces,
  orientation,
  sideToMove,
  active,
  lastMove,
  inCheck,
  selectedFrom,
  selectedTo,
  disabled,
  pending,
  onSquare,
}: ChessBoardProps) {
  const squares = useMemo(() => boardSquares(orientation), [orientation]);
  const [focusSquare, setFocusSquare] = useState<ChessSquare>(squares[0] ?? 'a8');
  const refs = useRef<Partial<Record<ChessSquare, HTMLButtonElement | null>>>({});
  const lastFrom = lastMove?.slice(0, 2);
  const lastTo = lastMove?.slice(2, 4);
  const checkedKing = inCheck
    ? Object.entries(pieces).find(
        ([, piece]) => piece?.kind === 'king' && piece.color === sideToMove,
      )?.[0]
    : undefined;

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const rowStart = index - (index % 8);
    const nextIndex =
      event.key === 'ArrowRight'
        ? Math.min(index + 1, rowStart + 7)
        : event.key === 'ArrowLeft'
          ? Math.max(index - 1, rowStart)
          : event.key === 'ArrowDown'
            ? Math.min(index + 8, 63)
            : event.key === 'ArrowUp'
              ? Math.max(index - 8, 0)
              : event.key === 'Home'
                ? rowStart
                : event.key === 'End'
                  ? rowStart + 7
                  : null;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextSquare = squares[nextIndex];
    if (nextSquare === undefined) return;
    setFocusSquare(nextSquare);
    refs.current[nextSquare]?.focus();
  }

  return (
    <div
      className={`chess-board${pending ? ' chess-board--pending' : ''}`}
      role="grid"
      aria-multiselectable="true"
      aria-label={`Chessboard. ${active ? `${sideToMove} to move` : 'Game complete'}${inCheck ? `; ${sideToMove} king is in check` : ''}${lastMove === null ? '' : `. Last move ${lastMove}`}.`}
      aria-disabled={disabled}
    >
      {Array.from({ length: 8 }, (_, rowIndex) => (
        <div className="chess-board__row" role="row" key={rowIndex}>
          {squares.slice(rowIndex * 8, rowIndex * 8 + 8).map((chessSquare, columnIndex) => {
            const index = rowIndex * 8 + columnIndex;
            const piece = pieces[chessSquare];
            const selected = chessSquare === selectedFrom || chessSquare === selectedTo;
            const wasLastMove = chessSquare === lastFrom || chessSquare === lastTo;
            const isCheckedKing = chessSquare === checkedKing;
            return (
              <button
                key={chessSquare}
                ref={(node) => {
                  refs.current[chessSquare] = node;
                }}
                type="button"
                role="gridcell"
                className="chess-board__square"
                data-square={chessSquare}
                data-color={
                  (chessSquare.charCodeAt(0) + Number(chessSquare[1])) % 2 === 0 ? 'dark' : 'light'
                }
                data-last-move={wasLastMove || undefined}
                data-check={isCheckedKing || undefined}
                aria-label={`${squareName(chessSquare, piece)}${isCheckedKing ? ', in check' : ''}`}
                aria-selected={selected}
                aria-disabled={disabled}
                tabIndex={chessSquare === focusSquare ? 0 : -1}
                onClick={() => onSquare(chessSquare)}
                onFocus={() => setFocusSquare(chessSquare)}
                onKeyDown={(event) => moveFocus(event, index)}
              >
                {piece === undefined ? null : (
                  <Piece className="chess-board__piece" color={piece.color} kind={piece.kind} />
                )}
                {columnIndex === 0 ? (
                  <span className="chess-board__rank" aria-hidden="true">
                    {chessSquare[1]}
                  </span>
                ) : null}
                {rowIndex === 7 ? (
                  <span className="chess-board__file" aria-hidden="true">
                    {chessSquare[0]}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
