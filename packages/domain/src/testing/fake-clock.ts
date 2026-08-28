import type { Clock } from '../shared/clock';

const INVALID_ADVANCE = 'Clock advance must be a finite non-negative number';

/** [BM-005] Deterministic test clock; mutable Date values never escape its boundary. */
export class FakeClock implements Clock {
  readonly #initialTime: number;
  #elapsedMilliseconds = 0;

  constructor(initialTime: Date) {
    const milliseconds = initialTime.getTime();
    if (!Number.isFinite(milliseconds)) throw new TypeError('Initial clock time must be valid');
    this.#initialTime = milliseconds;
  }

  now(): Date {
    return new Date(this.#initialTime + this.#elapsedMilliseconds);
  }

  advance(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new RangeError(INVALID_ADVANCE);
    this.#elapsedMilliseconds += milliseconds;
  }
}
