import { generateMagicLinkToken, generateUuidV7 } from '@between-moves/adapters';
import type { QueueMagicLinkDelivery } from '@between-moves/application';
import type { Database } from '@between-moves/db';
import type { StructuredLogger } from '@between-moves/observability';
import type { BetterAuthOptions } from 'better-auth';
import { magicLink } from 'better-auth/plugins';
import type { AppConfig } from '../config';
import { invitationReturnPath } from '../kernel/invitation-return-path';
import { createMagicLinkPurposeProof } from './magic-link-purpose';

const DAY_SECONDS = 24 * 60 * 60;
const MAGIC_LINK_TTL_SECONDS = 15 * 60;

export interface BetterAuthOptionsDependencies {
  readonly config: AppConfig;
  readonly database: Database['pool'];
  readonly logger: StructuredLogger;
  readonly queueMagicLink: QueueMagicLinkDelivery;
}

/** [BM-007/008] [DR-ID-02..03] Database-backed passwordless auth at the web root. */
export function createBetterAuthOptions({
  config,
  database,
  logger,
  queueMagicLink,
}: BetterAuthOptionsDependencies) {
  // Browsers discard Secure cookies over local HTTP; deployed environments remain secure.
  const useSecureCookies = config.environment !== 'local' || config.appOrigin.protocol === 'https:';

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
    account: {
      modelName: 'accounts',
      fields: {
        accountId: 'account_id',
        providerId: 'provider_id',
        userId: 'user_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      modelName: 'verification',
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_TTL_SECONDS,
        storeToken: 'hashed',
        generateToken: generateMagicLinkToken,
        async sendMagicLink({ email, token, metadata }) {
          const purpose = metadata?.flow === 'recovery' ? 'recovery' : 'signin';
          const callbackPath =
            purpose === 'recovery' ? '/api/auth/recovery/callback' : '/api/auth/callback';
          const signInUrl = new URL(callbackPath, config.appOrigin);
          signInUrl.searchParams.set('token', token);
          signInUrl.searchParams.set(
            'proof',
            createMagicLinkPurposeProof(config.betterAuthSecret, purpose, token),
          );
          const returnTo = invitationReturnPath(metadata?.returnTo);
          if (purpose === 'signin' && returnTo !== null) {
            signInUrl.searchParams.set('returnTo', returnTo);
          }
          await queueMagicLink({ email, signInUrl: signInUrl.toString() });
        },
      }),
    ],
    advanced: {
      useSecureCookies,
      cookiePrefix: 'between-moves',
      defaultCookieAttributes: {
        secure: useSecureCookies,
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
  } satisfies BetterAuthOptions;
}
