/** [BM-005] Time-dependent code receives this port instead of reading wall time directly. */
export interface Clock {
  now(): Date;
}
