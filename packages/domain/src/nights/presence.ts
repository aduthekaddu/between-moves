import type { Viewer } from '../identity';
import type { AuthorizeHouseAction } from '../houses/authorization';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { Clock } from '../shared/clock';
import type {
  NightRealtimeScope,
  NightRealtimeScopeRepository,
  SignedRealtimePresence,
} from './realtime-token';

export type NightPresenceCommand =
  | {
      readonly kind: 'enter';
      readonly token: string;
      readonly presence: SignedRealtimePresence;
    }
  | {
      readonly kind: 'leave';
      readonly token: string;
      readonly presence: SignedRealtimePresence;
    };

export interface NightPresenceRequest {
  readonly houseId: string;
  readonly nightId: string;
  readonly viewer: Viewer;
  readonly command: NightPresenceCommand;
}

export interface NightPresenceEntry extends SignedRealtimePresence {
  readonly leaseId: string;
  readonly expiresAt: Date;
}

export interface NightPresenceSnapshot {
  readonly members: readonly SignedRealtimePresence[];
}

export interface NightPresenceReader {
  read(context: AuthorizationContext, nightId: string, at: Date): Promise<NightPresenceSnapshot>;
}

export interface NightPresenceRepository extends NightPresenceReader {
  enter(
    context: AuthorizationContext,
    nightId: string,
    entry: NightPresenceEntry,
    at: Date,
  ): Promise<NightPresenceSnapshot>;
  leave(
    context: AuthorizationContext,
    nightId: string,
    lease: { readonly clientId: string; readonly leaseId: string },
    at: Date,
  ): Promise<NightPresenceSnapshot>;
}

export interface VerifiedRealtimePresence {
  readonly leaseId: string;
  readonly expiresAt: Date;
}

export type VerifyRealtimePresence = (input: {
  readonly scope: NightRealtimeScope;
  readonly token: string;
  readonly presence: SignedRealtimePresence;
  readonly now: Date;
}) => VerifiedRealtimePresence;

export interface NightPresenceDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly clock: Clock;
  readonly nights: NightRealtimeScopeRepository;
  readonly presence: NightPresenceRepository;
  readonly verifyPresence: VerifyRealtimePresence;
}
