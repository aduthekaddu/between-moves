import { betterAuth } from 'better-auth';
import { getConfig } from '../config';
import { createBetterAuthOptions } from './auth-options';
import { getDatabase } from './database';
import { getMagicLinkDeliveryQueue } from './magic-link';
import { getLogger } from './logger';

function createAuth() {
  return betterAuth(
    createBetterAuthOptions({
      config: getConfig(),
      database: getDatabase().pool,
      logger: getLogger(),
      queueMagicLink: getMagicLinkDeliveryQueue(),
    }),
  );
}

export type Auth = ReturnType<typeof createAuth>;

const globalAuth = globalThis as typeof globalThis & {
  betweenMovesAuth?: Auth;
};

export function getAuth(): Auth {
  globalAuth.betweenMovesAuth ??= createAuth();
  return globalAuth.betweenMovesAuth;
}
