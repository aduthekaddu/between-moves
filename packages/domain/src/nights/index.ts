import type { Viewer } from '../identity';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { Clock } from '../shared/clock';
import type { AuthorizeHouseAction } from '../houses/authorization';
import type { IdGenerator } from '../houses/house';

export {
  DEFAULT_NIGHT_DURATION_MS,
  houseLocalDateTimeToInstant,
  materializeNightSchedule,
  type MaterializedNight,
} from './schedule';

export type NightState = 'scheduled' | 'live' | 'ended' | 'cancelled';

export interface HouseNightView {
  readonly nightId: string;
  readonly houseId: string;
  readonly seasonId: string;
  readonly scheduledStart: Date;
  readonly scheduledEnd: Date;
  readonly state: NightState;
}

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
