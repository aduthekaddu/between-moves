export interface PuzzleMetricSnapshot {
  readonly puzzle_published_total: number;
}

/** [BM-046] Count committed House Puzzle publications. */
export function createPuzzleMetricStubs() {
  let published = 0;
  return {
    incrementPublished(): void {
      published += 1;
    },
    snapshot(): PuzzleMetricSnapshot {
      return { puzzle_published_total: published };
    },
  };
}
