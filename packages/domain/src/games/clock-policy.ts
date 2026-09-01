/** [BM-021] [DR-GAME-02] A Game owns exactly one mode-specific clock-policy shape. */
export interface CorrespondenceClockPolicy {
  readonly kind: 'correspondence';
  readonly perMoveHours: number;
}

/** [BM-021] [DR-GAME-02] Live clocks never share optional correspondence fields. */
export interface LiveClockPolicy {
  readonly kind: 'live';
  readonly initialMs: number;
  readonly incrementMs: number;
}

export type ClockPolicy = CorrespondenceClockPolicy | LiveClockPolicy;
