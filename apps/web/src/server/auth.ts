import { betterAuth } from 'better-auth';
import { getConfig } from '../config';
import { createBetterAuthOptions } from './auth-options';
import { getDatabase } from './database';
import { getLogger } from './logger';

export type Auth = ReturnType<typeof betterAuth>;

const globalAuth = globalThis as typeof globalThis & {
  betweenMovesAuth?: Auth;
};

export function getAuth(): Auth {
  globalAuth.betweenMovesAuth ??= betterAuth(
    createBetterAuthOptions({
      config: getConfig(),
      database: getDatabase().pool,
      logger: getLogger(),
    }),
  );
  return globalAuth.betweenMovesAuth;
}
