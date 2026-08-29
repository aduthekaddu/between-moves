import { createStructuredLogger, type StructuredLogger } from '@between-moves/observability';

const globalLogger = globalThis as typeof globalThis & {
  betweenMovesLogger?: StructuredLogger;
};

export function getLogger(): StructuredLogger {
  globalLogger.betweenMovesLogger ??= createStructuredLogger({
    clock: { now: () => new Date() },
    sink: (line) => process.stdout.write(`${line}\n`),
  });
  return globalLogger.betweenMovesLogger;
}
