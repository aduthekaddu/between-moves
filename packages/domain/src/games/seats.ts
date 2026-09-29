import type { AuthenticatedViewer } from '../identity';
import type { AuthorizeHouseAction, IdGenerator } from '../houses';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { Clock } from '../shared/clock';
import type { CorrespondenceClockPolicy, LiveClockPolicy } from './clock-policy';

export type GameColor = 'white' | 'black';
export type OfferedGameColor = GameColor | 'any';

export interface GameSeatColorChooser {
  choose(): GameColor;
}

interface CreateGameSeatBase {
  readonly houseId: string;
  readonly offeredColor: OfferedGameColor;
  readonly intendedMembershipId: string | null;
  readonly idempotencyKey: string | null;
  readonly viewer: AuthenticatedViewer;
}

export type CreateGameSeatRequest = CreateGameSeatBase &
  (
    | {
        readonly mode: 'correspondence';
        readonly clockPolicy: CorrespondenceClockPolicy;
        readonly nightId?: never;
      }
    | { readonly mode: 'live'; readonly clockPolicy: LiveClockPolicy; readonly nightId: string }
  );

interface GameSeatCreationBase {
  readonly gameId: string;
  readonly openSeatId: string;
  readonly offeredColor: OfferedGameColor;
  readonly creatorColor: GameColor;
  readonly intendedMembershipId: string | null;
  readonly idempotencyKey: string | null;
  readonly idempotencyPayload: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export type GameSeatCreationInput = GameSeatCreationBase &
  (
    | {
        readonly mode: 'correspondence';
        readonly clockPolicy: CorrespondenceClockPolicy;
        readonly nightId?: never;
      }
    | { readonly mode: 'live'; readonly clockPolicy: LiveClockPolicy; readonly nightId: string }
  );

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

/**
 * [BM-022] [BM-023] The Member who opened a seat can take it down, and the Member a direct
 * challenge names can turn it down. Either way the waiting Game and its seat are cancelled.
 */
export interface CancelGameSeatRequest {
  readonly houseId: string;
  readonly gameId: string;
  readonly viewer: AuthenticatedViewer;
}

export interface GameSeatCancellationInput {
  readonly gameId: string;
  readonly cancelledAt: Date;
}

export interface GameSeatCancellationResult {
  readonly gameId: string;
  readonly houseId: string;
  readonly cancelledBy: 'creator' | 'challenged';
  readonly state: 'cancelled';
  /** False when the same seat was already cancelled, so a retried click is harmless. */
  readonly cancelledNow: boolean;
}

export interface GameSeatCancellationRepository {
  cancel(
    context: AuthorizationContext,
    input: GameSeatCancellationInput,
  ): Promise<GameSeatCancellationResult>;
}

export interface GameSeatCancellationDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly clock: Clock;
  readonly cancellations: GameSeatCancellationRepository;
}

/** [BM-022] Resolve the creator's occupied side from the color offered to the next Member. */
export function creatorColorForOffer(
  offeredColor: OfferedGameColor,
  chooseAny: () => GameColor,
): GameColor {
  if (offeredColor === 'white') return 'black';
  if (offeredColor === 'black') return 'white';
  return chooseAny();
}
