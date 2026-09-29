import type { Viewer } from '../identity';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { Clock } from '../shared/clock';
import { DomainError } from '../shared/errors';
import type { AuthorizeHouseAction } from '../houses/authorization';
import type { IdGenerator } from '../houses/house';

export const NIGHT_ATTENDANCE_THRESHOLD_SECONDS = 15 * 60;
export const NIGHT_ATTENDANCE_QUALIFIED_TOPIC = 'night.attendance-qualified';

export type NightAttendanceQualificationReason = 'duration' | 'completed_live_game';
export type NightJoinLeaveKind = 'join' | 'leave';

export interface NightAttendance {
  readonly attendanceId: string;
  readonly houseId: string;
  readonly nightId: string;
  readonly seasonId: string;
  readonly membershipId: string;
  readonly firstJoinedAt: Date;
  readonly currentJoinedAt: Date | null;
  readonly lastLeftAt: Date | null;
  readonly accumulatedSeconds: number;
  readonly qualifiedAt: Date | null;
  readonly qualificationReason: NightAttendanceQualificationReason | null;
}

export interface JoinNightAttendanceInput {
  readonly attendanceId: string;
  readonly eventId: string;
  readonly nightId: string;
  readonly joinedAt: Date;
}

export interface LeaveNightAttendanceInput {
  readonly nightId: string;
  readonly eventId: string;
  readonly scoringEventId: string;
  readonly leftAt: Date;
}

export interface NightAttendanceJoinResult extends NightAttendance {
  readonly joinedNow: boolean;
}

export interface NightAttendanceLeaveResult extends NightAttendance {
  readonly leftNow: boolean;
  readonly scoringEventEmitted: boolean;
  readonly sourceKey: string | null;
}

export interface QualifyNightAttendanceInput {
  readonly houseId: string;
  readonly nightId: string;
  readonly membershipId: string;
  readonly scoringEventId: string;
  readonly qualifiedAt: Date;
  readonly reason: NightAttendanceQualificationReason;
}

/** [BM-033] [BM-036] [DR-NIGHT-02/05] Unique per (night, member); server-timed join/leave accrue into scoring. */
export interface NightAttendanceRepository {
  join(
    context: AuthorizationContext,
    input: JoinNightAttendanceInput,
  ): Promise<NightAttendanceJoinResult>;
  leave(
    context: AuthorizationContext,
    input: LeaveNightAttendanceInput,
  ): Promise<NightAttendanceLeaveResult | null>;
  /** Server-only settlement/live-Game seam; callers derive identity from durable state. */
  qualify(input: QualifyNightAttendanceInput): Promise<NightAttendanceLeaveResult | null>;
}

/** [BM-036] The viewer's own attendance for one Night, or `null` before their first join. */
export interface NightAttendanceReadRepository {
  readViewerAttendance(
    context: AuthorizationContext,
    nightId: string,
  ): Promise<NightAttendance | null>;
}

export interface ReadNightAttendanceDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly attendance: NightAttendanceReadRepository;
}

export interface NightAttendanceRequest {
  readonly houseId: string;
  readonly nightId: string;
  readonly viewer: Viewer;
}

export interface NightAttendanceEventObservation {
  readonly actorId: string;
  readonly attendanceId: string;
  readonly houseId: string;
  readonly nightId: string;
  readonly sourceKey: string;
}

export interface NightAttendanceEventRecorder {
  record(observation: NightAttendanceEventObservation): void;
}

export interface NightJoinLeaveObservation {
  readonly actorId: string;
  readonly attendanceId: string | null;
  readonly houseId: string;
  readonly nightId: string;
  readonly change: NightJoinLeaveKind;
  readonly outcome: 'success' | 'rejected' | 'error';
}

export interface NightJoinLeaveRecorder {
  record(observation: NightJoinLeaveObservation): void;
}

export interface NightAttendanceDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly attendance: NightAttendanceRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly events: NightAttendanceEventRecorder;
  readonly joinLeave: NightJoinLeaveRecorder;
}

/** [BM-033] [DR-SCORE-08] Stable attendance source key for at-least-once scoring. */
export function nightAttendanceSourceKey(nightId: string): string {
  return `night:${nightId}`;
}

/** [BM-036] Accrue closed-interval seconds from a server-owned leave (or settlement) instant. */
export function accumulatedAttendanceSeconds(input: {
  readonly accumulatedSeconds: number;
  readonly currentJoinedAt: Date | null;
  readonly at: Date;
}): number {
  if (input.currentJoinedAt === null) return input.accumulatedSeconds;
  const elapsedMilliseconds = input.at.getTime() - input.currentJoinedAt.getTime();
  if (elapsedMilliseconds < 0) {
    throw new DomainError('conflict', 'Attendance time precedes its current join');
  }
  return input.accumulatedSeconds + Math.floor(elapsedMilliseconds / 1_000);
}

/** [BM-036] True only on the first crossing of the 15-minute duration threshold. */
export function crossedAttendanceDurationThreshold(input: {
  readonly alreadyQualified: boolean;
  readonly previousSeconds: number;
  readonly accumulatedSeconds: number;
}): boolean {
  return (
    !input.alreadyQualified &&
    input.previousSeconds < NIGHT_ATTENDANCE_THRESHOLD_SECONDS &&
    input.accumulatedSeconds >= NIGHT_ATTENDANCE_THRESHOLD_SECONDS
  );
}
