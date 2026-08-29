import { generateUuidV7 } from '@between-moves/adapters';
import type { Database } from '@between-moves/db';
import type { StructuredLogger } from '@between-moves/observability';
import type { BetterAuthOptions } from 'better-auth';
import type { AppConfig } from '../config';

const DAY_SECONDS = 24 * 60 * 60;

export interface BetterAuthOptionsDependencies {
  readonly config: AppConfig;
  readonly database: Database['pool'];
  readonly logger: StructuredLogger;
}

/** [BM-007] [DR-ID-02] Database-backed Better Auth configuration at the web root. */
export function createBetterAuthOptions({
  config,
  database,
  logger,
}: BetterAuthOptionsDependencies): BetterAuthOptions {
  return {
    appName: 'Between Moves',
    baseURL: config.appOrigin.origin,
    secret: config.betterAuthSecret,
    database,
    trustedOrigins: [config.appOrigin.origin],
    user: {
      modelName: 'users',
      fields: {
        name: 'display_name',
        emailVerified: 'email_verified',
        image: 'image_url',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    session: {
      modelName: 'sessions',
      expiresIn: 7 * DAY_SECONDS,
      updateAge: DAY_SECONDS,
      cookieCache: { enabled: false },
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    advanced: {
      useSecureCookies: true,
      cookiePrefix: 'between-moves',
      defaultCookieAttributes: {
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      },
      database: {
        generateId: () => generateUuidV7(),
      },
    },
    databaseHooks: {
      session: {
        create: {
          async after(session) {
            logger.log({
              level: 'info',
              requestId: 'auth-provider',
              actorId: session.userId,
              houseId: null,
              gameId: null,
              commandId: null,
              event: 'identity.session.created',
              outcome: 'success',
              durationMs: 0,
            });
          },
        },
      },
    },
    logger: { disabled: true },
    telemetry: { enabled: false },
  };
}
