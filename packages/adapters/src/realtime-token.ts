import {
  DomainError,
  REALTIME_TOKEN_TTL_MS,
  realtimeChannelOperations,
  type IssuedRealtimeToken,
  type RealtimeChannelOperation,
  type RealtimeTokenIssueInput,
  type RealtimeTokenIssuer,
} from '@between-moves/domain';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_VERSION = 1;
const CHANNEL_ID_LENGTH = 22;

export interface HmacRealtimeTokenIssuerOptions {
  readonly appId: string;
  readonly serverKey: string;
  readonly publicKey: string;
  readonly ttlMs?: number;
  readonly random?: () => Buffer;
}

export interface RealtimeCapabilityTokenPayload {
  readonly v: typeof TOKEN_VERSION;
  readonly appId: string;
  readonly clientId: string;
  readonly iat: number;
  readonly exp: number;
  readonly nonce: string;
  readonly capability: Readonly<Record<string, readonly RealtimeChannelOperation[]>>;
  readonly presence: { readonly displayName: string };
}

function keyMaterial(serverKey: string, purpose: string): Buffer {
  return createHash('sha256')
    .update(`between-moves:${purpose}\0`, 'utf8')
    .update(serverKey, 'utf8')
    .digest();
}

function unixSeconds(value: Date): number {
  if (Number.isNaN(value.getTime())) {
    throw new DomainError('validation_failed', 'Realtime token timestamp is invalid');
  }
  return Math.floor(value.getTime() / 1_000);
}

function opaqueChannelId(serverKey: string, parts: readonly string[]): string {
  const hmac = createHmac('sha256', keyMaterial(serverKey, 'realtime-channel'));
  hmac.update(parts.join('\0'));
  return hmac.digest('base64url').slice(0, CHANNEL_ID_LENGTH);
}

function sign(serverKey: string, payload: string): Buffer {
  return createHmac('sha256', keyMaterial(serverKey, 'realtime-token')).update(payload).digest();
}

function presenceSignature(
  serverKey: string,
  input: {
    readonly clientId: string;
    readonly displayName: string;
    readonly iat: number;
    readonly nightChannel: string;
  },
): string {
  return createHmac('sha256', keyMaterial(serverKey, 'realtime-presence'))
    .update(`${input.clientId}\0${input.displayName}\0${String(input.iat)}\0${input.nightChannel}`)
    .digest('base64url');
}

function encodeToken(serverKey: string, payload: RealtimeCapabilityTokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(serverKey, body).toString('base64url')}`;
}

function isChannelOperation(value: unknown): value is RealtimeChannelOperation {
  return value === 'presence' || value === 'subscribe';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseCapability(value: unknown): RealtimeCapabilityTokenPayload['capability'] {
  if (!isRecord(value)) {
    throw new DomainError('validation_failed', 'Realtime token capability is invalid');
  }
  return Object.fromEntries(
    Object.entries(value).map(([channel, operations]) => {
      if (!Array.isArray(operations) || !operations.every(isChannelOperation)) {
        throw new DomainError('validation_failed', 'Realtime token capability is invalid');
      }
      return [channel, operations];
    }),
  );
}

function parsePayload(value: unknown): RealtimeCapabilityTokenPayload {
  if (!isRecord(value) || !isRecord(value.presence)) {
    throw new DomainError('validation_failed', 'Realtime token payload is invalid');
  }
  const { presence } = value;
  if (
    value.v !== TOKEN_VERSION ||
    typeof value.appId !== 'string' ||
    typeof value.clientId !== 'string' ||
    typeof value.iat !== 'number' ||
    typeof value.exp !== 'number' ||
    typeof value.nonce !== 'string' ||
    typeof presence.displayName !== 'string'
  ) {
    throw new DomainError('validation_failed', 'Realtime token payload is invalid');
  }
  return {
    v: TOKEN_VERSION,
    appId: value.appId,
    clientId: value.clientId,
    iat: value.iat,
    exp: value.exp,
    nonce: value.nonce,
    capability: parseCapability(value.capability),
    presence: { displayName: presence.displayName },
  };
}

/** [BM-037] Inspect a signed capability token; REALTIME_SERVER_KEY stays server-side. */
export function inspectRealtimeCapabilityToken(
  token: string,
  serverKey: string,
  now: Date = new Date(),
): RealtimeCapabilityTokenPayload {
  const separator = token.lastIndexOf('.');
  if (separator <= 0 || separator === token.length - 1) {
    throw new DomainError('validation_failed', 'Realtime token is invalid');
  }
  const body = token.slice(0, separator);
  const mac = Buffer.from(token.slice(separator + 1), 'base64url');
  const expected = sign(serverKey, body);
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) {
    throw new DomainError('validation_failed', 'Realtime token is invalid');
  }
  try {
    const payload = parsePayload(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')));
    if (payload.exp <= unixSeconds(now)) {
      throw new DomainError('validation_failed', 'Realtime token is invalid');
    }
    return payload;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError('validation_failed', 'Realtime token is invalid', { cause: error });
  }
}

/** [BM-037] HMAC opaque Night/Game channel IDs; client payload exposes publicKey only. */
export class HmacRealtimeTokenIssuer implements RealtimeTokenIssuer {
  private readonly appId: string;
  private readonly serverKey: string;
  private readonly publicKey: string;
  private readonly ttlMs: number;
  private readonly random: () => Buffer;

  constructor(options: HmacRealtimeTokenIssuerOptions) {
    if (options.publicKey === options.serverKey) {
      throw new Error('Realtime public key must differ from the server key');
    }
    this.appId = options.appId;
    this.serverKey = options.serverKey;
    this.publicKey = options.publicKey;
    this.ttlMs = options.ttlMs ?? REALTIME_TOKEN_TTL_MS;
    this.random = options.random ?? (() => randomBytes(16));
  }

  issue(input: RealtimeTokenIssueInput): IssuedRealtimeToken {
    const iat = unixSeconds(input.issuedAt);
    const expiresAt = new Date(input.issuedAt.getTime() + this.ttlMs);
    const nightChannel = opaqueChannelId(this.serverKey, ['night', input.houseId, input.nightId]);
    const games = input.gameIds.map((gameId) => ({
      gameId,
      channel: opaqueChannelId(this.serverKey, ['game', input.houseId, gameId]),
    }));
    const capability = {
      [nightChannel]: realtimeChannelOperations('night'),
      ...Object.fromEntries(games.map((game) => [game.channel, realtimeChannelOperations('game')])),
    };
    const payload: RealtimeCapabilityTokenPayload = {
      v: TOKEN_VERSION,
      appId: this.appId,
      clientId: input.clientId,
      iat,
      exp: unixSeconds(expiresAt),
      nonce: this.random().toString('base64url'),
      capability,
      presence: { displayName: input.displayName },
    };
    const token = encodeToken(this.serverKey, payload);
    const issued: IssuedRealtimeToken = {
      token,
      expiresAt,
      clientId: input.clientId,
      publicKey: this.publicKey,
      channels: { night: nightChannel, games },
      presence: {
        clientId: input.clientId,
        displayName: input.displayName,
        signature: presenceSignature(this.serverKey, {
          clientId: input.clientId,
          displayName: input.displayName,
          iat,
          nightChannel,
        }),
      },
    };
    if (JSON.stringify(issued).includes(this.serverKey)) {
      throw new Error('Realtime token payload must not contain the server key');
    }
    return issued;
  }
}
