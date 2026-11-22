import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  initialBoardState,
  transition,
  UNDO_WINDOW_MS,
  type BoardEffect,
  type BoardEvent,
  type BoardState,
  type Environment,
  type SubmitCommand,
} from './board-machine';
import {
  moveAnswer,
  moveEntryPosition,
  type MoveAnswer,
  type MoveEntryPosition,
} from './move-entry-wire';

export const LIVE_VIEWPORT = '(min-width: 768px)';

function readEnvironment(): Environment {
  return {
    online: navigator.onLine,
    visible: document.visibilityState !== 'hidden',
    wideEnough: window.matchMedia(LIVE_VIEWPORT).matches,
  };
}

async function readGame(url: string): Promise<MoveEntryPosition | null> {
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    const body: unknown = await response.json();
    return response.ok ? moveEntryPosition(body) : null;
  } catch {
    return null;
  }
}

async function sendMove(
  url: string,
  command: SubmitCommand,
  keepalive: boolean,
): Promise<MoveAnswer> {
  try {
    const response = await fetch(`${url}/moves`, {
      method: 'POST',
      keepalive,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedPly: command.expectedPly,
        clientCommandId: command.clientCommandId,
        move: command.proposal,
      }),
    });
    const body: unknown = await response.json();
    return moveAnswer(response.status, body);
  } catch {
    return { kind: 'unreachable' };
  }
}

/** Holds the board state outside React, so timers, page events and fetch answers see the newest. */
function createBoardStore(houseId: string, gameId: string, initial: MoveEntryPosition) {
  const url = `/api/houses/${encodeURIComponent(houseId)}/games/${encodeURIComponent(gameId)}`;
  let state = initialBoardState(initial);
  const listeners = new Set<() => void>();
  let playSound: (san: string) => void = () => {};

  function dispatch(event: BoardEvent) {
    const [next, effects] = transition(state, event, readEnvironment());
    if (next !== state) {
      state = next;
      for (const listener of [...listeners]) listener();
    }
    for (const effect of effects) run(effect);
  }

  function run(effect: BoardEffect) {
    switch (effect.kind) {
      case 'readGame':
        void readGame(url).then((snapshot) =>
          dispatch({ type: 'readAnswered', requestId: effect.requestId, snapshot }),
        );
        return;
      case 'sendMove':
        void sendMove(url, effect.command, effect.keepalive).then((answer) =>
          dispatch({ type: 'moveAnswered', requestId: effect.requestId, answer }),
        );
        return;
      case 'startUndoTimer':
        setTimeout(
          () => dispatch({ type: 'undoWindowEnded', clientCommandId: effect.clientCommandId }),
          UNDO_WINDOW_MS,
        );
        return;
      case 'playSound':
        playSound(effect.san);
        return;
    }
  }

  function reading(): number | null {
    return state.sync.kind === 'failed' ? null : state.sync.reading;
  }

  return {
    dispatch,
    getState: (): BoardState => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSound(play: (san: string) => void) {
      playSound = play;
    },
    /** Reads the Game, or joins the read already out, and settles when that read does. */
    refresh(): Promise<void> {
      dispatch({ type: 'refreshRequested' });
      const id = reading();
      if (id === null) return Promise.resolve();
      return new Promise((resolve) => {
        const settled = () => {
          if (reading() === id) return;
          listeners.delete(settled);
          resolve();
        };
        listeners.add(settled);
      });
    },
  };
}

export type BoardStore = ReturnType<typeof createBoardStore>;

export function useBoardStore(
  houseId: string,
  gameId: string,
  initial: MoveEntryPosition,
  playSound: (san: string) => void,
): readonly [BoardState, BoardStore] {
  const [store] = useState(() => createBoardStore(houseId, gameId, initial));
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  useEffect(() => store.setSound(playSound), [store, playSound]);
  return [state, store];
}
