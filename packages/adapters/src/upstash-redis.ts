import { Redis } from '@upstash/redis';

/** Upper bound for one Upstash REST command, including connection setup. */
const REQUEST_TIMEOUT_MS = 500;

/**
 * [DR-SEC-04] [BM-039] Upstash client for optional shared stores. Callers degrade (in-process
 * limiter, fail-open, or empty presence) when a command rejects, so an outage must reject quickly
 * instead of sleeping through the SDK's default five exponential retries (~4.3s).
 */
export function createFailFastRedis(credentials: {
  readonly url: string;
  readonly token: string;
}): Redis {
  return new Redis({
    url: credentials.url,
    token: credentials.token,
    retry: { retries: 0 },
    // Must be a factory: the SDK rethrows the abort for a signal factory, but turns an aborted
    // AbortSignal instance into a fabricated successful "Aborted" result.
    signal: () => AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}
