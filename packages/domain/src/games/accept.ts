import type { AuthenticatedViewer } from '../identity';
import type { AuthorizeHouseAction } from '../houses';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { Clock } from '../shared/clock';

export interface AcceptGameSeatRequest {
  readonly houseId: string;
  readonly gameId: string;
  readonly viewer: AuthenticatedViewer;
}

export interface GameSeatAcceptanceInput {
  readonly gameId: string;
  readonly acceptedAt: Date;
}

export interface GameSeatAcceptanceResult {
  readonly gameId: string;
  readonly houseId: string;
  readonly whiteMembershipId: string;
  readonly blackMembershipId: string;
  readonly moveDueAt: Date;
  readonly state: 'active';
}

export interface GameSeatAcceptanceRepository {
  accept(
    context: AuthorizationContext,
    input: GameSeatAcceptanceInput,
  ): Promise<GameSeatAcceptanceResult>;
}

export interface GameSeatAcceptanceDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly clock: Clock;
  readonly acceptances: GameSeatAcceptanceRepository;
}
