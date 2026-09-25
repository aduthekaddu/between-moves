import { inspectRealtimeCapabilityToken, opaqueRealtimeChannelId } from '@between-moves/adapters';
import { realtimeTokenHidesRootKey } from '@between-moves/contracts';
import {
  AuthenticationRequiredError,
  DomainError,
  type AuthenticatedViewer,
  type GamePosition,
} from '@between-moves/domain';
import type { RealtimeMetricStubs } from '@between-moves/observability';
import { z } from 'zod';
import type { RealtimeTokenRateLimit } from '../kernel/realtime-token-rate-limit';
import { problemResponse } from '../kernel/request';
import type { RealtimeNightFanout } from './realtime-fanout';

const identifier = z.string().uuid();

export interface GameRealtimeDependencies {
  readonly expectedOrigin: string;
  readonly serverKey: string;
  readonly requireViewer: (request: Request) => Promise<AuthenticatedViewer>;
  readonly readPosition: (
    request: Request,
    houseId: string,
    gameId: string,
  ) => Promise<GamePosition | null>;
  readonly limitToken: RealtimeTokenRateLimit;
  readonly issueToken: (input: {
    houseId: string;
    gameId: string;
    clientId: string;
    displayName: string;
    issuedAt: Date;
  }) => { readonly token: string; readonly expiresAt: Date; readonly channel: string };
  readonly fanout: RealtimeNightFanout;
  readonly metrics: RealtimeMetricStubs;
  readonly clock: { now(): Date };
}

function unavailable(request: Request): Response {
  return problemResponse(request, 404, 'not_found', 'Not found', 'The live Game is unavailable.');
}

function validIds(houseId: string, gameId: string): boolean {
  return identifier.safeParse(houseId).success && identifier.safeParse(gameId).success;
}

/** [BM-043] Issue a subscribe-only capability after the same House read as the board. */
export function createGameRealtimeTokenHandler(dependencies: GameRealtimeDependencies) {
  return async (request: Request, houseId: string, gameId: string): Promise<Response> => {
    if (request.headers.get('origin') !== dependencies.expectedOrigin) {
      return problemResponse(
        request,
        403,
        'origin_rejected',
        'Origin rejected',
        'Request origin is not allowed.',
      );
    }
    if (!validIds(houseId, gameId)) return unavailable(request);
    let viewer: AuthenticatedViewer;
    try {
      viewer = await dependencies.requireViewer(request);
    } catch (error) {
      if (!(error instanceof AuthenticationRequiredError)) throw error;
      return problemResponse(
        request,
        401,
        'unauthenticated',
        'Authentication required',
        'Sign in to watch this Game.',
      );
    }
    const limited = await dependencies.limitToken(request, viewer.userId);
    if (!limited.allowed) {
      return problemResponse(
        request,
        429,
        'rate_limited',
        'Too many realtime tokens',
        'Try again shortly.',
        {
          headers: { 'Retry-After': String(limited.retryAfterSeconds) },
        },
      );
    }
    const position = await dependencies.readPosition(request, houseId, gameId);
    if (position?.mode !== 'live') return unavailable(request);
    const issued = dependencies.issueToken({
      houseId,
      gameId,
      clientId: viewer.userId,
      displayName: viewer.displayName,
      issuedAt: dependencies.clock.now(),
    });
    const body = {
      token: issued.token,
      expiresAt: issued.expiresAt.toISOString(),
      channel: issued.channel,
    };
    if (!realtimeTokenHidesRootKey(body, dependencies.serverKey)) {
      throw new Error('Realtime token payload contained the server key');
    }
    try {
      dependencies.metrics.incrementRealtimeTokenIssue();
    } catch {
      // Issuance remains successful when diagnostics are unavailable.
    }
    return Response.json(body, { headers: { 'Cache-Control': 'private, no-store' } });
  };
}

/** [BM-043] Authenticate both the session and the exact Game channel on every connection. */
export function createGameRealtimeStreamHandler(dependencies: GameRealtimeDependencies) {
  return async (request: Request, houseId: string, gameId: string): Promise<Response> => {
    if (!validIds(houseId, gameId)) return unavailable(request);
    let viewer: AuthenticatedViewer;
    try {
      viewer = await dependencies.requireViewer(request);
    } catch (error) {
      if (!(error instanceof AuthenticationRequiredError)) throw error;
      return problemResponse(
        request,
        401,
        'unauthenticated',
        'Authentication required',
        'Sign in to watch this Game.',
      );
    }
    const position = await dependencies.readPosition(request, houseId, gameId);
    if (position?.mode !== 'live') return unavailable(request);
    const token = new URL(request.url).searchParams.get('token');
    if (token === null) {
      return problemResponse(
        request,
        403,
        'forbidden',
        'Forbidden',
        'A Game subscription is required.',
      );
    }
    let expiresAt: number;
    let channel: string;
    try {
      const payload = inspectRealtimeCapabilityToken(
        token,
        dependencies.serverKey,
        dependencies.clock.now(),
      );
      channel = opaqueRealtimeChannelId(dependencies.serverKey, 'game', houseId, gameId);
      if (
        payload.clientId !== viewer.userId ||
        payload.capability[channel]?.includes('subscribe') !== true
      ) {
        throw new DomainError('authorization_denied', 'Game subscription is out of scope');
      }
      expiresAt = payload.exp * 1_000;
    } catch {
      return problemResponse(
        request,
        403,
        'forbidden',
        'Forbidden',
        'A Game subscription is required.',
      );
    }

    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        unsubscribe = dependencies.fanout.subscribeGame(channel, (envelope) => {
          if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(envelope)}\n\n`));
        });
        heartbeat = setInterval(() => {
          if (!closed) controller.enqueue(encoder.encode(': heartbeat\n\n'));
        }, 30_000);
        expiry = setTimeout(
          () => {
            if (closed) return;
            closed = true;
            unsubscribe?.();
            if (heartbeat !== undefined) clearInterval(heartbeat);
            controller.close();
          },
          Math.max(0, expiresAt - dependencies.clock.now().getTime()),
        );
        controller.enqueue(encoder.encode(': attached\n\n'));
      },
      cancel() {
        closed = true;
        unsubscribe?.();
        if (heartbeat !== undefined) clearInterval(heartbeat);
        if (expiry !== undefined) clearTimeout(expiry);
      },
    });
    return new Response(stream, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/event-stream',
        'Referrer-Policy': 'no-referrer',
        Connection: 'keep-alive',
      },
    });
  };
}
