import type { GamePositionMove, SideToMove } from '@between-moves/domain';

export interface MoveEntryPosition {
  readonly mode?: 'correspondence' | 'live';
  readonly serverNow?: string;
  readonly liveClock?: {
    readonly whiteMs: number;
    readonly blackMs: number;
    readonly turnStartedAt: Date | string | null;
  };
  readonly currentFen: string;
  readonly currentPly: number;
  readonly sideToMove: SideToMove;
  readonly version: number;
  readonly state: 'active' | 'completed';
  readonly viewerColor: SideToMove | null;
  readonly white: { readonly name: string; readonly membershipId?: string };
  readonly black: { readonly name: string; readonly membershipId?: string };
  readonly moveDueAt: Date | string | null;
  readonly result: 'white_win' | 'black_win' | 'draw' | 'aborted' | null;
  readonly inCheck: boolean;
  readonly moves: readonly GamePositionMove[];
  /** [BM-028] Absent from older snapshots; `null` when no offer is waiting. */
  readonly pendingDrawOffer?: {
    readonly offeringMembershipId: string;
    readonly ply: number;
  } | null;
  /** [BM-028] An offer at the current ply was declined. */
  readonly drawOfferDeclined?: boolean;
}

export interface AcceptedMoveBody {
  readonly ply: number;
  readonly uci: string;
  readonly san: string;
  readonly fenAfter: string;
  readonly sideToMove: SideToMove;
  readonly version: number;
}

export function acceptedMove(value: unknown): AcceptedMoveBody | null {
  if (value === null || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  if (
    typeof body.ply !== 'number' ||
    !Number.isInteger(body.ply) ||
    typeof body.uci !== 'string' ||
    typeof body.san !== 'string' ||
    typeof body.fenAfter !== 'string' ||
    (body.sideToMove !== 'white' && body.sideToMove !== 'black') ||
    typeof body.version !== 'number' ||
    !Number.isInteger(body.version)
  ) {
    return null;
  }
  return body as unknown as AcceptedMoveBody;
}

export function flagFall(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const body = value as Record<string, unknown>;
  return (
    body.state === 'completed' &&
    body.resultReason === 'flag' &&
    (body.result === 'white_win' || body.result === 'black_win')
  );
}

export function conflictPosition(value: unknown) {
  if (value === null || typeof value !== 'object') return null;
  const problem = value as Record<string, unknown>;
  if (
    problem.code !== 'move_conflict' ||
    problem.meta === null ||
    typeof problem.meta !== 'object'
  ) {
    return null;
  }
  const meta = problem.meta as Record<string, unknown>;
  if (
    typeof meta.version !== 'number' ||
    !Number.isInteger(meta.version) ||
    typeof meta.currentPly !== 'number' ||
    !Number.isInteger(meta.currentPly) ||
    typeof meta.fen !== 'string'
  ) {
    return null;
  }
  const turn = meta.fen.split(' ')[1];
  if (turn !== 'w' && turn !== 'b') return null;
  return {
    version: meta.version,
    currentPly: meta.currentPly,
    currentFen: meta.fen,
    sideToMove: turn === 'w' ? ('white' as const) : ('black' as const),
  };
}

export function moveEntryPosition(value: unknown): MoveEntryPosition | null {
  if (value === null || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  const white = body.white as Record<string, unknown> | null;
  const black = body.black as Record<string, unknown> | null;
  if (
    typeof body.currentFen !== 'string' ||
    typeof body.currentPly !== 'number' ||
    !Number.isInteger(body.currentPly) ||
    (body.sideToMove !== 'white' && body.sideToMove !== 'black') ||
    typeof body.version !== 'number' ||
    !Number.isInteger(body.version) ||
    (body.state !== 'active' && body.state !== 'completed') ||
    (body.viewerColor !== null && body.viewerColor !== 'white' && body.viewerColor !== 'black') ||
    white === null ||
    typeof white !== 'object' ||
    typeof white.name !== 'string' ||
    black === null ||
    typeof black !== 'object' ||
    typeof black.name !== 'string' ||
    (body.moveDueAt !== null &&
      (typeof body.moveDueAt !== 'string' || Number.isNaN(Date.parse(body.moveDueAt)))) ||
    (body.result !== null &&
      body.result !== 'white_win' &&
      body.result !== 'black_win' &&
      body.result !== 'draw' &&
      body.result !== 'aborted') ||
    typeof body.inCheck !== 'boolean' ||
    !Array.isArray(body.moves)
  ) {
    return null;
  }
  if (body.mode === 'live') {
    const clock = body.liveClock as Record<string, unknown> | null;
    if (
      typeof body.serverNow !== 'string' ||
      Number.isNaN(Date.parse(body.serverNow)) ||
      clock === null ||
      typeof clock !== 'object' ||
      typeof clock.whiteMs !== 'number' ||
      !Number.isSafeInteger(clock.whiteMs) ||
      clock.whiteMs < 0 ||
      typeof clock.blackMs !== 'number' ||
      !Number.isSafeInteger(clock.blackMs) ||
      clock.blackMs < 0 ||
      (clock.turnStartedAt !== null &&
        (typeof clock.turnStartedAt !== 'string' ||
          Number.isNaN(Date.parse(clock.turnStartedAt)))) ||
      (body.state === 'active' && clock.turnStartedAt === null)
    )
      return null;
  }
  const moves = body.moves.map((candidate) => {
    if (candidate === null || typeof candidate !== 'object') return null;
    const move = candidate as Record<string, unknown>;
    return typeof move.ply === 'number' &&
      Number.isInteger(move.ply) &&
      typeof move.uci === 'string' &&
      typeof move.san === 'string'
      ? { ply: move.ply, uci: move.uci, san: move.san }
      : null;
  });
  if (moves.some((move) => move === null)) return null;
  const offer = body.pendingDrawOffer as Record<string, unknown> | null | undefined;
  if (
    offer !== undefined &&
    offer !== null &&
    (typeof offer !== 'object' ||
      typeof offer.offeringMembershipId !== 'string' ||
      typeof offer.ply !== 'number' ||
      !Number.isInteger(offer.ply))
  ) {
    return null;
  }
  if (body.drawOfferDeclined !== undefined && typeof body.drawOfferDeclined !== 'boolean') {
    return null;
  }
  return { ...(body as unknown as MoveEntryPosition), moves: moves as GamePositionMove[] };
}

/** [BM-028] The viewer's own membership, when they hold a seat and the snapshot names it. */
export function viewerMembershipId(position: MoveEntryPosition): string | null {
  if (position.viewerColor === null) return null;
  return position[position.viewerColor].membershipId ?? null;
}
