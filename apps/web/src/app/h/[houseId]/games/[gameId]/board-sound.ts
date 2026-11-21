'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { PaperSound } from '../../../../_components/paper-sound';

const PREFERENCE_KEY = 'bm-board-sound';
const listeners = new Set<() => void>();

function readPreference(): boolean {
  try {
    return window.localStorage.getItem(PREFERENCE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writePreference(on: boolean) {
  try {
    window.localStorage.setItem(PREFERENCE_KEY, on ? 'on' : 'off');
  } catch {
    // A blocked store keeps the choice for this page only.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Paper sounds for Moves, on unless this device turned them off. */
export function useBoardSound() {
  const on = useSyncExternalStore(subscribe, readPreference, () => true);
  const sound = useRef<PaperSound | null>(null);

  useEffect(() => () => sound.current?.dispose(), []);

  /** Browsers only start audio inside a gesture, so every tap or drag wakes it. */
  const wake = useCallback(() => {
    if (!on || typeof AudioContext === 'undefined') return;
    try {
      sound.current ??= new PaperSound();
      sound.current.enable();
    } catch {
      // Sound is a nicety; a browser that refuses audio must still let the Move through.
      sound.current = null;
    }
  }, [on]);

  const play = useCallback(
    (san: string) => {
      const player = sound.current;
      if (!on || player === null || !player.on) return;
      try {
        if (san.includes('#') || san.includes('x')) player.stamp();
        else if (san.includes('+')) player.tap();
        else player.tock();
      } catch {
        // A failed sound never blocks the board.
      }
    },
    [on],
  );

  const toggle = useCallback(() => {
    writePreference(!on);
    if (on) sound.current?.disable();
  }, [on]);

  return { on, wake, play, toggle };
}
