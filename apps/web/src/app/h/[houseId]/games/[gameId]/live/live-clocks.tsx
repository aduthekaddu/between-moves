'use client';

import { useEffect, useState } from 'react';
import type { MoveEntryPosition } from '../move-entry-wire';
import { formatClock, remainingTime } from './countdown';

/** Remounted for each server snapshot; ticks never use the client's wall clock. */
export function LiveClocks({ position }: { readonly position: MoveEntryPosition }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (position.state !== 'active') return;
    const receivedAt = performance.now();
    const timer = window.setInterval(() => setElapsed(performance.now() - receivedAt), 100);
    return () => window.clearInterval(timer);
  }, [position.state]);
  const remaining = remainingTime(position, elapsed);
  if (remaining === null) return null;
  const colors =
    position.viewerColor === 'black'
      ? (['black', 'white'] as const)
      : (['white', 'black'] as const);
  return (
    <div className="live-clocks" aria-label="Game clocks">
      {colors.map((color) => {
        const running = position.state === 'active' && position.sideToMove === color;
        return (
          <div key={color} className="live-clock" data-running={running}>
            <div className="live-clock__player">
              <span>
                {color === 'white' ? 'White' : 'Black'} · {position[color].name}
              </span>
              <span className="live-clock__turn">
                {running ? 'To move' : position.state === 'completed' ? 'Final' : 'Waiting'}
              </span>
            </div>
            <span
              role="timer"
              aria-live="off"
              aria-label={`${color === 'white' ? 'White' : 'Black'} time remaining`}
              data-testid={`${color}-clock`}
            >
              {formatClock(remaining[color])}
            </span>
          </div>
        );
      })}
    </div>
  );
}
