import type { Viewer } from '../identity';
import type { AuthorizeHouseAction, IdGenerator } from '../houses';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { Clock } from '../shared/clock';

export const GAME_REACTIONS = ['well_played', 'brilliant', 'dramatic', 'funny'] as const;
export type GameReactionValue = (typeof GAME_REACTIONS)[number];

export interface GameReaction {
  readonly membershipId: string;
  readonly reaction: GameReactionValue;
  readonly reactedAt: Date;
}

export interface SetGameReactionInput {
  readonly id: string;
  readonly gameId: string;
  readonly reaction: GameReactionValue;
  readonly reactedAt: Date;
}

export interface GameReactionRepository {
  set(context: AuthorizationContext, input: SetGameReactionInput): Promise<GameReaction>;
  readCurrent(context: AuthorizationContext, gameId: string): Promise<GameReactionValue | null>;
}

export interface SetGameReactionRequest {
  readonly houseId: string;
  readonly gameId: string;
  readonly reaction: GameReactionValue;
  readonly viewer: Viewer;
}

export interface ReadCurrentGameReactionRequest {
  readonly houseId: string;
  readonly gameId: string;
  readonly viewer: Viewer;
}

export interface SetGameReactionDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly reactions: GameReactionRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export interface ReadGameReactionDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly reactions: GameReactionRepository;
}
