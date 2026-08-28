import { ConfigValidationError, loadConfig, type AppConfig } from './index';

interface StartupLogEntry {
  readonly ts: string;
  readonly level: 'info' | 'error';
  readonly request_id: null;
  readonly actor_id: 'anonymous';
  readonly house_id: null;
  readonly game_id: null;
  readonly command_id: null;
  readonly event: 'app.started' | 'app.startup-failed';
  readonly outcome: 'success' | 'error';
  readonly duration_ms: number;
  readonly environment?: string;
  readonly build_id?: string;
  readonly missing_keys?: readonly string[];
  readonly invalid_keys?: readonly string[];
}

export interface StartupLogger {
  info(entry: StartupLogEntry): void;
  error(entry: StartupLogEntry): void;
}

const jsonLogger: StartupLogger = {
  info: (entry) => console.info(JSON.stringify(entry)),
  error: (entry) => console.error(JSON.stringify(entry)),
};

function baseEntry(startedAt: number) {
  return {
    ts: new Date().toISOString(),
    request_id: null,
    actor_id: 'anonymous' as const,
    house_id: null,
    game_id: null,
    command_id: null,
    duration_ms: Date.now() - startedAt,
  };
}

/** [BM-003] Validate before serving and never include configuration values in logs. */
export function startApplication(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  logger: StartupLogger = jsonLogger,
): AppConfig {
  const startedAt = Date.now();

  try {
    const config = loadConfig(environment);
    logger.info({
      ...baseEntry(startedAt),
      level: 'info',
      event: 'app.started',
      outcome: 'success',
      environment: config.environment,
      build_id: config.buildId,
    });
    return config;
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      logger.error({
        ...baseEntry(startedAt),
        level: 'error',
        event: 'app.startup-failed',
        outcome: 'error',
        missing_keys: error.missingKeys,
        invalid_keys: error.invalidKeys,
      });
    }
    throw error;
  }
}
