import { useSyncExternalStore } from 'react';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** "due in 23 h", "due in 40 min", "overdue by 2 h": the time left on a correspondence Move. */
export function dueLabel(due: Date, now: number): string {
  const left = due.getTime() - now;
  const span = Math.abs(left);
  const amount =
    span >= 48 * HOUR
      ? `${Math.round(span / (24 * HOUR))} days`
      : span >= HOUR
        ? `${Math.round(span / HOUR)} h`
        : `${Math.max(1, Math.round(span / MINUTE))} min`;
  return left >= 0 ? `due in ${amount}` : `overdue by ${amount}`;
}

function subscribeToMinutes(change: () => void): () => void {
  const timer = window.setInterval(change, MINUTE);
  return () => window.clearInterval(timer);
}

function currentMinute(): number {
  return Math.floor(Date.now() / MINUTE) * MINUTE;
}

/** The browser's clock, ticking each minute; null while rendering on the server. */
export function useMinuteClock(): number | null {
  return useSyncExternalStore(subscribeToMinutes, currentMinute, () => null);
}
