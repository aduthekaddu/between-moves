import type { MembershipRole } from '../houses/authorization';
import type { IdGenerator } from '../houses/house';
import type { Clock } from '../shared/clock';
import { DomainError } from '../shared/errors';
import type { GameReactionValue } from '../stories/reactions';
import type { AuthenticatedViewer } from './index';

/** [BM-050] Every shared record names a person who deleted their account this way. */
export const FORMER_MEMBER_DISPLAY_NAME = 'Former member';

/** [BM-050] Identifies the download so a person (or a later import) can tell what it is. */
export const ACCOUNT_EXPORT_FORMAT = 'between-moves.account-export';

/** [BM-050] Bump when the export's shape changes. */
export const ACCOUNT_EXPORT_VERSION = 1;

/** Dates are ISO strings so the export round-trips through JSON unchanged. */
export interface AccountExportProfile {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly imageUrl: string | null;
  readonly createdAt: string;
}

export interface AccountExportMembership {
  readonly membershipId: string;
  readonly houseId: string;
  readonly houseName: string;
  readonly role: MembershipRole;
  readonly status: 'active' | 'left' | 'removed';
  readonly joinedAt: string;
  readonly leftAt: string | null;
}

/** A Night chat message the person wrote; `removedAt` is set when a moderator hid it. */
export interface AccountExportMessage {
  readonly messageId: string;
  readonly houseId: string;
  readonly nightId: string;
  readonly body: string;
  readonly sentAt: string;
  readonly removedAt: string | null;
}

export interface AccountExportNote {
  readonly noteId: string;
  readonly houseId: string;
  readonly gameId: string;
  readonly body: string;
  readonly createdAt: string;
  readonly editedAt: string | null;
}

export interface AccountExportReaction {
  readonly houseId: string;
  readonly gameId: string;
  readonly reaction: GameReactionValue;
  readonly createdAt: string;
}

export interface AccountExportPuzzle {
  readonly puzzleId: string;
  readonly houseId: string;
  readonly seasonId: string;
  readonly gameId: string;
  readonly prompt: string;
  readonly positionFen: string;
  readonly publishedAt: string;
}

/** A Game the person was seated in, from their side of the board. */
export interface AccountExportGame {
  readonly gameId: string;
  readonly houseId: string;
  readonly seasonId: string;
  readonly mode: 'correspondence' | 'live';
  readonly state: 'waiting' | 'active' | 'completed' | 'cancelled';
  readonly color: 'white' | 'black';
  readonly result: string | null;
  readonly resultReason: string | null;
  readonly plies: number;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

/** A Move the person played. */
export interface AccountExportMove {
  readonly gameId: string;
  readonly houseId: string;
  readonly ply: number;
  readonly san: string;
  readonly uci: string;
  readonly playedAt: string;
}

/** One explainable Season point entry the person earned. */
export interface AccountExportPoints {
  readonly houseId: string;
  readonly seasonId: string;
  readonly sourceKind: string;
  readonly points: number;
  readonly recordedAt: string;
}

export interface AccountExportStanding {
  readonly houseId: string;
  readonly seasonId: string;
  readonly rank: number;
  readonly points: number;
  readonly finalizedAt: string;
}

/**
 * [BM-050] Everything the person contributed, scoped to their own identity: other Members'
 * messages, notes, reactions, email addresses and names are never part of it.
 */
export interface AccountExport {
  readonly format: typeof ACCOUNT_EXPORT_FORMAT;
  readonly version: typeof ACCOUNT_EXPORT_VERSION;
  readonly exportedAt: string;
  readonly profile: AccountExportProfile;
  readonly memberships: readonly AccountExportMembership[];
  readonly authored: {
    readonly messages: readonly AccountExportMessage[];
    readonly notes: readonly AccountExportNote[];
    readonly reactions: readonly AccountExportReaction[];
    readonly puzzles: readonly AccountExportPuzzle[];
  };
  readonly games: readonly AccountExportGame[];
  readonly moves: readonly AccountExportMove[];
  readonly contributions: {
    readonly points: readonly AccountExportPoints[];
    readonly finalStandings: readonly AccountExportStanding[];
  };
}

export interface AccountDeletionInput {
  readonly userId: string;
  readonly deletedAt: Date;
  /** One membership audit ID per membership the deletion ends. */
  readonly auditIds: IdGenerator;
}

export interface AccountDeletionResult {
  readonly userId: string;
  /** False when a concurrent request already deleted the account. */
  readonly deletedNow: boolean;
  /** Memberships moved from `active` to `left`. */
  readonly membershipsLeft: number;
  readonly sessionsRemoved: number;
}

export interface OwnedHouse {
  readonly houseId: string;
  readonly name: string;
}

/**
 * [BM-050] An active House needs its Owner, so an Owner transfers ownership first. The error
 * names only the viewer's own Houses.
 */
export class AccountDeletionBlockedError extends DomainError {
  override readonly name = 'AccountDeletionBlockedError';

  constructor(readonly ownedHouses: readonly OwnedHouse[]) {
    super('conflict', 'Transfer ownership of your Houses before deleting your account');
  }
}

/** An active House the person belongs to, for the account page. */
export interface AccountSummaryHouse {
  readonly houseId: string;
  readonly name: string;
  readonly role: MembershipRole;
}

export interface AccountSummary {
  readonly displayName: string;
  /** Active memberships in active Houses, by House name. */
  readonly houses: readonly AccountSummaryHouse[];
}

export interface AccountDataRightsRepository {
  /** Null when the identity is missing or already deleted. */
  readSummary(userId: string): Promise<AccountSummary | null>;
  /** Null when the identity is missing or already deleted. */
  exportAccount(userId: string, exportedAt: Date): Promise<AccountExport | null>;
  /**
   * Atomically scrub the profile, remove sessions and sign-in links, end active memberships
   * as `left`, and show the person as `Former member`. Shared records stay intact.
   * Throws AccountDeletionBlockedError while the person owns an active House.
   */
  deleteAccount(input: AccountDeletionInput): Promise<AccountDeletionResult>;
}

export interface AccountDataRightsRequest {
  readonly viewer: AuthenticatedViewer;
}

export interface AccountDataRightsDependencies {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly accounts: AccountDataRightsRepository;
}
