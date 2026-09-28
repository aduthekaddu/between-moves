#!/usr/bin/env node
/** [BM-052] Generate an aggregate, private six-view pilot dashboard from live sources. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { queryDatabase } from './pilot-alerts.mjs';

const productSql = fileURLToPath(new URL('../ops/product-metrics.sql', import.meta.url));

export async function summarizeLogs(path, since, open = createReadStream) {
  const result = {
    accepted_moves: 0,
    failed_move_writes: 0,
    realtime_tokens: 0,
    cross_house_denials: 0,
    store_failures: 0,
    db_failures: 0,
    move_latencies: [],
    delivery: null,
    realtime: null,
  };
  let latestWorkerTimestamp = -Infinity;
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
    if (entry.event === 'game.move-accepted') {
      result.accepted_moves += 1;
      if (Number.isFinite(entry.duration_ms)) result.move_latencies.push(entry.duration_ms);
    }
    if (entry.event === 'game.move-write-failed') result.failed_move_writes += 1;
    if (entry.event === 'realtime.token-issued') result.realtime_tokens += 1;
    if (entry.event === 'house.authorization-denied' && entry.data?.cross_house === true) {
      result.cross_house_denials += 1;
    }
    if (entry.event === 'rate-limit.store-unavailable') result.store_failures += 1;
    if (entry.event === 'db.connection-failed') result.db_failures += 1;
    if (
      entry.event === 'delivery.outbox-dispatch-complete' &&
      entry.data &&
      typeof entry.data === 'object' &&
      timestamp >= latestWorkerTimestamp
    ) {
      result.delivery = entry.data;
      result.realtime = entry.data;
      latestWorkerTimestamp = timestamp;
    }
  }
  return result;
}

function productMetrics() {
  return new Promise((resolveMetrics, reject) => {
    const child = spawn(
      'psql',
      ['-X', '-A', '-t', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-f', productSql],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 },
    );
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error('Pilot product metric query failed'));
      try {
        const metrics = output
          .trim()
          .split('\n')
          .map((line) => {
            const [metric, rawValue, rawSample] = line.split('|');
            const value = Number(rawValue);
            const sample = Number(rawSample);
            if (!/^[a-z0-9_]+$/.test(metric) || !Number.isFinite(value) || !Number.isFinite(sample))
              throw new Error('Invalid product metric output');
            return { metric, value, sample };
          });
        resolveMetrics(metrics);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function number(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(Math.round(value * 100) / 100)
    : 'n/a';
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const ordered = values.toSorted((a, b) => a - b);
  return ordered[Math.ceil(fraction * ordered.length) - 1];
}

export function renderDashboard({ timestamp, signals, logs, products }) {
  const panels = [
    [
      'Move',
      [
        ['Accepted in 28 days', logs.accepted_moves],
        ['p95 accept latency (ms)', percentile(logs.move_latencies, 0.95)],
        ['Unexpected write failures', logs.failed_move_writes],
      ],
    ],
    [
      'Delivery',
      [
        ['Oldest pending outbox (s)', signals.outbox_age_seconds],
        ['Latest worker retries', logs.delivery?.outbox_retry_total],
        ['Latest email failure rate', logs.delivery?.email_failure_rate],
      ],
    ],
    [
      'Realtime',
      [
        ['Tokens issued in 28 days', logs.realtime_tokens],
        [
          'Latest publish p95 (ms)',
          percentile(logs.realtime?.realtime_publish_delay_ms ?? [], 0.95),
        ],
      ],
    ],
    [
      'Security',
      [
        ['Cross-House denials', logs.cross_house_denials],
        ['Rate-limit store failures', logs.store_failures],
      ],
    ],
    [
      'Infrastructure',
      [
        ['Database saturation', signals.db_saturation],
        ['Database connection failures', logs.db_failures],
      ],
    ],
    [
      'Product',
      products.map(({ metric, value, sample }) => [`${metric} (n=${number(sample)})`, value]),
    ],
  ];
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Between Moves pilot dashboard</title><style>body{font:1rem system-ui;max-width:80rem;margin:auto;padding:2rem;background:#f7f2e8;color:#17233b}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(18rem,1fr));gap:1rem}section{background:white;padding:1rem;border:1px solid #b7b7b7;border-radius:.5rem}dt{font-size:.9rem}dd{font-size:1.4rem;font-weight:700;margin:0 0 1rem}small{display:block;margin-bottom:2rem}</style><h1>Between Moves pilot dashboard</h1><small>Generated ${timestamp}; aggregate values only. Worker snapshots are per dispatch.</small><main>${panels.map(([title, rows]) => `<section><h2>${title}</h2><dl>${rows.map(([label, value]) => `<dt>${label}</dt><dd>${number(value)}</dd>`).join('')}</dl></section>`).join('')}</main></html>\n`;
}

export async function runDashboard({
  env = process.env,
  now = Date.now(),
  query = queryDatabase,
  readLogs = summarizeLogs,
  readProducts = productMetrics,
} = {}) {
  if (
    !env.PILOT_LOG_FILE ||
    !env.PILOT_DASHBOARD_PATH ||
    !env.PGHOST ||
    !env.PGUSER ||
    !env.PGDATABASE ||
    env.PGSSLMODE !== 'require'
  ) {
    throw new Error(
      'PILOT_LOG_FILE, PILOT_DASHBOARD_PATH and read-only TLS PG* settings are required',
    );
  }
  const [signals, logs, products] = await Promise.all([
    query(),
    readLogs(resolve(env.PILOT_LOG_FILE), now - 28 * 86_400_000),
    readProducts(),
  ]);
  const output = resolve(env.PILOT_DASHBOARD_PATH);
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(
        renderDashboard({ timestamp: new Date(now).toISOString(), signals, logs, products }),
      );
    } finally {
      await file.close();
    }
    await rename(temporary, output);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDashboard()
    .then((output) => console.log(JSON.stringify({ event: 'pilot.dashboard-written', output })))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
