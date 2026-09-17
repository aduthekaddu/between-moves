import type { Viewer } from '../identity';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { Clock } from '../shared/clock';
import type { AuthorizeHouseAction } from '../houses/authorization';
import type { IdGenerator } from '../houses/house';

export const NIGHT_ATTENDANCE_THRESHOLD_SECONDS = 15 * 60;
export const NIGHT_ATTENDANCE_QUALIFIED_TOPIC = 'night.attendance-qualified';

export type NightAttendanceQualificationReason = 'duration' | 'completed_live_game';

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
  readonly nightId: string;
  readonly joinedAt: Date;
}

export interface LeaveNightAttendanceInput {
  readonly nightId: string;
  readonly scoringEventId: string;
  readonly leftAt: Date;
}

export interface NightAttendanceLeaveResult extends NightAttendance {
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

export interface NightAttendanceRepository {
  join(context: AuthorizationContext, input: JoinNightAttendanceInput): Promise<NightAttendance>;
  leave(
    context: AuthorizationContext,
    input: LeaveNightAttendanceInput,
  ): Promise<NightAttendanceLeaveResult | null>;
  /** Server-only settlement/live-Game seam; callers derive identity from durable state. */
  qualify(input: QualifyNightAttendanceInput): Promise<NightAttendanceLeaveResult | null>;
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

export interface NightAttendanceDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly attendance: NightAttendanceRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly events: NightAttendanceEventRecorder;
}

/** [BM-033] [DR-SCORE-08] Stable attendance source key for at-least-once scoring. */
export function nightAttendanceSourceKey(nightId: string): string {
  return `night:${nightId}`;
}
