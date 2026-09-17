import type { Viewer } from '../identity';
import type { AuthorizeHouseAction } from '../houses/authorization';
import type { IdGenerator } from '../houses/house';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { Clock } from '../shared/clock';
import { DomainError } from '../shared/errors';
import type { HouseNightView, NightRsvpStatus, NightState } from './night';

export const NIGHT_STARTED_TOPIC = 'night.started';
export const NIGHT_ENDED_TOPIC = 'night.ended';

export type NightLifecycleEvent = 'start' | 'end';

export interface NightLifecycleTransition {
  readonly state: NightState;
  readonly changedNow: boolean;
}

export interface NightLifecycleInput {
  readonly nightId: string;
  readonly eventId: string;
  readonly at: Date;
}

export interface NightLifecycleResult {
  readonly night: HouseNightView;
  readonly changedNow: boolean;
}

export interface AssignNightHostInput {
  readonly nightId: string;
  readonly hostMembershipId: string;
  readonly assignedAt: Date;
}

export interface NightHostCandidate {
  readonly membershipId: string;
  readonly displayName: string;
}

export interface NightRsvp {
  readonly rsvpId: string;
  readonly houseId: string;
  readonly nightId: string;
  readonly membershipId: string;
  readonly status: NightRsvpStatus;
  readonly respondedAt: Date;
}

export interface NightRsvpInput {
  readonly rsvpId: string;
  readonly nightId: string;
  readonly status: NightRsvpStatus;
  readonly respondedAt: Date;
}

/** [BM-035] [DR-NIGHT-03] Start and end transitions for one Between Moves Night. */
export function transitionNightLifecycle(
  current: NightState,
  event: NightLifecycleEvent,
): NightLifecycleTransition {
  if (event === 'start') {
    if (current === 'scheduled') return { state: 'live', changedNow: true };
    if (current === 'live') return { state: 'live', changedNow: false };
    throw new DomainError('conflict', 'Only a scheduled Night can start');
  }
  if (current === 'live') return { state: 'ended', changedNow: true };
  if (current === 'ended') return { state: 'ended', changedNow: false };
  throw new DomainError('conflict', 'Only a live Night can end');
}

export interface NightLifecycleRepository {
  start(context: AuthorizationContext, input: NightLifecycleInput): Promise<NightLifecycleResult>;
  end(context: AuthorizationContext, input: NightLifecycleInput): Promise<NightLifecycleResult>;
  assignHost(
    context: AuthorizationContext,
    input: AssignNightHostInput,
  ): Promise<NightLifecycleResult>;
  listHostCandidates(context: AuthorizationContext): Promise<readonly NightHostCandidate[]>;
}

export interface NightRsvpRepository {
  rsvp(context: AuthorizationContext, input: NightRsvpInput): Promise<NightRsvp>;
}

export interface NightLifecycleRequest {
  readonly houseId: string;
  readonly nightId: string;
  readonly viewer: Viewer;
}

export interface AssignNightHostRequest extends NightLifecycleRequest {
  readonly hostMembershipId: string;
}

export interface NightRsvpRequest extends NightLifecycleRequest {
  readonly status: NightRsvpStatus;
}

export interface NightLifecycleObservation {
  readonly actorId: string;
  readonly houseId: string;
  readonly nightId: string;
  readonly change: NightLifecycleEvent;
  readonly outcome: 'success' | 'rejected' | 'error';
}

export interface NightLifecycleRecorder {
  record(observation: NightLifecycleObservation): void;
}

export interface NightLifecycleDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly lifecycle: NightLifecycleRepository;
  readonly rsvps: NightRsvpRepository;
  readonly changes: NightLifecycleRecorder;
}
