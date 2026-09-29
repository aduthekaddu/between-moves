import { generateClientCommandId } from '../h/[houseId]/games/[gameId]/client-command-id';

export interface CommandOutcome {
  readonly ok: boolean;
  readonly status: number;
  /** Parsed JSON body, or `null` for empty and non-JSON responses. */
  readonly body: unknown;
}

/** A fresh key for commands that accept `Idempotency-Key`, so a retried click never doubles up. */
export function newIdempotencyKey(): string {
  return generateClientCommandId();
}

/** The `detail` of a problem response, when the server sent one worth showing. */
export function problemDetail(body: unknown): string | null {
  if (body === null || typeof body !== 'object' || !('detail' in body)) return null;
  return typeof body.detail === 'string' && body.detail.trim() !== '' ? body.detail : null;
}

/**
 * POST one House command to a same-origin route. The browser adds the Origin header the
 * command handlers check; network failures surface as status 0 so callers can offer a retry.
 */
export async function postHouseCommand(
  url: string,
  options: { readonly body?: unknown; readonly idempotencyKey?: string } = {},
): Promise<CommandOutcome> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey !== undefined) headers['Idempotency-Key'] = options.idempotencyKey;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    let body: unknown = null;
    if (text !== '') {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = null;
      }
    }
    return { ok: response.ok, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}
