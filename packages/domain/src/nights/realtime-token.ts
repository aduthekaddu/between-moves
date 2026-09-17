import type { Viewer } from '../identity';
import type { AuthorizeHouseAction } from '../houses/authorization';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { Clock } from '../shared/clock';

/** [BM-037] Short-lived client tokens; reconnects mint a replacement. */
export const REALTIME_TOKEN_TTL_MS = 15 * 60 * 1_000;

export type RealtimeChannelKind = 'night' | 'game';
export type RealtimeChannelOperation = 'presence' | 'subscribe';

export interface NightRealtimeScope {
  readonly houseId: string;
  readonly nightId: string;
  readonly gameIds: readonly string[];
}

export interface NightRealtimeScopeRepository {
  read(context: AuthorizationContext, nightId: string): Promise<NightRealtimeScope | null>;
}

/** [BM-037] Server-signed display data; grants no channel permissions. */
export interface SignedRealtimePresence {
  readonly clientId: string;
  readonly displayName: string;
  readonly signature: string;
}

export interface RealtimeGameChannel {
  readonly gameId: string;
  readonly channel: string;
}

export interface RealtimeTokenChannels {
  readonly night: string;
  readonly games: readonly RealtimeGameChannel[];
}

export interface IssuedRealtimeToken {
  readonly token: string;
  readonly expiresAt: Date;
  readonly clientId: string;
  readonly publicKey: string;
  readonly channels: RealtimeTokenChannels;
  readonly presence: SignedRealtimePresence;
}

export interface RealtimeTokenIssueInput {
  readonly houseId: string;
  readonly nightId: string;
  readonly gameIds: readonly string[];
  readonly clientId: string;
  readonly displayName: string;
  readonly issuedAt: Date;
}

export interface RealtimeTokenIssuer {
  issue(input: RealtimeTokenIssueInput): IssuedRealtimeToken;
}

export interface MintRealtimeTokenRequest {
  readonly houseId: string;
  readonly nightId: string;
  readonly viewer: Viewer;
}

export interface RealtimeTokenDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly clock: Clock;
  readonly nights: NightRealtimeScopeRepository;
  readonly tokens: RealtimeTokenIssuer;
}

/** [BM-037] Subscribe/presence only; never publish. */
export function realtimeChannelOperations(
  kind: RealtimeChannelKind,
): readonly RealtimeChannelOperation[] {
  return kind === 'night' ? ['presence', 'subscribe'] : ['subscribe'];
}
