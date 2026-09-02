import type { AuthenticatedViewer } from '../identity';
import type { AuthorizeHouseAction, IdGenerator } from '../houses';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { Clock } from '../shared/clock';
import { DomainError } from '../shared/errors';
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
  readonly receivedAt: Date;
  readonly rules: RulesAdapter;
}

export type AcceptedMoveClock =
  | { readonly kind: 'correspondence'; readonly moveDueAt: Date | null }
  | {
      readonly kind: 'live';
      readonly whiteMs: number;
      readonly blackMs: number;
      readonly turnStartedAt: Date;
    };

export interface SubmitMoveResult {
  readonly gameId: string;
  readonly houseId: string;
  readonly ply: number;
  readonly uci: string;
  readonly san: string;
  readonly fenAfter: string;
  readonly sideToMove: SideToMove;
  readonly version: number;
  readonly clock: AcceptedMoveClock;
  readonly replayed: boolean;
}

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
