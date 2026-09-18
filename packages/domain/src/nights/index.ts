import type { Viewer } from '../identity';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { Clock } from '../shared/clock';
import type { AuthorizeHouseAction } from '../houses/authorization';
import type { IdGenerator } from '../houses/house';
import type { HouseNightView } from './night';

export {
  DEFAULT_NIGHT_DURATION_MS,
  houseLocalDateTimeToInstant,
  materializeNightSchedule,
  type MaterializedNight,
} from './schedule';
export {
  accumulatedAttendanceSeconds,
  crossedAttendanceDurationThreshold,
  NIGHT_ATTENDANCE_QUALIFIED_TOPIC,
  NIGHT_ATTENDANCE_THRESHOLD_SECONDS,
  nightAttendanceSourceKey,
  type JoinNightAttendanceInput,
  type LeaveNightAttendanceInput,
  type NightAttendance,
  type NightAttendanceDependencies,
  type NightAttendanceEventObservation,
  type NightAttendanceEventRecorder,
  type NightAttendanceJoinResult,
  type NightAttendanceLeaveResult,
  type NightAttendanceQualificationReason,
  type NightAttendanceRepository,
  type NightAttendanceRequest,
  type NightJoinLeaveKind,
  type NightJoinLeaveObservation,
  type NightJoinLeaveRecorder,
  type QualifyNightAttendanceInput,
} from './attendance';
export {
  applyRailRealtimeEvent,
  applyRailRealtimeEventOrRepair,
  GAME_COMPLETED_TOPIC,
  GAME_MOVE_ACCEPTED_TOPIC,
  nightSequenceForState,
  RAIL_RECENT_RESULT_LIMIT,
  REALTIME_PUBLISH_TOPICS,
} from './rail';
export type {
  ApplyRailRealtimeEventResult,
  RepairRailRealtimeEventResult,
  NightRailBoard,
  NightRailPlayer,
  NightRailRepository,
  NightRailResult,
  NightRailResultValue,
  NightRailSnapshot,
  RailRealtimeEvent,
  ReadNightRailDependencies,
  ReadNightRailRequest,
  RealtimePublishTopic,
} from './rail';
export {
  REALTIME_TOKEN_TTL_MS,
  realtimeChannelOperations,
  type IssuedRealtimeToken,
  type MintRealtimeTokenRequest,
  type NightRealtimeScope,
  type NightRealtimeScopeRepository,
  type RealtimeChannelKind,
  type RealtimeChannelOperation,
  type RealtimeGameChannel,
  type RealtimeTokenChannels,
  type RealtimeTokenDependencies,
  type RealtimeTokenIssueInput,
  type RealtimeTokenIssuer,
  type SignedRealtimePresence,
} from './realtime-token';
export {
  NIGHT_ENDED_TOPIC,
  NIGHT_STARTED_TOPIC,
  transitionNightLifecycle,
  type AssignNightHostInput,
  type AssignNightHostRequest,
  type NightHostCandidate,
  type NightLifecycleDependencies,
  type NightLifecycleEvent,
  type NightLifecycleInput,
  type NightLifecycleObservation,
  type NightLifecycleRecorder,
  type NightLifecycleRepository,
  type NightLifecycleRequest,
  type NightLifecycleResult,
  type NightLifecycleTransition,
  type NightRsvp,
  type NightRsvpInput,
  type NightRsvpRepository,
  type NightRsvpRequest,
} from './lifecycle';
export type { HouseNightView, NightRsvpStatus, NightState } from './night';

export type NightScheduleCommand =
  | {
      readonly kind: 'reschedule';
      readonly scheduledStart: Date;
      readonly scheduledEnd: Date;
    }
  | { readonly kind: 'cancel' };

export interface NightChangeInput {
  readonly nightId: string;
  readonly auditId: string;
  readonly command: NightScheduleCommand;
  readonly changedAt: Date;
}

export interface NightChangeResult {
  readonly night: HouseNightView;
  readonly changedNow: boolean;
}

export interface NightRepository {
  list(context: AuthorizationContext): Promise<readonly HouseNightView[]>;
  change(context: AuthorizationContext, input: NightChangeInput): Promise<NightChangeResult>;
}

export interface ReadScheduledNightsRequest {
  readonly houseId: string;
  readonly viewer: Viewer;
}

export interface ChangeNightScheduleRequest {
  readonly houseId: string;
  readonly nightId: string;
  readonly command: NightScheduleCommand;
  readonly viewer: Viewer;
}

export interface NightScheduleChangeObservation {
  readonly actorId: string;
  readonly houseId: string;
  readonly nightId: string;
  readonly change: 'rescheduled' | 'cancelled';
  readonly outcome: 'success' | 'rejected' | 'error';
}

export interface NightScheduleChangeRecorder {
  record(observation: NightScheduleChangeObservation): void;
}

export interface NightDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly nights: NightRepository;
  readonly changes: NightScheduleChangeRecorder;
}

/** [BM-020] Ports used by the Between Moves Night scheduling slice. */
export interface NightsPorts {
  readonly nights: NightRepository;
}
