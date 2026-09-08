import type { Viewer } from '../identity';
import type { AuthorizeHouseAction } from '../houses';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { SideToMove } from './rules-adapter';

export type GamePositionState = 'active' | 'completed';
export type GamePositionResult = 'white_win' | 'black_win' | 'draw' | 'aborted';

export interface GamePositionMember {
  readonly membershipId: string;
  readonly name: string;
}

export interface GamePositionMove {
  readonly ply: number;
  readonly uci: string;
  readonly san: string;
}

/** [BM-027] Durable, server-derived state used to seed the Game board. */
export interface GamePosition {
  readonly gameId: string;
  readonly mode: 'correspondence' | 'live';
  readonly state: GamePositionState;
  readonly currentFen: string;
  readonly currentPly: number;
  readonly sideToMove: SideToMove;
  readonly version: number;
  readonly white: GamePositionMember;
  readonly black: GamePositionMember;
  readonly viewerColor: SideToMove | null;
  readonly canMove: boolean;
  readonly moveDueAt: Date | null;
  readonly result: GamePositionResult | null;
  readonly inCheck: boolean;
  readonly moves: readonly GamePositionMove[];
}

export interface GamePositionReadRepository {
  readGamePosition(context: AuthorizationContext, gameId: string): Promise<GamePosition | null>;
}

export interface ReadGamePositionQuery {
  readonly houseId: string;
  readonly gameId: string;
  readonly viewer: Viewer;
}

export interface ReadGamePositionDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly games: GamePositionReadRepository;
}
