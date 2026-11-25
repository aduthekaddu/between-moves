import {
  SystemClock,
  UpstashNightPresenceStore,
  verifyRealtimePresenceIdentity,
} from '@between-moves/adapters';
import { changeNightPresence, createAuthorizeHouseAction } from '@between-moves/application';
import {
  PgHouseAuthorizationMembershipRepository,
  PgNightRealtimeScopeRepository,
} from '@between-moves/db';
import type {
  AuthorizationContext,
  NightPresenceEntry,
  NightPresenceRepository,
  NightPresenceSnapshot,
  SignedRealtimePresence,
} from '@between-moves/domain';
import { createHouseAuthorizationMetricStubs } from '@between-moves/observability';
import { getConfig } from '../../config';
import { getDatabase } from '../../server/database';
import { createHouseAuthorizationDenialRecorder } from '../../server/house-authorization-observability';
import { getLogger } from '../../server/logger';
import type { NightPresenceHandlerDependencies } from '../../server/night-presence-handler';
import { getPresenceRateLimit, getRealtimeMetrics } from '../../server/rate-limit';
import { requireViewer } from '../../server/viewer';

export type NightPresenceListener = (snapshot: NightPresenceSnapshot) => void;

export interface NightPresenceStore extends NightPresenceRepository {
  readPublic(houseId: string, nightId: string, at: Date): Promise<NightPresenceSnapshot>;
  subscribe?(houseId: string, nightId: string, listener: NightPresenceListener): () => void;
}

function key(houseId: string, nightId: string): string {
  return `${houseId}:${nightId}`;
}

function publicIdentity(entry: NightPresenceEntry): SignedRealtimePresence {
  return {
    clientId: entry.clientId,
    displayName: entry.displayName,
    signature: entry.signature,
  };
}

/** [BM-039] Process-local, expiring presence. It never persists attendance or permissions. */
export class EphemeralNightPresenceStore implements NightPresenceStore {
  /** Entries are token leases, so closing one of several tabs does not remove the Member. */
  private readonly entries = new Map<string, Map<string, NightPresenceEntry>>();
  private readonly listeners = new Map<string, Set<NightPresenceListener>>();

  private snapshot(
    scopeKey: string,
    at: Date,
  ): { snapshot: NightPresenceSnapshot; pruned: boolean } {
    const scoped = this.entries.get(scopeKey);
    let pruned = false;
    if (scoped !== undefined) {
      for (const [leaseId, entry] of scoped) {
        if (entry.expiresAt.getTime() <= at.getTime()) {
          scoped.delete(leaseId);
          pruned = true;
        }
      }
      if (scoped.size === 0) this.entries.delete(scopeKey);
    }
    const byClient = new Map<string, NightPresenceEntry>();
    for (const entry of this.entries.get(scopeKey)?.values() ?? []) {
      const existing = byClient.get(entry.clientId);
      if (existing === undefined || existing.expiresAt.getTime() <= entry.expiresAt.getTime()) {
        byClient.set(entry.clientId, entry);
      }
    }
    const members = [...byClient.values()]
      .sort(
        (left, right) =>
          left.displayName.localeCompare(right.displayName) ||
          left.clientId.localeCompare(right.clientId),
      )
      .map(publicIdentity);
    return { snapshot: { members }, pruned };
  }

  private publish(scopeKey: string, snapshot: NightPresenceSnapshot): void {
    for (const listener of this.listeners.get(scopeKey) ?? []) listener(snapshot);
  }

  async read(
    context: AuthorizationContext,
    nightId: string,
    at: Date,
  ): Promise<NightPresenceSnapshot> {
    const scopeKey = key(context.houseId, nightId);
    const result = this.snapshot(scopeKey, at);
    if (result.pruned) this.publish(scopeKey, result.snapshot);
    return result.snapshot;
  }

  async enter(
    context: AuthorizationContext,
    nightId: string,
    entry: NightPresenceEntry,
    at: Date,
  ): Promise<NightPresenceSnapshot> {
    if (entry.clientId !== context.viewerId) throw new Error('Presence context mismatch');
    const scopeKey = key(context.houseId, nightId);
    const scoped = this.entries.get(scopeKey) ?? new Map<string, NightPresenceEntry>();
    const previous = scoped.get(entry.leaseId);
    const unchanged =
      previous?.clientId === entry.clientId &&
      previous.displayName === entry.displayName &&
      previous.signature === entry.signature &&
      previous.expiresAt.getTime() === entry.expiresAt.getTime();
    scoped.set(entry.leaseId, entry);
    this.entries.set(scopeKey, scoped);
    const result = this.snapshot(scopeKey, at);
    if (!unchanged || result.pruned) this.publish(scopeKey, result.snapshot);
    return result.snapshot;
  }

  async leave(
    context: AuthorizationContext,
    nightId: string,
    lease: { readonly clientId: string; readonly leaseId: string },
    at: Date,
  ): Promise<NightPresenceSnapshot> {
    if (lease.clientId !== context.viewerId) throw new Error('Presence context mismatch');
    const scopeKey = key(context.houseId, nightId);
    const scoped = this.entries.get(scopeKey);
    const entry = scoped?.get(lease.leaseId);
    if (entry !== undefined && entry.clientId !== lease.clientId) {
      throw new Error('Presence context mismatch');
    }
    const changed = scoped?.delete(lease.leaseId) ?? false;
    if (scoped?.size === 0) this.entries.delete(scopeKey);
    const result = this.snapshot(scopeKey, at).snapshot;
    if (changed) this.publish(scopeKey, result);
    return result;
  }

  async readPublic(houseId: string, nightId: string, at: Date): Promise<NightPresenceSnapshot> {
    const scopeKey = key(houseId, nightId);
    const result = this.snapshot(scopeKey, at);
    if (result.pruned) this.publish(scopeKey, result.snapshot);
    return result.snapshot;
  }

  subscribe(houseId: string, nightId: string, listener: NightPresenceListener): () => void {
    const scopeKey = key(houseId, nightId);
    const scoped = this.listeners.get(scopeKey) ?? new Set<NightPresenceListener>();
    scoped.add(listener);
    this.listeners.set(scopeKey, scoped);
    return () => {
      scoped.delete(listener);
      if (scoped.size === 0) this.listeners.delete(scopeKey);
    };
  }
}

const globalPresence = globalThis as typeof globalThis & {
  betweenMovesNightPresence?: NightPresenceStore;
};

export function getNightPresenceStore(): NightPresenceStore {
  const config = getConfig();
  globalPresence.betweenMovesNightPresence ??=
    config.environment === 'local'
      ? new EphemeralNightPresenceStore()
      : new UpstashNightPresenceStore({
          url: config.upstashRedisRestUrl.href,
          token: config.upstashRedisRestToken,
        });
  return globalPresence.betweenMovesNightPresence;
}

const clock = new SystemClock();
const authorizationMetrics = createHouseAuthorizationMetricStubs();

/** [BM-039] Web composition for signed ephemeral presence commands. */
export function nightPresenceHandlerDependencies(
  request: Request,
): NightPresenceHandlerDependencies {
  const config = getConfig();
  const database = getDatabase().pool;
  const requestId = request.headers.get('x-request-id') ?? 'request-unavailable';
  return {
    expectedOrigin: config.appOrigin.origin,
    requireViewer,
    limitPresence: getPresenceRateLimit(),
    changePresence: (command) =>
      changeNightPresence(command, {
        authorizeHouseAction: createAuthorizeHouseAction({
          memberships: new PgHouseAuthorizationMembershipRepository(database),
          nightHosts: { isAssignedNightHost: async () => false },
          denials: createHouseAuthorizationDenialRecorder({
            logger: getLogger(),
            metrics: authorizationMetrics,
            requestId,
          }),
        }),
        clock,
        nights: new PgNightRealtimeScopeRepository(database),
        presence: getNightPresenceStore(),
        verifyPresence: ({ scope, token, presence, now }) =>
          verifyRealtimePresenceIdentity({
            token,
            presence,
            serverKey: config.realtimeServerKey,
            houseId: scope.houseId,
            nightId: scope.nightId,
            now,
          }),
      }),
    logger: getLogger(),
    metrics: getRealtimeMetrics(),
    clock,
  };
}
