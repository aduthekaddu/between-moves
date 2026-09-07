import type { Viewer } from '../identity';
import type { AuthorizeHouseAction } from '../houses';
import type { AuthorizationContext } from '../shared/authorization-context';

export interface MoveShelfActiveGame {
  readonly gameId: string;
  readonly opponentName: string;
  readonly moveDueAt: Date;
}

export interface MoveShelfYourMoveGame extends MoveShelfActiveGame {
  readonly ply: number;
}

export type MoveShelfResult = 'white_win' | 'black_win' | 'draw' | 'aborted';

export interface MoveShelfCompletedGame {
  readonly gameId: string;
  readonly opponentName: string;
  readonly result: MoveShelfResult;
  readonly completedAt: Date;
}

/** [BM-026] [DR-SHELF-01] Member-specific ordered correspondence Game groups. */
export interface MoveShelf {
  readonly yourMove: readonly MoveShelfYourMoveGame[];
  readonly waiting: readonly MoveShelfActiveGame[];
  readonly recent: readonly MoveShelfCompletedGame[];
}

/** [BM-026] [DR-SEC-01] Shelf reads retain route-House and viewer scope. */
export interface MoveShelfReadRepository {
  readMoveShelf(context: AuthorizationContext): Promise<MoveShelf | null>;
}

export interface ReadMoveShelfQuery {
  readonly houseId: string;
  readonly viewer: Viewer;
}

export interface ReadMoveShelfDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly games: MoveShelfReadRepository;
}
