import { DomainError } from '../shared/errors';
import type { CorrespondenceClockPolicy } from './clock-policy';

const MILLISECONDS_PER_HOUR = 60 * 60 * 1_000;

/** [BM-025] [DR-CORR-01] Next correspondence deadline from a Game's snapshotted pace. */
export function nextMoveDueAt(now: Date, policy: CorrespondenceClockPolicy): Date {
  if (!Number.isInteger(policy.perMoveHours) || policy.perMoveHours <= 0) {
    throw new DomainError('validation_failed', 'Correspondence pace must be a positive hour count');
  }
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new Error('Invalid correspondence deadline instant');
  }
  const dueAt = new Date(nowMs + policy.perMoveHours * MILLISECONDS_PER_HOUR);
  if (!Number.isFinite(dueAt.getTime())) {
    throw new Error('Invalid correspondence deadline instant');
  }
  return dueAt;
}
