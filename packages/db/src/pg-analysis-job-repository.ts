import type { Pool, PoolClient, QueryResultRow } from 'pg';

export interface AnalysisJob {
  readonly id: string;
  readonly gameId: string;
  readonly engineVersion: string;
  readonly attempts: number;
  readonly leaseToken: string;
}

interface JobRow extends QueryResultRow {
  id: string;
  game_id: string;
  engine_version: string;
  attempts: number;
  lease_token: string;
}

export type AnalysisCompletion = 'processed' | 'duplicate' | 'stale';
export interface AnalysisResultCompletion {
  readonly outcome: AnalysisCompletion;
  readonly durationMs: number | null;
}

export interface AnalysisCandidateCompletion extends AnalysisResultCompletion {
  readonly candidatesCreated: number;
}

/** [BM-044] One job per completion event; lease tokens fence delayed workers. */
export class PgAnalysisJobRepository {
  constructor(private readonly database: Pick<Pool, 'query' | 'connect'>) {}

  async enqueue(input: {
    eventId: string;
    gameId: string;
    houseId: string;
    engineVersion: string;
    now: Date;
  }): Promise<'enqueued' | 'duplicate'> {
    const result = await this.database.query(
      `insert into analysis_jobs
         (id, source_event_id, game_id, house_id, engine_version, available_at, created_at)
       select $1, $1, game.id, game.house_id, $4, $5, $5
         from games game
        where game.id = $2 and game.house_id = $3 and game.state = 'completed'
       on conflict (source_event_id) do nothing
       returning id`,
      [input.eventId, input.gameId, input.houseId, input.engineVersion, input.now],
    );
    if (result.rowCount) return 'enqueued';
    const existing = await this.database.query(
      'select id from analysis_jobs where source_event_id = $1',
      [input.eventId],
    );
    if (existing.rowCount) return 'duplicate';
    throw new Error('Analysis event does not reference a completed game');
  }

  async claim(now: Date, leaseUntil: Date, maxAttempts: number): Promise<AnalysisJob | null> {
    const result = await this.database.query<JobRow>(
      `with candidate as (
         select id from analysis_jobs
          where state in ('pending', 'leased') and attempts < $3
            and available_at <= $1 and (state = 'pending' or lease_until <= $1)
          order by available_at, id
          for update skip locked limit 1
       )
       update analysis_jobs job set state = 'leased', attempts = job.attempts + 1,
         lease_token = gen_random_uuid(), lease_until = $2
         from candidate where job.id = candidate.id
       returning job.id, job.game_id, job.engine_version, job.attempts, job.lease_token`,
      [now, leaseUntil, maxAttempts],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          gameId: row.game_id,
          engineVersion: row.engine_version,
          attempts: row.attempts,
          leaseToken: row.lease_token,
        }
      : null;
  }

  async expire(now: Date, maxAttempts: number): Promise<number> {
    const result = await this.database.query(
      `update analysis_jobs set state = 'failed', lease_token = null,
         lease_until = null, last_error = 'Attempt limit reached'
        where state in ('pending', 'leased') and attempts >= $2
          and available_at <= $1 and (state = 'pending' or lease_until <= $1)`,
      [now, maxAttempts],
    );
    return result.rowCount ?? 0;
  }

  async complete(
    jobId: string,
    leaseToken: string,
    result: Readonly<Record<string, unknown>>,
    now: Date,
  ): Promise<AnalysisResultCompletion> {
    const { outcome, durationMs } = await this.completeWithCandidates(
      jobId,
      leaseToken,
      result,
      now,
      async () => 0,
    );
    return { outcome, durationMs };
  }

  /** Candidate writes share the successful lease's transaction. */
  async completeWithCandidates(
    jobId: string,
    leaseToken: string,
    result: Readonly<Record<string, unknown>>,
    now: Date,
    createCandidates: (houseId: string, client: PoolClient) => Promise<number>,
  ): Promise<AnalysisCandidateCompletion> {
    const client = await this.database.connect();
    try {
      await client.query('begin');
      const updated = await client.query<{ created_at: Date; house_id: string }>(
        `update analysis_jobs set state = 'completed', result = $4,
           completed_at = $3, lease_token = null, lease_until = null
          where id = $1 and state = 'leased' and lease_token = $2 and lease_until > $3
          returning created_at, house_id`,
        [jobId, leaseToken, now, JSON.stringify(result)],
      );
      const row = updated.rows[0];
      if (row) {
        if (!(row.created_at instanceof Date))
          throw new Error('Invalid analysis job creation time');
        const candidatesCreated = await createCandidates(row.house_id, client);
        await client.query('commit');
        return {
          outcome: 'processed',
          durationMs: Math.max(0, now.getTime() - row.created_at.getTime()),
          candidatesCreated,
        };
      }
      const current = await client.query<{ state: string }>(
        'select state from analysis_jobs where id = $1',
        [jobId],
      );
      await client.query('commit');
      return {
        outcome: current.rows[0]?.state === 'completed' ? 'duplicate' : 'stale',
        durationMs: null,
        candidatesCreated: 0,
      };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async fail(
    jobId: string,
    leaseToken: string,
    now: Date,
    maxAttempts: number,
    error: string,
  ): Promise<AnalysisCompletion> {
    const updated = await this.database.query(
      `update analysis_jobs set
         state = case when attempts >= $4 then 'failed' else 'pending' end,
         available_at = $3 + (least(300, power(2, attempts)::integer) * interval '1 second'),
         lease_token = null, lease_until = null, last_error = $5,
         last_failure_token = $2
        where id = $1 and state = 'leased' and lease_token = $2 and lease_until > $3
        returning id`,
      [jobId, leaseToken, now, maxAttempts, error.slice(0, 2000) || 'Analysis failed'],
    );
    if (updated.rowCount) return 'processed';
    const current = await this.database.query<{ last_failure_token: string | null }>(
      'select last_failure_token from analysis_jobs where id = $1',
      [jobId],
    );
    return current.rows[0]?.last_failure_token === leaseToken ? 'duplicate' : 'stale';
  }
}
