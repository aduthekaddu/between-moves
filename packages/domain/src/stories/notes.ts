import type { Viewer } from '../identity';
import type { AuthorizeHouseAction, IdGenerator } from '../houses';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { Clock } from '../shared/clock';
import { DomainError } from '../shared/errors';

export const MAX_GAME_NOTE_LENGTH = 2_000;

/** [BM-032] [DR-NOTE-01] Enforce the plain-text Game-note storage bound. */
export function validateGameNoteBody(body: string): string {
  const length = [...body].length;
  if (length < 1 || length > MAX_GAME_NOTE_LENGTH) {
    throw new DomainError('validation_failed', 'Game notes must be 1–2000 characters.');
  }
  return body;
}

export interface GameNote {
  readonly membershipId: string;
  readonly authorDisplayName: string;
  readonly body: string;
  readonly createdAt: Date;
  readonly editedAt: Date | null;
}

export interface GameNotesView {
  readonly currentMembershipId: string;
  readonly notes: readonly GameNote[];
}

export interface SaveGameNoteInput {
  readonly id: string;
  readonly gameId: string;
  readonly body: string;
  readonly savedAt: Date;
}

export interface GameNoteRepository {
  save(context: AuthorizationContext, input: SaveGameNoteInput): Promise<GameNote>;
  readForGame(context: AuthorizationContext, gameId: string): Promise<GameNotesView | null>;
}

export interface SaveGameNoteRequest {
  readonly houseId: string;
  readonly gameId: string;
  readonly body: string;
  readonly viewer: Viewer;
}

export interface ReadGameNotesRequest {
  readonly houseId: string;
  readonly gameId: string;
  readonly viewer: Viewer;
}

export interface SaveGameNoteDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly notes: GameNoteRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export interface ReadGameNotesDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly notes: GameNoteRepository;
}
