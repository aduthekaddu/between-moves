import {
  DomainError,
  type GameColor,
  type GameSeatCreationResult,
  type OfferedGameColor,
} from '@between-moves/domain';
import type { QueryResultRow } from 'pg';

export interface GameSeatReplayRow extends QueryResultRow {
  readonly game_id: unknown;
  readonly open_seat_id: unknown;
  readonly season_id: unknown;
  readonly creator_membership_id: unknown;
  readonly intended_membership_id: unknown;
  readonly offered_color: unknown;
  readonly creator_color: unknown;
  readonly expires_at: unknown;
  readonly creation_payload_digest: unknown;
  readonly expected_payload_digest: unknown;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid Game seat ${field}`);
  return value;
}

function gameColor(value: unknown): GameColor {
  if (value !== 'white' && value !== 'black') throw new Error('Invalid creator color');
  return value;
}

function offeredColor(value: unknown): OfferedGameColor {
  if (value !== 'white' && value !== 'black' && value !== 'any') {
    throw new Error('Invalid offered color');
  }
  return value;
}

/** [BM-022] Parse a stored idempotent seat-creation result at the DB boundary. */
export function parseGameSeatReplay(
  row: GameSeatReplayRow,
  houseId: string,
): GameSeatCreationResult {
  if (row.creation_payload_digest !== row.expected_payload_digest) {
    throw new DomainError('idempotency_conflict', 'Idempotency key was reused for another seat');
  }
  if (!(row.expires_at instanceof Date) || Number.isNaN(row.expires_at.getTime())) {
    throw new Error('Invalid Game seat expiry');
  }
  return {
    gameId: stringValue(row.game_id, 'Game id'),
    openSeatId: stringValue(row.open_seat_id, 'Open seat id'),
    houseId,
    seasonId: stringValue(row.season_id, 'Season id'),
    creatorMembershipId: stringValue(row.creator_membership_id, 'creator membership id'),
    intendedMembershipId:
      row.intended_membership_id === null
        ? null
        : stringValue(row.intended_membership_id, 'intended membership id'),
    offeredColor: offeredColor(row.offered_color),
    creatorColor: gameColor(row.creator_color),
    expiresAt: row.expires_at,
    state: 'waiting',
    createdNow: false,
  };
}
