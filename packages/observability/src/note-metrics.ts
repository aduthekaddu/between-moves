export interface NoteMetricSnapshot {
  readonly note_save_total: number;
  readonly rate_limit_hit_total: number;
}

export interface NoteMetricStubs {
  incrementNoteSave(): void;
  incrementRateLimitHit(): void;
  snapshot(): NoteMetricSnapshot;
}

/** [BM-032] In-process seam for Game-note save and rate-limit counters. */
export function createNoteMetricStubs(): NoteMetricStubs {
  let noteSaves = 0;
  let rateLimitHits = 0;
  return {
    incrementNoteSave() {
      noteSaves += 1;
    },
    incrementRateLimitHit() {
      rateLimitHits += 1;
    },
    snapshot() {
      return { note_save_total: noteSaves, rate_limit_hit_total: rateLimitHits };
    },
  };
}
