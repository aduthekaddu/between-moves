import type { MoveEntryPosition } from '../move-entry-wire';

/** [BM-042] Display only: server timestamps anchor a monotonic local countdown. */
export function remainingTime(position: MoveEntryPosition, elapsedMs: number) {
  const clock = position.liveClock;
  if (clock === undefined || position.serverNow === undefined) return null;
  const turnStartedAt =
    clock.turnStartedAt === null ? null : new Date(clock.turnStartedAt).getTime();
  const running = position.state === 'active' && turnStartedAt !== null;
  const elapsed = running
    ? Math.max(0, Date.parse(position.serverNow) - (turnStartedAt ?? 0)) + Math.max(0, elapsedMs)
    : 0;
  return {
    white: Math.max(0, clock.whiteMs - (running && position.sideToMove === 'white' ? elapsed : 0)),
    black: Math.max(0, clock.blackMs - (running && position.sideToMove === 'black' ? elapsed : 0)),
  };
}

export function formatClock(milliseconds: number): string {
  const seconds = Math.ceil(Math.max(0, milliseconds) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
