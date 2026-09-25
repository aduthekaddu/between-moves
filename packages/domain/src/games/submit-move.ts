import type { AuthenticatedViewer } from '../identity';
import type { AuthorizeHouseAction, IdGenerator } from '../houses';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { Clock } from '../shared/clock';
import { AuthorizationDeniedError, DomainError } from '../shared/errors';
import type { ChessMoveProposal, RulesAdapter, SideToMove } from './rules-adapter';

export interface SubmitMoveRequest {
  readonly houseId: string;
  readonly gameId: string;
  readonly expectedPly: number;
  readonly clientCommandId: string;
  readonly move: ChessMoveProposal;
  readonly viewer: AuthenticatedViewer;
}

export interface SubmitMoveInput {
  readonly gameId: string;
  readonly expectedPly: number;
  readonly clientCommandId: string;
  readonly move: ChessMoveProposal;
  readonly moveId: string;
  readonly outboxEventId: string;
  readonly completedEventId: string;
  readonly analysisEventId: string;
  readonly receivedAt: Date;
  /** Sample server time near the end of a successful live Move transaction. */
  readonly turnStartAt?: () => Date;
  readonly rules: RulesAdapter;
}

export type AcceptedMoveClock =
  | { readonly kind: 'correspondence'; readonly moveDueAt: Date | null }
  | {
      readonly kind: 'live';
      readonly whiteMs: number;
      readonly blackMs: number;
      readonly turnStartedAt: Date | null;
    };

export interface AcceptedSubmitMoveResult {
  readonly flagged?: false;
  readonly gameId: string;
  readonly houseId: string;
  readonly ply: number;
  readonly uci: string;
  readonly san: string;
  readonly fenAfter: string;
  readonly sideToMove: SideToMove;
  readonly version: number;
  readonly clock: AcceptedMoveClock;
  readonly completedNow: boolean;
  readonly replayed: boolean;
}

export interface FlagFallResult {
  readonly flagged: true;
  readonly gameId: string;
  readonly houseId: string;
  readonly ply: number;
  readonly sideToMove: SideToMove;
  readonly version: number;
  readonly result: 'white_win' | 'black_win';
  readonly clock: {
    readonly kind: 'live';
    readonly whiteMs: number;
    readonly blackMs: number;
    readonly turnStartedAt: null;
  };
  readonly completedNow: true;
  readonly replayed: false;
}

export type SubmitMoveResult = AcceptedSubmitMoveResult | FlagFallResult;

export interface MoveConflictSnapshot {
  readonly version: number;
  readonly currentPly: number;
  readonly fen: string;
}

/** [BM-024] [DR-MOVE-05] A stale Move carries the durable position needed to reconcile. */
export class MoveConflictError extends DomainError {
  override readonly name = 'MoveConflictError';

  constructor(readonly current: MoveConflictSnapshot) {
    super('move_conflict', 'Move was submitted against a stale Game position');
  }
}

/** A House Member who has no seat on this Game cannot submit or replay Moves. */
export class NonSeatedMoveError extends AuthorizationDeniedError {
  constructor() {
    super('Only a seated Member can submit a Move');
  }
}

export interface SubmitMoveRepository {
  submit(context: AuthorizationContext, input: SubmitMoveInput): Promise<SubmitMoveResult>;
}

export interface SubmitMoveDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly rules: RulesAdapter;
  readonly moves: SubmitMoveRepository;
}
