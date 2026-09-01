import type { AuthenticatedViewer } from '../identity';
import type { AuthorizeHouseAction, IdGenerator } from '../houses';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { Clock } from '../shared/clock';
import type { CorrespondenceClockPolicy } from './clock-policy';

export type GameColor = 'white' | 'black';
export type OfferedGameColor = GameColor | 'any';

export interface GameSeatColorChooser {
  choose(): GameColor;
}

export interface CreateGameSeatRequest {
  readonly houseId: string;
  readonly mode: 'correspondence';
  readonly clockPolicy: CorrespondenceClockPolicy;
  readonly offeredColor: OfferedGameColor;
  readonly intendedMembershipId: string | null;
  readonly idempotencyKey: string | null;
  readonly viewer: AuthenticatedViewer;
}

export interface GameSeatCreationInput {
  readonly gameId: string;
  readonly openSeatId: string;
  readonly mode: 'correspondence';
  readonly clockPolicy: CorrespondenceClockPolicy;
  readonly offeredColor: OfferedGameColor;
  readonly creatorColor: GameColor;
  readonly intendedMembershipId: string | null;
  readonly idempotencyKey: string | null;
  readonly idempotencyPayload: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface GameSeatCreationResult {
  readonly gameId: string;
  readonly openSeatId: string;
  readonly houseId: string;
  readonly seasonId: string;
  readonly creatorMembershipId: string;
  readonly intendedMembershipId: string | null;
  readonly offeredColor: OfferedGameColor;
  readonly creatorColor: GameColor;
  readonly expiresAt: Date;
  readonly state: 'waiting';
  readonly createdNow: boolean;
}

export interface GameSeatCreationRepository {
  create(
    context: AuthorizationContext,
    input: GameSeatCreationInput,
  ): Promise<GameSeatCreationResult>;
}

export interface GameSeatCreationDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly colors: GameSeatColorChooser;
  readonly seats: GameSeatCreationRepository;
}

export const OPEN_SEAT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;

/** [BM-022] Resolve the creator's occupied side from the color offered to the next Member. */
export function creatorColorForOffer(
  offeredColor: OfferedGameColor,
  chooseAny: () => GameColor,
): GameColor {
  if (offeredColor === 'white') return 'black';
  if (offeredColor === 'black') return 'white';
  return chooseAny();
}
