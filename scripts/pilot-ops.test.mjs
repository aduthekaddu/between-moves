import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { Chess } from '../packages/adapters/node_modules/chess.js/dist/esm/chess.js';
import {
  countLogSignals,
  evaluateAlerts,
  runAlerts,
  signalNames,
  validateAlertConfig,
} from './pilot-alerts.mjs';
import { renderDashboard, runDashboard, summarizeLogs } from './pilot-dashboard.mjs';
import { runDrill, validateConfig, verifyReplay } from './restore-drill.mjs';

test('restore drill refuses non-staging and a pre-existing naming pattern', () => {
  const env = {
    APP_ENV: 'staging',
    RESTORE_DB_NAME: 'bm_restore_pilot',
    BACKUP_FILE: '/tmp/backup.dump',
    RESTORE_RECORD_PATH: '/tmp/record.json',
    RTO_TARGET_SECONDS: '900',
    PGHOST: 'db.staging.test',
    PGUSER: 'drill',
    PGSSLMODE: 'require',
  };
  assert.equal(validateConfig(env).rto, 900);
  assert.throws(() => validateConfig({ ...env, APP_ENV: 'production' }), /APP_ENV/);
  assert.throws(() => validateConfig({ ...env, RESTORE_DB_NAME: 'app' }), /RESTORE_DB_NAME/);
  assert.throws(() => validateConfig({ ...env, PGHOST: 'localhost' }), /staging database host/);
  assert.equal(validateConfig({ ...env, APP_ENV: 'local', PGHOST: '127.0.0.1' }).rto, 900);
  assert.throws(() => validateConfig({ ...env, APP_ENV: 'local' }), /Local rehearsal/);
});

test('replay checks each canonical move and final snapshot', () => {
  const chess = new Chess();
  const initial_fen = chess.fen();
  chess.move('e4');
  const fen_after = chess.fen();
  const game = {
    id: 'game',
    initial_fen,
    current_fen: fen_after,
    moves: [{ ply: 1, uci: 'e2e4', san: 'e4', fen_after }],
  };
  assert.equal(verifyReplay([game], Chess), 1);
  assert.throws(() => verifyReplay([{ ...game, current_fen: initial_fen }], Chess), /snapshot/);
  assert.throws(
    () => verifyReplay([{ ...game, moves: [{ ...game.moves[0], san: 'd4' }] }], Chess),
    /replay/,
  );
});

test('restore orchestration records a passing RTO and migration round trip', async () => {
  const directory = await mkdtemp('/tmp/bm052-restore-test-');
  const backup = join(directory, 'backup.dump');
  const recordPath = join(directory, 'record.json');
  await writeFile(backup, 'test fixture');
  const env = {
    APP_ENV: 'staging',
    RESTORE_DB_NAME: 'bm_restore_test',
    BACKUP_FILE: backup,
    RESTORE_RECORD_PATH: recordPath,
    RTO_TARGET_SECONDS: '60',
    PGHOST: 'db.staging.test',
    PGUSER: 'drill',
    PGSSLMODE: 'require',
  };
  const commands = [];
  const record = await runDrill(env, async (binary, args) => {
    commands.push([binary, ...args]);
    if (binary === 'psql' && args.includes('postgres')) return '';
    if (binary === 'psql' && args.at(-1).includes('move_sequence_gaps')) {
      return JSON.stringify({
        move_sequence_gaps: 0,
        standings_mismatches: 0,
        missing_scored_standings: 0,
        cross_house_rows: 0,
      });
    }
    if (binary === 'psql') return '[]';
    return '';
  });
  assert.equal(record.status, 'passed');
  assert.equal(record.within_rto, true);
  assert.equal(JSON.parse(await readFile(recordPath, 'utf8')).status, 'passed');
  assert.throws(() => validateConfig(env), /already exists/);
  assert.deepEqual(
    commands.filter(([binary]) => binary === 'pnpm').map((parts) => parts.at(-1)),
    ['down', 'up'],
  );
});

async function drillFixture(rto) {
  const directory = await mkdtemp('/tmp/bm052-restore-test-');
  const backup = join(directory, 'backup.dump');
  await writeFile(backup, 'test fixture');
  return {
    APP_ENV: 'staging',
    RESTORE_DB_NAME: 'bm_restore_test',
    BACKUP_FILE: backup,
    RESTORE_RECORD_PATH: join(directory, 'record.json'),
    RTO_TARGET_SECONDS: String(rto),
    PGHOST: 'db.staging.test',
    PGUSER: 'drill',
    PGSSLMODE: 'require',
  };
}

function drillRunner(integrity, delayMs = 0) {
  return async (binary, args) => {
    if (binary === 'pg_restore' && delayMs > 0) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    }
    if (binary === 'psql' && args.includes('postgres')) return '';
    if (binary === 'psql' && args.at(-1).includes('move_sequence_gaps')) {
      return JSON.stringify(integrity);
    }
    if (binary === 'psql') return '[]';
    return '';
  };
}

const cleanIntegrity = {
  move_sequence_gaps: 0,
  standings_mismatches: 0,
  missing_scored_standings: 0,
  cross_house_rows: 0,
};

test('restore drill fails and explains a clean restore that exceeds the RTO', async () => {
  const env = await drillFixture(1);
  await assert.rejects(runDrill(env, drillRunner(cleanIntegrity, 1_100)), /Restore drill failed/);
  const record = JSON.parse(await readFile(env.RESTORE_RECORD_PATH, 'utf8'));
  assert.equal(record.status, 'failed');
  assert.equal(record.within_rto, false);
  assert.ok(record.rto_seconds > 1);
  assert.match(record.error, /over the 1s RTO target/);
});

test('restore drill records an integrity failure without an RTO message', async () => {
  const env = await drillFixture(60);
  await assert.rejects(
    runDrill(env, drillRunner({ ...cleanIntegrity, cross_house_rows: 1 })),
    /Restore drill failed/,
  );
  const record = JSON.parse(await readFile(env.RESTORE_RECORD_PATH, 'utf8'));
  assert.equal(record.status, 'failed');
  assert.equal(record.within_rto, false);
  assert.equal(record.error, 'Restore integrity checks failed');
});

test('all four alerts fire from a recent signal and route as test-fires', async () => {
  assert.deepEqual(
    evaluateAlerts({
      outbox_age_seconds: 300,
      failed_move_writes: 1,
      cross_house_authz: 1,
      db_saturation: 0.8,
    }),
    signalNames,
  );
  assert.deepEqual(
    evaluateAlerts({
      outbox_age_seconds: 299,
      failed_move_writes: 0,
      cross_house_authz: 0,
      db_saturation: 0.79,
    }),
    [],
  );
  const payloads = [];
  for (const signal of signalNames) {
    await runAlerts({
      env: { ALERT_WEBHOOK_URL: 'https://alerts.example.test/pilot' },
      testFire: signal,
      now: Date.parse('2026-09-28T12:00:00Z'),
      send: async (_url, options) => {
        payloads.push(JSON.parse(options.body));
        return { ok: true };
      },
    });
  }
  assert.deepEqual(
    payloads.map((payload) => payload.signal),
    signalNames,
  );
  assert.ok(payloads.every((payload) => payload.test_fire && payload.status === 'firing'));
  assert.throws(
    () => validateAlertConfig({ ALERT_WEBHOOK_URL: 'http://remote.test' }, 'stale_outbox'),
    /HTTPS/,
  );
});

test('normal alert poll combines database and central logs and rejects route failure', async () => {
  const env = {
    ALERT_WEBHOOK_URL: 'https://alerts.example.test/pilot',
    PILOT_LOG_FILE: '/tmp/pilot.jsonl',
    PGHOST: 'db.staging.test',
    PGUSER: 'reader',
    PGDATABASE: 'app',
    PGSSLMODE: 'require',
  };
  const sent = [];
  const dependencies = {
    env,
    now: Date.parse('2026-09-28T12:00:00Z'),
    query: async () => ({ outbox_age_seconds: 300, db_saturation: 0.8 }),
    logs: async () => ({ failed_move_writes: 1, cross_house_authz: 1 }),
  };
  const result = await runAlerts({
    ...dependencies,
    send: async (_url, options) => {
      sent.push(JSON.parse(options.body));
      return { ok: true };
    },
  });
  assert.deepEqual(result.firing, signalNames);
  assert.deepEqual(
    sent.map(({ value }) => value),
    [300, 1, 1, 0.8],
  );
  assert.ok(sent.every(({ test_fire }) => test_fire === false));
  await assert.rejects(
    runAlerts({ ...dependencies, send: async () => ({ ok: false, status: 503 }) }),
    /route rejected/,
  );
});

test('central log scan counts only recent, structured failure signals', async () => {
  const lines = [
    null,
    { ts: '2026-09-28T11:59:00Z', event: 'game.move-write-failed', outcome: 'error' },
    {
      ts: '2026-09-28T11:59:00Z',
      event: 'house.authorization-denied',
      data: { cross_house: true },
    },
    { ts: '2026-09-28T11:50:00Z', event: 'game.move-write-failed', outcome: 'error' },
    {
      ts: '2026-09-28T11:59:00Z',
      event: 'house.authorization-denied',
      data: { cross_house: false },
    },
  ]
    .map(JSON.stringify)
    .join('\n');
  const counts = await countLogSignals('unused', Date.parse('2026-09-28T11:55:00Z'), () =>
    Readable.from([`${lines}\n`]),
  );
  assert.deepEqual(counts, { failed_move_writes: 1, cross_house_authz: 1 });
});

test('dashboard renders six aggregate views without log identities', async () => {
  const lines = [
    null,
    {
      ts: '2026-09-28T11:59:00Z',
      event: 'game.move-accepted',
      duration_ms: 42,
      actor_id: 'private-member-id',
    },
    {
      ts: '2026-09-28T11:59:00Z',
      event: 'delivery.outbox-dispatch-complete',
      data: { outbox_retry_total: 1, email_failure_rate: 0.1, realtime_publish_delay_ms: [12, 20] },
    },
    {
      ts: '2026-09-28T11:58:00Z',
      event: 'delivery.outbox-dispatch-complete',
      data: { outbox_retry_total: 99, email_failure_rate: 0.9, realtime_publish_delay_ms: [99] },
    },
  ]
    .map(JSON.stringify)
    .join('\n');
  const logs = await summarizeLogs('unused', Date.parse('2026-09-28T11:55:00Z'), () =>
    Readable.from([`${lines}\n`]),
  );
  assert.equal(logs.delivery.outbox_retry_total, 1);
  const input = {
    timestamp: '2026-09-28T12:00:00.000Z',
    signals: { outbox_age_seconds: 10, db_saturation: 0.2 },
    logs,
    products: [{ metric: 'houses_with_a_move_28d', value: 1, sample: 2 }],
  };
  const html = renderDashboard(input);
  for (const title of ['Move', 'Delivery', 'Realtime', 'Security', 'Infrastructure', 'Product']) {
    assert.ok(html.includes(`<h2>${title}</h2>`));
  }
  assert.ok(!html.includes('private-member-id'));
  const directory = await mkdtemp('/tmp/bm052-dashboard-test-');
  const output = join(directory, 'pilot.html');
  await runDashboard({
    env: {
      PILOT_LOG_FILE: join(directory, 'central.jsonl'),
      PILOT_DASHBOARD_PATH: output,
      PGHOST: 'db.staging.test',
      PGUSER: 'read',
      PGDATABASE: 'app',
      PGSSLMODE: 'require',
    },
    now: Date.parse(input.timestamp),
    query: async () => input.signals,
    readLogs: async () => logs,
    readProducts: async () => input.products,
  });
  assert.equal(await readFile(output, 'utf8'), html);
});
