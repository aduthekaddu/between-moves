'use client';

import type { ChessSquare, SideToMove } from '@between-moves/domain';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { Piece } from '../../../../_components/piece';
import { squareName, type BoardPiece, type BoardPieces } from './board-model';

const ascendingFiles = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const descendingFiles = [...ascendingFiles].reverse();
const ascendingRanks = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const descendingRanks = [...ascendingRanks].reverse();
const DRAG_THRESHOLD_PX = 6;
const SLIDE_MS = 190;

export type PromotionPiece = 'q' | 'r' | 'b' | 'n';

const promotionChoices: readonly {
  readonly piece: PromotionPiece;
  readonly kind: BoardPiece['kind'];
}[] = [
  { piece: 'q', kind: 'queen' },
  { piece: 'n', kind: 'knight' },
  { piece: 'r', kind: 'rook' },
  { piece: 'b', kind: 'bishop' },
];

function boardSquares(orientation: SideToMove): readonly ChessSquare[] {
  const ranks = orientation === 'white' ? descendingRanks : ascendingRanks;
  const files = orientation === 'white' ? ascendingFiles : descendingFiles;
  return ranks.flatMap((rank) => files.map((file) => `${file}${rank}` as ChessSquare));
}

function squareAtPoint(x: number, y: number): ChessSquare | null {
  const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-square]');
  return (element?.dataset.square as ChessSquare | undefined) ?? null;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A Move to slide on screen. `key` changes once per Move so a re-render does not replay it. */
export interface BoardSlide {
  readonly key: string;
  readonly from: ChessSquare;
  readonly to: ChessSquare;
}

interface ChessBoardProps {
  readonly pieces: BoardPieces;
  readonly orientation: SideToMove;
  readonly sideToMove: SideToMove;
  readonly active: boolean;
  readonly lastMove: string | null;
  readonly inCheck: boolean;
  readonly selected: ChessSquare | null;
  /** Legal destinations of the selected piece. */
  readonly targets: ReadonlySet<ChessSquare>;
  /** Squares holding a piece the viewer may pick up now. */
  readonly movable: ReadonlySet<ChessSquare>;
  readonly disabled: boolean;
  readonly pending: boolean;
  readonly slide: BoardSlide | null;
  readonly promotion: { readonly color: SideToMove } | null;
  readonly onSquare: (square: ChessSquare) => void;
  readonly onDragStart: (square: ChessSquare) => void;
  readonly onDrop: (from: ChessSquare, to: ChessSquare | null) => void;
  readonly onPromote: (piece: PromotionPiece) => void;
  readonly onCancelPromotion: () => void;
}

interface DragState {
  readonly pointerId: number;
  readonly touch: boolean;
  readonly from: ChessSquare;
  readonly startX: number;
  readonly startY: number;
  active: boolean;
  hover: HTMLElement | null;
}

/** [BM-027] [UX-CMP-01] Roving-focus chessboard: drag, tap-tap, or keyboard, with legal hints. */
export function ChessBoard({
  pieces,
  orientation,
  sideToMove,
  active,
  lastMove,
  inCheck,
  selected,
  targets,
  movable,
  disabled,
  pending,
  slide,
  promotion,
  onSquare,
  onDragStart,
  onDrop,
  onPromote,
  onCancelPromotion,
}: ChessBoardProps) {
  const squares = useMemo(() => boardSquares(orientation), [orientation]);
  const [focusSquare, setFocusSquare] = useState<ChessSquare>(squares[0] ?? 'a8');
  const [dragFrom, setDragFrom] = useState<ChessSquare | null>(null);
  const refs = useRef<Partial<Record<ChessSquare, HTMLButtonElement | null>>>({});
  const frameRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const firstPromotionRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<DragState | null>(null);
  const swallowClick = useRef(false);
  const lastFrom = lastMove?.slice(0, 2);
  const lastTo = lastMove?.slice(2, 4);
  const checkedKing = inCheck
    ? Object.entries(pieces).find(
        ([, piece]) => piece?.kind === 'king' && piece.color === sideToMove,
      )?.[0]
    : undefined;
  const draggedPiece = dragFrom === null ? undefined : pieces[dragFrom];

  useLayoutEffect(() => {
    if (slide === null || prefersReducedMotion()) return;
    const moved: [ChessSquare, ChessSquare][] = [[slide.from, slide.to]];
    const piece = pieces[slide.to];
    const fromFile = slide.from.charCodeAt(0);
    const toFile = slide.to.charCodeAt(0);
    if (piece?.kind === 'king' && Math.abs(fromFile - toFile) === 2) {
      const rank = slide.to[1];
      moved.push(
        toFile > fromFile
          ? [`h${rank}` as ChessSquare, `f${rank}` as ChessSquare]
          : [`a${rank}` as ChessSquare, `d${rank}` as ChessSquare],
      );
    }
    for (const [from, to] of moved) {
      const start = refs.current[from]?.getBoundingClientRect();
      const end = refs.current[to]?.getBoundingClientRect();
      const element = refs.current[to]?.querySelector<HTMLElement>('.chess-board__piece');
      if (start === undefined || end === undefined || element == null) continue;
      if (typeof element.animate !== 'function') continue;
      element.animate(
        [
          { transform: `translate(${start.left - end.left}px, ${start.top - end.top}px)` },
          { transform: 'translate(0, 0)' },
        ],
        { duration: SLIDE_MS, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
      );
    }
    // Only a new slide key animates; piece updates on the same key must not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide?.key]);

  useEffect(() => {
    if (promotion !== null) firstPromotionRef.current?.focus();
  }, [promotion]);

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

  function placeGhost(state: DragState, x: number, y: number) {
    const ghost = ghostRef.current;
    const frame = frameRef.current?.getBoundingClientRect();
    if (ghost === null || frame === undefined) return;
    // A finger would cover the piece, so a touch drag carries it above the fingertip.
    const lift = state.touch ? ghost.offsetHeight * 0.6 : 0;
    ghost.style.transform = `translate(${x - frame.left - ghost.offsetWidth / 2}px, ${y - frame.top - ghost.offsetHeight / 2 - lift}px)`;
  }

  function markHover(state: DragState, square: ChessSquare | null) {
    const next = square === null ? null : (refs.current[square] ?? null);
    if (state.hover === next) return;
    state.hover?.removeAttribute('data-drop-hover');
    next?.setAttribute('data-drop-hover', '');
    state.hover = next;
  }

  function startPointer(event: PointerEvent<HTMLDivElement>) {
    swallowClick.current = false;
    if (disabled || event.button !== 0 || promotion !== null) return;
    const square = (event.target as HTMLElement).closest<HTMLElement>('[data-square]')?.dataset
      .square as ChessSquare | undefined;
    if (square === undefined || !movable.has(square)) return;
    drag.current = {
      pointerId: event.pointerId,
      touch: event.pointerType === 'touch',
      from: square,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      hover: null,
    };
  }

  function movePointer(event: PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (state === null || state.pointerId !== event.pointerId) return;
    if (!state.active) {
      const distance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
      if (distance < DRAG_THRESHOLD_PX) return;
      state.active = true;
      // Capture only once it is a drag: capturing on press would send a tap's click to the frame.
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const size = refs.current[state.from]?.getBoundingClientRect().width ?? 0;
      if (ghostRef.current !== null) {
        ghostRef.current.style.width = `${size}px`;
        ghostRef.current.style.height = `${size}px`;
      }
      setDragFrom(state.from);
      onDragStart(state.from);
    }
    placeGhost(state, event.clientX, event.clientY);
    markHover(state, squareAtPoint(event.clientX, event.clientY));
  }

  function endPointer(event: PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (state === null || state.pointerId !== event.pointerId) return;
    drag.current = null;
    markHover(state, null);
    if (!state.active) return;
    swallowClick.current = true;
    setDragFrom(null);
    onDrop(state.from, squareAtPoint(event.clientX, event.clientY));
  }

  function cancelPointer() {
    const state = drag.current;
    drag.current = null;
    if (state === null) return;
    markHover(state, null);
    if (state.active) {
      setDragFrom(null);
      onDrop(state.from, null);
    }
  }

  return (
    <div
      ref={frameRef}
      className={`chess-board-frame${dragFrom === null ? '' : ' chess-board-frame--dragging'}`}
      onPointerDown={startPointer}
      onPointerMove={movePointer}
      onPointerUp={endPointer}
      onPointerCancel={cancelPointer}
      onLostPointerCapture={(event) => {
        // A touch starts captured by the square; that square losing it to the frame is expected.
        if (event.target === event.currentTarget) cancelPointer();
      }}
    >
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
              const isTarget = targets.has(chessSquare);
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
                    (chessSquare.charCodeAt(0) + Number(chessSquare[1])) % 2 === 0
                      ? 'dark'
                      : 'light'
                  }
                  data-last-move={wasLastMove || undefined}
                  data-check={isCheckedKing || undefined}
                  data-target={isTarget ? (piece === undefined ? 'move' : 'capture') : undefined}
                  data-movable={(!disabled && movable.has(chessSquare)) || undefined}
                  data-dragging={chessSquare === dragFrom || undefined}
                  aria-label={`${squareName(chessSquare, piece)}${isCheckedKing ? ', in check' : ''}${isTarget ? ', legal move' : ''}`}
                  aria-selected={chessSquare === selected}
                  aria-disabled={disabled}
                  tabIndex={chessSquare === focusSquare ? 0 : -1}
                  onClick={() => {
                    if (swallowClick.current) {
                      swallowClick.current = false;
                      return;
                    }
                    onSquare(chessSquare);
                  }}
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
      <div ref={ghostRef} className="chess-board__ghost" aria-hidden="true">
        {draggedPiece === undefined ? null : (
          <Piece
            className="chess-board__piece"
            color={draggedPiece.color}
            kind={draggedPiece.kind}
          />
        )}
      </div>
      {promotion === null ? null : (
        <div
          className="chess-board__promotion"
          role="group"
          aria-label="Promote the pawn to"
          onKeyDown={(event) => {
            if (event.key === 'Escape') onCancelPromotion();
          }}
        >
          <div className="chess-board__promotion-choices">
            {promotionChoices.map((choice, index) => (
              <button
                key={choice.piece}
                ref={index === 0 ? firstPromotionRef : undefined}
                type="button"
                aria-label={choice.kind[0]!.toUpperCase() + choice.kind.slice(1)}
                onClick={() => onPromote(choice.piece)}
              >
                <Piece
                  className="chess-board__promotion-piece"
                  color={promotion.color}
                  kind={choice.kind}
                />
              </button>
            ))}
          </div>
          <button
            type="button"
            className="chess-board__promotion-cancel"
            onClick={onCancelPromotion}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
