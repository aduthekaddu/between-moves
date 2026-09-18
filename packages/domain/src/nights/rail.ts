import type { Viewer } from '../identity';
import type { AuthorizeHouseAction } from '../houses/authorization';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { SideToMove } from '../games/rules-adapter';
import type { NightState } from './night';
import type { NightPresenceReader } from './presence';
import type { SignedRealtimePresence } from './realtime-token';

export const RAIL_RECENT_RESULT_LIMIT = 8;

export const GAME_MOVE_ACCEPTED_TOPIC = 'game.move-accepted';
export const GAME_COMPLETED_TOPIC = 'game.completed';

export const REALTIME_PUBLISH_TOPICS = [
  GAME_MOVE_ACCEPTED_TOPIC,
  GAME_COMPLETED_TOPIC,
  'night.started',
  'night.ended',
] as const;

export type RealtimePublishTopic = (typeof REALTIME_PUBLISH_TOPICS)[number];

export interface NightRailPlayer {
  readonly membershipId: string;
  readonly name: string;
}

export type NightRailResultValue = 'white_win' | 'black_win' | 'draw' | 'aborted';

export interface NightRailBoard {
  readonly gameId: string;
  readonly sequence: bigint;
  readonly currentFen: string;
  readonly currentPly: number;
  readonly sideToMove: SideToMove;
  readonly lastSan: string | null;
  readonly white: NightRailPlayer;
  readonly black: NightRailPlayer;
}

export interface NightRailResult {
  readonly gameId: string;
  readonly sequence: bigint;
  readonly result: NightRailResultValue;
  readonly resultReason: string | null;
  readonly completedAt: Date;
  readonly white: NightRailPlayer;
  readonly black: NightRailPlayer;
}

/** [BM-038] [BM-039] Durable rail data combined with ephemeral signed presence. */
export interface NightRailSnapshot {
  readonly houseId: string;
  readonly nightId: string;
  readonly seasonId: string;
  readonly state: NightState;
  readonly scheduledStart: Date;
  readonly scheduledEnd: Date;
  readonly startedAt: Date | null;
  readonly endedAt: Date | null;
  readonly nightSequence: bigint;
  readonly presence: readonly SignedRealtimePresence[];
  readonly presenceCount: number;
  readonly activeBoards: readonly NightRailBoard[];
  readonly recentResults: readonly NightRailResult[];
}

export interface NightRailRepository {
  read(context: AuthorizationContext, nightId: string): Promise<NightRailSnapshot | null>;
}

export interface ReadNightRailRequest {
  readonly houseId: string;
  readonly nightId: string;
  readonly viewer: Viewer;
}

export interface ReadNightRailDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly clock: { now(): Date };
  readonly presence: NightPresenceReader;
  readonly rails: NightRailRepository;
}

export interface RailRealtimeEvent {
  readonly topic: string;
  readonly aggregateId: string;
  readonly sequence: bigint;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type ApplyRailRealtimeEventResult =
  | { readonly kind: 'applied'; readonly snapshot: NightRailSnapshot }
  | { readonly kind: 'ignored' }
  | { readonly kind: 'gap' };

function isRealtimePublishTopic(topic: string): topic is RealtimePublishTopic {
  return (REALTIME_PUBLISH_TOPICS as readonly string[]).includes(topic);
}

function isSideToMove(value: unknown): value is SideToMove {
  return value === 'white' || value === 'black';
}

function isResult(value: unknown): value is NightRailResultValue {
  return value === 'white_win' || value === 'black_win' || value === 'draw' || value === 'aborted';
}

function boardById(
  snapshot: NightRailSnapshot,
  gameId: string,
): NightRailBoard | NightRailResult | undefined {
  return (
    snapshot.activeBoards.find((board) => board.gameId === gameId) ??
    snapshot.recentResults.find((board) => board.gameId === gameId)
  );
}

function sequenceRelation(current: bigint, incoming: bigint): 'next' | 'stale' | 'gap' {
  if (incoming <= current) return 'stale';
  if (incoming === current + 1n) return 'next';
  return 'gap';
}

function applyMove(
  snapshot: NightRailSnapshot,
  event: RailRealtimeEvent,
): ApplyRailRealtimeEventResult {
  const fenAfter = event.payload.fenAfter;
  const san = event.payload.san;
  const ply = event.payload.ply;
  const sideToMove = event.payload.sideToMove;
  if (
    typeof fenAfter !== 'string' ||
    typeof san !== 'string' ||
    typeof ply !== 'number' ||
    !Number.isInteger(ply) ||
    ply < 1 ||
    !isSideToMove(sideToMove)
  ) {
    return { kind: 'ignored' };
  }

  const existing = boardById(snapshot, event.aggregateId);
  if (existing === undefined) return { kind: 'gap' };
  const relation = sequenceRelation(existing.sequence, event.sequence);
  if (relation === 'stale') return { kind: 'ignored' };
  if (relation === 'gap') return { kind: 'gap' };
  if (!('currentFen' in existing)) return { kind: 'ignored' };

  return {
    kind: 'applied',
    snapshot: {
      ...snapshot,
      activeBoards: snapshot.activeBoards.map((board) =>
        board.gameId === event.aggregateId
          ? {
              ...board,
              sequence: event.sequence,
              currentFen: fenAfter,
              currentPly: ply,
              sideToMove,
              lastSan: san,
            }
          : board,
      ),
    },
  };
}

function applyCompleted(
  snapshot: NightRailSnapshot,
  event: RailRealtimeEvent,
): ApplyRailRealtimeEventResult {
  const result = event.payload.result;
  const completedAtValue = event.payload.completedAt;
  if (!isResult(result) || typeof completedAtValue !== 'string') return { kind: 'ignored' };
  const completedAt = new Date(completedAtValue);
  if (Number.isNaN(completedAt.getTime())) return { kind: 'ignored' };

  const existing = boardById(snapshot, event.aggregateId);
  if (existing === undefined) return { kind: 'gap' };
  const relation = sequenceRelation(existing.sequence, event.sequence);
  if (relation === 'stale') return { kind: 'ignored' };
  if (relation === 'gap') return { kind: 'gap' };

  const completed: NightRailResult = {
    gameId: event.aggregateId,
    sequence: event.sequence,
    result,
    resultReason:
      typeof event.payload.resultReason === 'string' ? event.payload.resultReason : null,
    completedAt,
    white: existing.white,
    black: existing.black,
  };
  return {
    kind: 'applied',
    snapshot: {
      ...snapshot,
      activeBoards: snapshot.activeBoards.filter((board) => board.gameId !== event.aggregateId),
      recentResults: [
        completed,
        ...snapshot.recentResults.filter((board) => board.gameId !== event.aggregateId),
      ].slice(0, RAIL_RECENT_RESULT_LIMIT),
    },
  };
}

function applyNight(
  snapshot: NightRailSnapshot,
  event: RailRealtimeEvent,
  nextState: NightState,
): ApplyRailRealtimeEventResult {
  if (event.aggregateId !== snapshot.nightId) return { kind: 'ignored' };
  const relation = sequenceRelation(snapshot.nightSequence, event.sequence);
  if (relation === 'stale') return { kind: 'ignored' };
  if (relation === 'gap') return { kind: 'gap' };
  const atValue = event.payload.at;
  const at = typeof atValue === 'string' ? new Date(atValue) : null;
  if (at === null || Number.isNaN(at.getTime())) return { kind: 'ignored' };
  return {
    kind: 'applied',
    snapshot: {
      ...snapshot,
      state: nextState,
      nightSequence: event.sequence,
      startedAt:
        nextState === 'live' || nextState === 'ended'
          ? (snapshot.startedAt ?? at)
          : snapshot.startedAt,
      endedAt: nextState === 'ended' ? at : snapshot.endedAt,
    },
  };
}

/** [BM-038] Apply a sequenced realtime event, or signal a gap that needs a durable re-read. */
export function applyRailRealtimeEvent(
  snapshot: NightRailSnapshot,
  event: RailRealtimeEvent,
): ApplyRailRealtimeEventResult {
  if (!isRealtimePublishTopic(event.topic)) return { kind: 'ignored' };
  if (event.topic === GAME_MOVE_ACCEPTED_TOPIC) return applyMove(snapshot, event);
  if (event.topic === GAME_COMPLETED_TOPIC) return applyCompleted(snapshot, event);
  if (event.topic === 'night.started') return applyNight(snapshot, event, 'live');
  return applyNight(snapshot, event, 'ended');
}

/** [BM-038] Night aggregate sequence committed with start/end outbox events. */
export function nightSequenceForState(state: NightState): bigint {
  if (state === 'ended') return 2n;
  if (state === 'live') return 1n;
  return 0n;
}

export type RepairRailRealtimeEventResult = {
  readonly snapshot: NightRailSnapshot;
  readonly outcome: 'applied' | 'ignored' | 'repaired';
};

/** [BM-038] Apply the next sequence, or replace the snapshot from a durable read on a gap. */
export async function applyRailRealtimeEventOrRepair(
  snapshot: NightRailSnapshot,
  event: RailRealtimeEvent,
  readFresh: () => Promise<NightRailSnapshot>,
): Promise<RepairRailRealtimeEventResult> {
  const result = applyRailRealtimeEvent(snapshot, event);
  if (result.kind === 'applied') return { snapshot: result.snapshot, outcome: 'applied' };
  if (result.kind === 'ignored') return { snapshot, outcome: 'ignored' };
  return { snapshot: await readFresh(), outcome: 'repaired' };
}
