import type { Pool } from 'pg';

/** [BM-045] Candidate positions come from canonical Moves, never the engine payload. */
export class PgPuzzleCandidateRepository {
  constructor(private readonly database: Pick<Pool, 'query'>) {}

  async create(input: {
    jobId: string;
    houseId: string;
    sourcePly: number;
    bestLine: readonly string[];
    evaluationSwingCp: number;
    now: Date;
  }): Promise<boolean> {
    const result = await this.database.query(
      `insert into puzzle_candidates
         (analysis_job_id, game_id, house_id, season_id, source_ply,
          position_fen, best_line, evaluation_swing_cp, created_at)
       select job.id, game.id, game.house_id, game.season_id, $3,
              case when previous.id is null then game.initial_fen else previous.fen_after end,
              $4::jsonb, $5, $6
         from analysis_jobs job
         join games game on game.id = job.game_id and game.house_id = job.house_id
         join moves played on played.game_id = game.id and played.house_id = game.house_id
                          and played.ply = $3
         left join moves previous on previous.game_id = game.id
                                 and previous.house_id = game.house_id
                                 and previous.ply = $3 - 1
        where job.id = $1 and job.house_id = $2 and job.state = 'completed'
          and game.state = 'completed' and $3 > 0 and $5 >= 200
          and (previous.id is not null or not exists (
            select 1 from moves earlier
             where earlier.game_id = game.id and earlier.house_id = game.house_id
               and earlier.ply < played.ply
          ))
       on conflict (game_id, source_ply) do nothing
       returning id`,
      [
        input.jobId,
        input.houseId,
        input.sourcePly,
        JSON.stringify(input.bestLine),
        input.evaluationSwingCp,
        input.now,
      ],
    );
    return (result.rowCount ?? 0) === 1;
  }
}
