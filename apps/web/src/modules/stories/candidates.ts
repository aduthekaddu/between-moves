/** [BM-045] One candidate per large analyzed move; the stored position is before that move. */
export const PUZZLE_SWING_THRESHOLD_CP = 200;

export interface EvaluatedSwing {
  readonly ply: number;
  readonly centipawnsBefore: number;
  readonly centipawnsAfter: number;
  readonly bestLine: readonly string[];
}

export interface CandidateWriter {
  create(input: {
    jobId: string;
    houseId: string;
    sourcePly: number;
    bestLine: readonly string[];
    evaluationSwingCp: number;
    now: Date;
  }): Promise<boolean>;
}

export async function generatePuzzleCandidates(
  jobId: string,
  houseId: string,
  swings: readonly EvaluatedSwing[],
  now: Date,
  writer: CandidateWriter,
): Promise<number> {
  let created = 0;
  for (const swing of swings) {
    const evaluationSwingCp = Math.abs(swing.centipawnsAfter - swing.centipawnsBefore);
    if (evaluationSwingCp < PUZZLE_SWING_THRESHOLD_CP) continue;
    if (
      await writer.create({
        jobId,
        houseId,
        sourcePly: swing.ply,
        bestLine: swing.bestLine,
        evaluationSwingCp,
        now,
      })
    ) {
      created += 1;
    }
  }
  return created;
}
