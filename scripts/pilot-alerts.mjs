#!/usr/bin/env node
/** [BM-052] One poll of the four pilot alarms. Run every minute with central JSONL logs. */
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const signalNames = Object.freeze([
  'stale_outbox',
  'failed_move_writes',
  'cross_house_authz',
  'db_saturation',
]);

export function evaluateAlerts(input) {
  const alerts = [];
  if (input.outbox_age_seconds >= 300) alerts.push('stale_outbox');
  if (input.failed_move_writes > 0) alerts.push('failed_move_writes');
  if (input.cross_house_authz > 0) alerts.push('cross_house_authz');
  if (input.db_saturation >= 0.8) alerts.push('db_saturation');
  return alerts;
}

export async function countLogSignals(path, since, open = createReadStream) {
  const counts = { failed_move_writes: 0, cross_house_authz: 0 };
  const lines = createInterface({ input: open(path), crlfDelay: Infinity });
  for await (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const timestamp = Date.parse(entry.ts);
    if (!Number.isFinite(timestamp) || timestamp < since) continue;
    if (entry.event === 'game.move-write-failed' && entry.outcome === 'error') {
      counts.failed_move_writes += 1;
    }
    if (entry.event === 'house.authorization-denied' && entry.data?.cross_house === true) {
      counts.cross_house_authz += 1;
    }
  }
  return counts;
}

const databaseSql = `select json_build_object(
  'outbox_age_seconds', coalesce((select extract(epoch from now()-min(created_at))
    from outbox_events where sent_at is null and failed_at is null), 0),
  'db_saturation', (select count(*)::numeric /
    nullif(current_setting('max_connections')::numeric, 0)
    from pg_stat_activity where datname = current_database())
)::text`;

export function queryDatabase() {
  return new Promise((resolveQuery, reject) => {
    const child = spawn('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', databaseSql], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    });
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error('Pilot database signal query failed'));
      else {
        try {
          resolveQuery(JSON.parse(output.trim()));
        } catch {
          reject(new Error('Pilot database signal output is invalid'));
        }
      }
    });
  });
}

export function validateAlertConfig(env, testFire) {
  if (!env.ALERT_WEBHOOK_URL) throw new Error('ALERT_WEBHOOK_URL is required');
  const url = new URL(env.ALERT_WEBHOOK_URL);
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))
  ) {
    throw new Error('ALERT_WEBHOOK_URL must use HTTPS');
  }
  if (testFire !== undefined && !signalNames.includes(testFire)) {
    throw new Error(`Unknown test-fire signal: ${testFire}`);
  }
  if (testFire === undefined) {
    if (!env.PILOT_LOG_FILE) throw new Error('PILOT_LOG_FILE is required');
    if (!env.PGHOST || !env.PGUSER || !env.PGDATABASE || env.PGSSLMODE !== 'require') {
      throw new Error('PGHOST, PGUSER, PGDATABASE and PGSSLMODE=require are required');
    }
  }
  return url;
}

export async function runAlerts({
  env = process.env,
  testFire,
  now = Date.now(),
  query = queryDatabase,
  logs = countLogSignals,
  send = fetch,
} = {}) {
  const url = validateAlertConfig(env, testFire);
  const signals =
    testFire === undefined
      ? { ...(await query()), ...(await logs(resolve(env.PILOT_LOG_FILE), now - 5 * 60_000)) }
      : null;
  const firing = testFire === undefined ? evaluateAlerts(signals) : [testFire];
  for (const signal of firing) {
    const response = await send(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        event: 'pilot.alert',
        signal,
        status: 'firing',
        test_fire: testFire !== undefined,
        observed_at: new Date(now).toISOString(),
        ...(signals
          ? {
              value:
                signals[
                  {
                    stale_outbox: 'outbox_age_seconds',
                    failed_move_writes: 'failed_move_writes',
                    cross_house_authz: 'cross_house_authz',
                    db_saturation: 'db_saturation',
                  }[signal]
                ],
            }
          : {}),
      }),
    });
    if (!response.ok) throw new Error(`Alert route rejected ${signal}: HTTP ${response.status}`);
  }
  return { event: 'pilot.alert-poll', firing, signals, test_fire: testFire ?? null };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const testFire = process.argv.find((arg) => arg.startsWith('--test-fire='))?.slice(12);
  runAlerts({ testFire })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
