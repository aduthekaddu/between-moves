import type { Clock } from '@between-moves/domain';

/** [BM-005] Production wall-clock adapter; domain code only sees the Clock port. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
