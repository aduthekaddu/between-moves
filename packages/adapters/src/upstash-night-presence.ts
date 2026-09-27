import type {
  AuthorizationContext,
  NightPresenceEntry,
  NightPresenceRepository,
  NightPresenceSnapshot,
  SignedRealtimePresence,
} from '@between-moves/domain';
import { createFailFastRedis } from './upstash-redis';

const KEY_TTL_SECONDS = 60 * 60;

interface StoredPresenceEntry {
  readonly clientId: string;
  readonly displayName: string;
  readonly signature: string;
  readonly expiresAt: string;
}

export interface NightPresenceRedisClient {
  hset<TData>(key: string, fields: Record<string, TData>): Promise<number>;
  hgetall<TData extends Record<string, unknown>>(key: string): Promise<TData | null>;
  hdel(key: string, ...fields: string[]): Promise<0 | 1>;
  expire(key: string, seconds: number): Promise<0 | 1>;
}

export type UpstashNightPresenceStoreOptions =
  | { readonly url: string; readonly token: string }
  | { readonly client: NightPresenceRedisClient };

function scopeKey(houseId: string, nightId: string): string {
  return `between-moves:night-presence:${houseId}:${nightId}`;
}

function storedEntry(value: unknown): StoredPresenceEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<StoredPresenceEntry>;
  if (
    typeof candidate.clientId !== 'string' ||
    typeof candidate.displayName !== 'string' ||
    typeof candidate.signature !== 'string' ||
    typeof candidate.expiresAt !== 'string' ||
    Number.isNaN(Date.parse(candidate.expiresAt))
  ) {
    return null;
  }
  return candidate as StoredPresenceEntry;
}

function publicIdentity(entry: StoredPresenceEntry): SignedRealtimePresence {
  return {
    clientId: entry.clientId,
    displayName: entry.displayName,
    signature: entry.signature,
  };
}

/** [BM-039] Shared, expiring Night presence for serverless and multi-instance deployments. */
export class UpstashNightPresenceStore implements NightPresenceRepository {
  private readonly client: NightPresenceRedisClient;

  constructor(options: UpstashNightPresenceStoreOptions) {
    this.client = 'client' in options ? options.client : createFailFastRedis(options);
  }

  private async snapshot(key: string, at: Date): Promise<NightPresenceSnapshot> {
    const stored = await this.client.hgetall<Record<string, unknown>>(key);
    const expiredOrInvalid: string[] = [];
    const byClient = new Map<string, StoredPresenceEntry>();

    for (const [leaseId, value] of Object.entries(stored ?? {})) {
      const entry = storedEntry(value);
      if (entry === null || Date.parse(entry.expiresAt) <= at.getTime()) {
        expiredOrInvalid.push(leaseId);
        continue;
      }
      const existing = byClient.get(entry.clientId);
      if (existing === undefined || Date.parse(existing.expiresAt) <= Date.parse(entry.expiresAt)) {
        byClient.set(entry.clientId, entry);
      }
    }

    if (expiredOrInvalid.length > 0) await this.client.hdel(key, ...expiredOrInvalid);

    return {
      members: [...byClient.values()]
        .sort(
          (left, right) =>
            left.displayName.localeCompare(right.displayName) ||
            left.clientId.localeCompare(right.clientId),
        )
        .map(publicIdentity),
    };
  }

  async read(
    context: AuthorizationContext,
    nightId: string,
    at: Date,
  ): Promise<NightPresenceSnapshot> {
    return this.snapshot(scopeKey(context.houseId, nightId), at);
  }

  async enter(
    context: AuthorizationContext,
    nightId: string,
    entry: NightPresenceEntry,
    at: Date,
  ): Promise<NightPresenceSnapshot> {
    if (entry.clientId !== context.viewerId) throw new Error('Presence context mismatch');
    const key = scopeKey(context.houseId, nightId);
    await this.client.hset(key, {
      [entry.leaseId]: {
        clientId: entry.clientId,
        displayName: entry.displayName,
        signature: entry.signature,
        expiresAt: entry.expiresAt.toISOString(),
      } satisfies StoredPresenceEntry,
    });
    await this.client.expire(key, KEY_TTL_SECONDS);
    return this.snapshot(key, at);
  }

  async leave(
    context: AuthorizationContext,
    nightId: string,
    lease: { readonly clientId: string; readonly leaseId: string },
    at: Date,
  ): Promise<NightPresenceSnapshot> {
    if (lease.clientId !== context.viewerId) throw new Error('Presence context mismatch');
    const key = scopeKey(context.houseId, nightId);
    const stored = await this.client.hgetall<Record<string, unknown>>(key);
    const entry = storedEntry(stored?.[lease.leaseId]);
    if (entry !== null && entry.clientId !== lease.clientId) {
      throw new Error('Presence context mismatch');
    }
    if (entry !== null) await this.client.hdel(key, lease.leaseId);
    return this.snapshot(key, at);
  }

  readPublic(houseId: string, nightId: string, at: Date): Promise<NightPresenceSnapshot> {
    return this.snapshot(scopeKey(houseId, nightId), at);
  }
}
