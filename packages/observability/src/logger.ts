const REDACTED = '[REDACTED]';
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const SENSITIVE_KEYS = new Set([
  'authorization',
  'chatbody',
  'cookie',
  'email',
  'emailaddress',
  'emailcontent',
  'gamenotebody',
  'password',
  'rootkey',
  'secret',
  'serverkey',
]);

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogOutcome = 'success' | 'rejected' | 'error';

export interface StructuredLogInput {
  readonly level: LogLevel;
  readonly requestId: string;
  readonly actorId: string | 'anonymous';
  readonly houseId: string | null;
  readonly gameId: string | null;
  readonly commandId: string | null;
  readonly event: string;
  readonly outcome: LogOutcome;
  readonly durationMs: number;
  readonly data?: unknown;
}

export interface StructuredLogger {
  log(input: StructuredLogInput): void;
}

export interface LogClock {
  now(): Date;
}

export interface StructuredLoggerOptions {
  readonly clock: LogClock;
  readonly sink: (line: string) => void;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return normalized.includes('token') || SENSITIVE_KEYS.has(normalized);
}

function redact(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return EMAIL.test(value) ? REDACTED : value;
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '[Circular]';

  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveKey(key) ? REDACTED : redact(item, seen),
    ]),
  );
}

/** [BM-005] DR-SEC-06 and operations §4.1 structured logging and redaction boundary. */
export function createStructuredLogger(options: StructuredLoggerOptions): StructuredLogger {
  return {
    log(input) {
      const line = {
        ts: options.clock.now().toISOString(),
        level: input.level,
        request_id: input.requestId,
        actor_id: input.actorId,
        house_id: input.houseId,
        game_id: input.gameId,
        command_id: input.commandId,
        event: input.event,
        outcome: input.outcome,
        duration_ms: input.durationMs,
        ...(input.data === undefined ? {} : { data: redact(input.data, new WeakSet()) }),
      };
      options.sink(JSON.stringify(line));
    },
  };
}
