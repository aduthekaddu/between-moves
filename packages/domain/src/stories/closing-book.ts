import type { ClaimedOutboxEvent } from '../delivery';
import type { Viewer } from '../identity';
import { FORMER_MEMBER_DISPLAY_NAME } from '../identity/data-rights';
import type { AuthorizeHouseAction, MembershipRole } from '../houses';
import type { CompletedGameResult, GameCompletionReason } from '../games/complete';
import type { FinalSeasonStanding } from '../seasons/closing';
import type { AuthorizationContext } from '../shared/authorization-context';

/** [BM-048] Bump when composition rules change; a published book keeps the version it was bound with. */
export const CLOSING_BOOK_GENERATION_VERSION = 1;

/** [BM-048] The book keeps each Game's largest swing, then the few largest across the Season. */
export const CLOSING_BOOK_SWING_LIMIT = 3;

export interface ClosingBookMember {
  readonly membershipId: string;
  readonly displayName: string;
}

/** Dates are ISO strings so the published payload round-trips through JSON unchanged. */
export interface ClosingBookSeason {
  readonly seasonId: string;
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly closingAt: string;
}

export interface ClosingBookGame {
  readonly gameId: string;
  readonly mode: 'correspondence' | 'live';
  readonly white: ClosingBookMember;
  readonly black: ClosingBookMember;
  readonly result: CompletedGameResult;
  readonly resultReason: GameCompletionReason;
  readonly plies: number;
  readonly completedAt: string;
}

export interface ClosingBookSwing {
  readonly gameId: string;
  readonly ply: number;
  /** The move played at `ply`; the evaluation swung after it. */
  readonly san: string;
  readonly mover: ClosingBookMember;
  readonly opponent: ClosingBookMember;
  readonly swingCp: number;
}

export interface ClosingBookPuzzle {
  readonly puzzleId: string;
  readonly prompt: string;
  readonly positionFen: string;
  readonly contributor: ClosingBookMember;
  readonly publishedAt: string;
}

export interface ClosingBookParticipant extends ClosingBookMember {
  readonly rank: number;
  readonly points: number;
  readonly gamesCompleted: number;
  readonly wins: number;
  readonly draws: number;
  readonly losses: number;
  readonly nightsAttended: number;
  readonly puzzlesPublished: number;
}

export type ClosingBookAwardKind =
  'season_leader' | 'most_games' | 'most_wins' | 'night_regular' | 'puzzle_setter';

/**
 * An award explains itself: `value` is the Season count that earned it and every recipient
 * shares it. Awards describe one Season and are never carried onto a Member.
 */
export interface ClosingBookAward {
  readonly kind: ClosingBookAwardKind;
  readonly value: number;
  readonly recipients: readonly ClosingBookMember[];
}

export interface ClosingBookTotals {
  readonly members: number;
  readonly gamesCompleted: number;
  readonly nightsHeld: number;
  readonly puzzlesPublished: number;
}

/** The published payload: everything the House recorded up to the closing instant. */
export interface ClosingBookContents {
  readonly season: ClosingBookSeason;
  readonly totals: ClosingBookTotals;
  readonly participation: readonly ClosingBookParticipant[];
  readonly awards: readonly ClosingBookAward[];
  readonly swings: readonly ClosingBookSwing[];
  readonly games: readonly ClosingBookGame[];
  readonly puzzles: readonly ClosingBookPuzzle[];
}

export interface ClosingBookSwingSource {
  readonly gameId: string;
  readonly ply: number;
  readonly san: string;
  readonly moverMembershipId: string;
  readonly swingCp: number;
}

export interface ClosingBookAttendance {
  readonly membershipId: string;
  readonly nights: number;
}

/** Facts read from one House Season, each cut off at the Season's closing instant. */
export interface ClosingBookSource {
  readonly season: ClosingBookSeason;
  readonly standings: readonly FinalSeasonStanding[];
  readonly games: readonly ClosingBookGame[];
  readonly swings: readonly ClosingBookSwingSource[];
  readonly puzzles: readonly ClosingBookPuzzle[];
  readonly nightsHeld: number;
  readonly attendance: readonly ClosingBookAttendance[];
}

export type ClosingBookState = 'generated' | 'published';

export interface ClosingBookRecord {
  readonly bookId: string;
  readonly state: ClosingBookState;
}

export interface GeneratedClosingBookInput {
  readonly bookId: string;
  readonly houseId: string;
  readonly seasonId: string;
  readonly sourceEventId: string;
  readonly generationVersion: number;
  readonly contents: ClosingBookContents;
  readonly generatedAt: Date;
}

/** Worker-side port: generation stays private until `publish` makes it visible. */
export interface ClosingBookWriter {
  findBySeason(houseId: string, seasonId: string): Promise<ClosingBookRecord | null>;
  /** Null when the Season is missing or has not entered `closing`. */
  readSource(houseId: string, seasonId: string, closingAt: Date): Promise<ClosingBookSource | null>;
  /** Store an unpublished book; when another writer already stored one, return theirs. */
  saveGenerated(input: GeneratedClosingBookInput): Promise<ClosingBookRecord>;
  /** Publish a generated book to its House; false when it was already published. */
  publish(input: {
    readonly houseId: string;
    readonly bookId: string;
    readonly publishedAt: Date;
  }): Promise<boolean>;
}

/**
 * Finds `season.closing` events that were acknowledged without a book being published, such as
 * events consumed by a worker that predates Closing Books.
 */
export interface ClosingBookRepairSource {
  findUnboundClosingEvents(limit: number): Promise<readonly ClaimedOutboxEvent[]>;
}

export interface PublishedClosingBook {
  readonly bookId: string;
  readonly generationVersion: number;
  readonly publishedAt: Date;
  readonly contents: ClosingBookContents;
}

export interface HouseClosingBook {
  readonly houseName: string;
  /** The House's IANA time zone, for dating the book's Games and Puzzles. */
  readonly timeZone: string;
  /** [BM-049] The reading Member's own membership, recorded with each view of the book. */
  readonly membershipId: string;
  readonly membershipRole: MembershipRole;
  /** The closing or most recently closed Season; null before any Season has closed. */
  readonly season: { readonly seasonId: string; readonly title: string } | null;
  /** [BM-049] The House's active Season, once a new Charter is published; null while none is. */
  readonly activeSeason: { readonly seasonId: string; readonly title: string } | null;
  /** Null until that Season's book is published. */
  readonly book: PublishedClosingBook | null;
}

export interface ClosingBookReader {
  /** Null when the House or the viewer's membership is not active. */
  readLatest(context: AuthorizationContext): Promise<HouseClosingBook | null>;
}

export interface ReadClosingBookRequest {
  readonly houseId: string;
  readonly viewer: Viewer;
}

export interface ReadClosingBookDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly books: ClosingBookReader;
}

export type ClosingBookOutcome = 'published' | 'duplicate' | 'failed';

export interface ClosingBookObservation {
  readonly eventId: string;
  readonly houseId: string | null;
  readonly seasonId: string | null;
  readonly bookId: string | null;
  readonly outcome: ClosingBookOutcome;
  readonly generationVersion: number;
}

export interface ClosingBookEventRecorder {
  record(observation: ClosingBookObservation): void;
}

/** Order Members by display name, then membership ID. */
function byName(left: ClosingBookMember, right: ClosingBookMember): number {
  return (
    left.displayName.localeCompare(right.displayName) ||
    left.membershipId.localeCompare(right.membershipId)
  );
}

/** Order ISO instants chronologically. */
function byInstant(left: string, right: string): number {
  return new Date(left).getTime() - new Date(right).getTime();
}

/** Count items by key. */
function countBy<T>(items: readonly T[], key: (item: T) => string): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

/** Each finalized Member's Season in rank then name order, with results, Nights and puzzles. */
function participation(source: ClosingBookSource): readonly ClosingBookParticipant[] {
  const nights = new Map(source.attendance.map((entry) => [entry.membershipId, entry.nights]));
  const puzzles = countBy(source.puzzles, (puzzle) => puzzle.contributor.membershipId);
  return [...source.standings]
    .sort((left, right) => left.rank - right.rank || byName(left, right))
    .map((standing) => {
      let wins = 0;
      let draws = 0;
      let losses = 0;
      for (const game of source.games) {
        const color =
          game.white.membershipId === standing.membershipId
            ? 'white'
            : game.black.membershipId === standing.membershipId
              ? 'black'
              : null;
        if (color === null) continue;
        if (game.result === 'draw') draws += 1;
        else if (game.result === `${color}_win`) wins += 1;
        else losses += 1;
      }
      return {
        membershipId: standing.membershipId,
        displayName: standing.displayName,
        rank: standing.rank,
        points: standing.points,
        gamesCompleted: wins + draws + losses,
        wins,
        draws,
        losses,
        nightsAttended: nights.get(standing.membershipId) ?? 0,
        puzzlesPublished: puzzles.get(standing.membershipId) ?? 0,
      };
    });
}

const AWARD_RULES: readonly {
  readonly kind: ClosingBookAwardKind;
  readonly value: (participant: ClosingBookParticipant) => number;
}[] = [
  { kind: 'season_leader', value: (participant) => participant.points },
  { kind: 'most_games', value: (participant) => participant.gamesCompleted },
  { kind: 'most_wins', value: (participant) => participant.wins },
  { kind: 'night_regular', value: (participant) => participant.nightsAttended },
  { kind: 'puzzle_setter', value: (participant) => participant.puzzlesPublished },
];

/**
 * [BM-048] One award per rule for the Season's highest non-zero count; ties share it.
 * Nobody receives an award for a count of zero.
 */
export function closingBookAwards(
  participants: readonly ClosingBookParticipant[],
): readonly ClosingBookAward[] {
  return AWARD_RULES.flatMap((rule) => {
    const value = Math.max(0, ...participants.map(rule.value));
    if (value === 0) return [];
    const recipients = participants
      .filter((participant) => rule.value(participant) === value)
      .map(({ membershipId, displayName }) => ({ membershipId, displayName }));
    return [{ kind: rule.kind, value, recipients }];
  });
}

/**
 * [BM-048] Keep the largest swing from each completed Game, then the largest few overall.
 * Swings from Games outside the book or by a Member not seated in that Game are dropped.
 */
export function memorableSwings(
  swings: readonly ClosingBookSwingSource[],
  games: readonly ClosingBookGame[],
  limit = CLOSING_BOOK_SWING_LIMIT,
): readonly ClosingBookSwing[] {
  const gamesById = new Map(games.map((game) => [game.gameId, game]));
  const largestPerGame = new Map<string, ClosingBookSwing>();
  for (const swing of swings) {
    const game = gamesById.get(swing.gameId);
    if (game === undefined) continue;
    const seats = [game.white, game.black];
    const mover = seats.find((seat) => seat.membershipId === swing.moverMembershipId);
    const opponent = seats.find((seat) => seat.membershipId !== swing.moverMembershipId);
    if (mover === undefined || opponent === undefined) continue;
    const current = largestPerGame.get(swing.gameId);
    if (
      current !== undefined &&
      (current.swingCp > swing.swingCp ||
        (current.swingCp === swing.swingCp && current.ply < swing.ply))
    ) {
      continue;
    }
    largestPerGame.set(swing.gameId, {
      gameId: swing.gameId,
      ply: swing.ply,
      san: swing.san,
      mover,
      opponent,
      swingCp: swing.swingCp,
    });
  }
  return [...largestPerGame.values()]
    .sort(
      (left, right) =>
        right.swingCp - left.swingCp ||
        left.gameId.localeCompare(right.gameId) ||
        left.ply - right.ply,
    )
    .slice(0, limit);
}

/**
 * [BM-048] Compose a deterministic Closing Book from one Season's recorded facts: the same
 * source always produces the same payload, whenever or however often generation runs.
 */
export function composeClosingBook(source: ClosingBookSource): ClosingBookContents {
  const games = [...source.games].sort(
    (left, right) =>
      byInstant(left.completedAt, right.completedAt) || left.gameId.localeCompare(right.gameId),
  );
  const puzzles = [...source.puzzles].sort(
    (left, right) =>
      byInstant(left.publishedAt, right.publishedAt) || left.puzzleId.localeCompare(right.puzzleId),
  );
  const participants = participation({ ...source, games, puzzles });
  return {
    season: source.season,
    totals: {
      members: participants.length,
      gamesCompleted: games.length,
      nightsHeld: source.nightsHeld,
      puzzlesPublished: puzzles.length,
    },
    participation: participants,
    awards: closingBookAwards(participants),
    swings: memorableSwings(source.swings, games),
    games,
    puzzles,
  };
}

/**
 * [BM-050] A published book never changes, so a Member who deleted their account is renamed as
 * the book is read: every mention of one of `formerMembershipIds` shows `Former member`, and
 * nothing else about the book moves.
 */
export function withFormerMembers(
  contents: ClosingBookContents,
  formerMembershipIds: ReadonlySet<string>,
): ClosingBookContents {
  if (formerMembershipIds.size === 0) return contents;
  const named = <T extends ClosingBookMember>(member: T): T =>
    formerMembershipIds.has(member.membershipId)
      ? { ...member, displayName: FORMER_MEMBER_DISPLAY_NAME }
      : member;
  return {
    ...contents,
    participation: contents.participation.map(named),
    awards: contents.awards.map((award) => ({ ...award, recipients: award.recipients.map(named) })),
    swings: contents.swings.map((swing) => ({
      ...swing,
      mover: named(swing.mover),
      opponent: named(swing.opponent),
    })),
    games: contents.games.map((game) => ({
      ...game,
      white: named(game.white),
      black: named(game.black),
    })),
    puzzles: contents.puzzles.map((puzzle) => ({
      ...puzzle,
      contributor: named(puzzle.contributor),
    })),
  };
}
