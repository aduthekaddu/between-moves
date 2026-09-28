#!/usr/bin/env node
/** [BM-052] Restore into a fresh, isolated staging database and record the result. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access, mkdir, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const requireAdapter = createRequire(new URL('../packages/adapters/package.json', import.meta.url));

export function validateConfig(env) {
  if (env.APP_ENV !== 'staging' && env.APP_ENV !== 'local') {
    throw new Error('APP_ENV must be staging or local');
  }
  if (!/^bm_restore_[a-z0-9_]{1,40}$/.test(env.RESTORE_DB_NAME ?? '')) {
    throw new Error('RESTORE_DB_NAME must be a fresh bm_restore_ database');
  }
  if (!env.BACKUP_FILE) throw new Error('BACKUP_FILE is required');
  if (!env.RESTORE_RECORD_PATH) throw new Error('RESTORE_RECORD_PATH is required');
  if (existsSync(resolve(env.RESTORE_RECORD_PATH))) {
    throw new Error('RESTORE_RECORD_PATH already exists');
  }
  const rto = Number(env.RTO_TARGET_SECONDS);
  if (!Number.isInteger(rto) || rto <= 0) throw new Error('RTO_TARGET_SECONDS must be positive');
  if (!env.PGHOST || !env.PGUSER) throw new Error('PGHOST and PGUSER are required');
  const localHost = env.PGHOST === 'localhost' || env.PGHOST === '127.0.0.1';
  if (env.APP_ENV === 'staging' && localHost) {
    throw new Error('Use the explicit staging database host, not localhost');
  }
  if (env.APP_ENV === 'local' && !localHost) {
    throw new Error('Local rehearsal requires localhost');
  }
  if (env.PGSSLMODE !== 'require') throw new Error('PGSSLMODE must be require');
  return {
    database: env.RESTORE_DB_NAME,
    backup: resolve(env.BACKUP_FILE),
    record: resolve(env.RESTORE_RECORD_PATH),
    rto,
  };
}

function command(binary, args, options = {}) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let output = '';
    let errorOutput = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      errorOutput += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolveCommand(output.trim());
      else reject(new Error(`${binary} failed (exit ${code}): ${errorOutput.slice(0, 500)}`));
    });
  });
}

export function verifyReplay(games, Chess) {
  let replayedMoves = 0;
  for (const game of games) {
    const chess = new Chess(game.initial_fen);
    for (const move of game.moves) {
      const actual = chess.move({
        from: move.uci.slice(0, 2),
        to: move.uci.slice(2, 4),
        ...(move.uci.length === 5 ? { promotion: move.uci[4] } : {}),
      });
      if (!actual || actual.san !== move.san || chess.fen() !== move.fen_after) {
        throw new Error(`Move replay failed for game ${game.id} at ply ${move.ply}`);
      }
      replayedMoves += 1;
    }
    if (chess.fen() !== game.current_fen) {
      throw new Error(`Game snapshot differs from replay for ${game.id}`);
    }
  }
  return replayedMoves;
}

const replaySql = `select coalesce(json_agg(games), '[]'::json)::text from (
  select g.id, g.initial_fen, g.current_fen,
    coalesce((select json_agg(json_build_object('ply', m.ply, 'uci', m.uci,
      'san', m.san, 'fen_after', m.fen_after) order by m.ply)
      from moves m where m.game_id = g.id), '[]'::json) as moves
  from games g order by g.id
) games`;

const integritySql = `select json_build_object(
  'move_sequence_gaps', (select count(*) from (
    select g.id from games g left join moves m on m.game_id = g.id
    group by g.id having count(m.id) <> g.current_ply
      or coalesce(max(m.ply), 0) <> g.current_ply
  ) bad),
  'standings_mismatches', (select count(*) from season_final_standings f
    where f.points <> coalesce((select sum(l.points) from season_score_ledger l
      where l.season_id=f.season_id and l.membership_id=f.membership_id), 0)
      or f.rank <> (select 1 + count(*) from
        season_final_standings higher where higher.season_id=f.season_id
        and higher.points > f.points)),
  'missing_scored_standings', (select count(*) from (
    select distinct l.season_id, l.membership_id
      from season_score_ledger l join seasons s on s.id=l.season_id
      where s.state='closed'
    except select f.season_id, f.membership_id from season_final_standings f
  ) missing),
  'cross_house_rows', (
    (select count(*) from games g join seasons s on s.id=g.season_id
      where g.house_id <> s.house_id) +
    (select count(*) from moves m join games g on g.id=m.game_id
      join memberships member on member.id=m.actor_membership_id
      where m.house_id <> g.house_id or m.house_id <> member.house_id) +
    (select count(*) from season_score_ledger l join seasons s on s.id=l.season_id
      join memberships member on member.id=l.membership_id
      where l.house_id <> s.house_id or l.house_id <> member.house_id) +
    (select count(*) from season_final_standings f join seasons s on s.id=f.season_id
      join memberships member on member.id=f.membership_id
      where f.house_id <> s.house_id or f.house_id <> member.house_id)
  )
)::text`;

export async function runDrill(env = process.env, run = command) {
  const config = validateConfig(env);
  await access(config.backup);
  await mkdir(dirname(config.record), { recursive: true });
  // Reserve the evidence path before touching the staging database. A second drill
  // cannot claim it midway through this run and hide the original outcome.
  const recordFile = await open(config.record, 'wx', 0o600);
  const startedAt = new Date();
  const started = performance.now();
  const record = {
    event: 'pilot.restore-drill',
    environment: env.APP_ENV,
    started_at: startedAt.toISOString(),
    database: config.database,
    rto_target_seconds: config.rto,
    status: 'failed',
  };
  try {
    await run('pg_restore', ['--list', config.backup]);
    const existing = await run('psql', [
      '-X',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
      '-d',
      'postgres',
      '-c',
      `select 1 from pg_database where datname = '${config.database}'`,
    ]);
    if (existing === '1') throw new Error('Restore database already exists');
    await run('createdb', ['--maintenance-db=postgres', config.database]);
    await run('pg_restore', [
      '--exit-on-error',
      '--single-transaction',
      '--no-owner',
      '--no-acl',
      '--dbname',
      config.database,
      config.backup,
    ]);
    // Rehearse the latest reversible migration on the restored copy only.
    const drillEnv = { ...env, DATABASE_URL: undefined };
    const migrationTool = new URL('../packages/db/src/migrate-cli.ts', import.meta.url);
    const databaseUrl = new URL(`postgresql://${env.PGHOST}/${config.database}`);
    databaseUrl.username = env.PGUSER;
    if (env.PGPASSWORD) databaseUrl.password = env.PGPASSWORD;
    if (env.PGPORT) databaseUrl.port = env.PGPORT;
    databaseUrl.searchParams.set('sslmode', 'require');
    drillEnv.DATABASE_URL = databaseUrl.toString();
    await run(
      'pnpm',
      ['--filter', '@between-moves/db', 'exec', 'tsx', fileURLToPath(migrationTool), 'down'],
      { env: drillEnv },
    );
    await run(
      'pnpm',
      ['--filter', '@between-moves/db', 'exec', 'tsx', fileURLToPath(migrationTool), 'up'],
      { env: drillEnv },
    );
    const integrity = JSON.parse(
      await run('psql', [
        '-X',
        '-A',
        '-t',
        '-v',
        'ON_ERROR_STOP=1',
        '-d',
        config.database,
        '-c',
        integritySql,
      ]),
    );
    if (Object.values(integrity).some((count) => Number(count) !== 0)) {
      throw new Error('Restore integrity checks failed');
    }
    const { Chess } = requireAdapter('chess.js');
    const games = JSON.parse(
      await run('psql', [
        '-X',
        '-A',
        '-t',
        '-v',
        'ON_ERROR_STOP=1',
        '-d',
        config.database,
        '-c',
        replaySql,
      ]),
    );
    record.integrity = {
      ...integrity,
      replayed_moves: verifyReplay(games, Chess),
      games_checked: games.length,
    };
    record.status = 'passed';
  } catch (error) {
    record.error = error instanceof Error ? error.message : String(error);
  } finally {
    record.finished_at = new Date().toISOString();
    record.rto_seconds = Math.ceil((performance.now() - started) / 1000);
    record.within_rto = record.status === 'passed' && record.rto_seconds <= config.rto;
    if (record.status === 'passed' && !record.within_rto) {
      record.error = `Restore took ${record.rto_seconds}s, over the ${config.rto}s RTO target`;
    }
    if (!record.within_rto) record.status = 'failed';
    try {
      await recordFile.writeFile(`${JSON.stringify(record, null, 2)}\n`);
    } finally {
      await recordFile.close();
    }
  }
  if (record.status !== 'passed') throw new Error(`Restore drill failed; see ${config.record}`);
  return record;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDrill()
    .then((record) => console.log(JSON.stringify(record)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
