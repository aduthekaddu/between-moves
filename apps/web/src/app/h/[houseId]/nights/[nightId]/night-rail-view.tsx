'use client';

import {
  nightPresenceResponseSchema,
  realtimeTokenResponseSchema,
  type NightPresenceCommandBody,
  type NightPresenceResponse,
  type NightRailSnapshotResponse,
  type RealtimeTokenResponse,
} from '@between-moves/contracts';
import { useEffect, useRef, useState } from 'react';
import { parseFenPieces, squareName, type BoardPiece } from '../../games/[gameId]/board-model';
import { applyOrRepairNightRail } from './rail-realtime';

const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const ranks = [8, 7, 6, 5, 4, 3, 2, 1] as const;
const PRESENCE_RENEWAL_SKEW_MS = 60_000;
const PRESENCE_RETRY_MS = 30_000;
const glyphs: Readonly<Record<string, string>> = {
  'white-king': '♔',
  'white-queen': '♕',
  'white-rook': '♖',
  'white-bishop': '♗',
  'white-knight': '♘',
  'white-pawn': '♙',
  'black-king': '♚',
  'black-queen': '♛',
  'black-rook': '♜',
  'black-bishop': '♝',
  'black-knight': '♞',
  'black-pawn': '♟',
};

function pieceGlyph(piece?: BoardPiece): string {
  return piece === undefined ? '' : (glyphs[`${piece.color}-${piece.kind}`] ?? '');
}

function stateLabel(state: NightRailSnapshotResponse['state']): string {
  switch (state) {
    case 'scheduled':
      return 'Scheduled';
    case 'live':
      return 'Live';
    case 'ended':
      return 'Ended';
  }
}

function resultLabel(result: NightRailSnapshotResponse['recentResults'][number]): string {
  switch (result.result) {
    case 'white_win':
      return `${result.white.name} won`;
    case 'black_win':
      return `${result.black.name} won`;
    case 'draw':
      return 'Drawn';
    case 'aborted':
      return 'Abandoned';
  }
}

function presenceLabel(count: number): string {
  if (count === 0) return 'The table is quiet.';
  if (count === 1) return '1 member at the table';
  return `${count} members at the table`;
}

function RailThumbnail({
  board,
}: {
  readonly board: NightRailSnapshotResponse['activeBoards'][number];
}) {
  const pieces = parseFenPieces(board.currentFen);
  const last = board.lastSan === null ? '' : ` Last move ${board.lastSan}.`;
  const label = `${board.white.name} versus ${board.black.name}. ${board.sideToMove} to move.${last}`;
  return (
    <div className="rail-thumb" role="img" aria-label={label}>
      {ranks.map((rank) => (
        <div className="rail-thumb__row" key={rank}>
          {files.map((file) => {
            const square = `${file}${rank}` as const;
            const piece = pieces[square];
            return (
              <span
                key={square}
                className="rail-thumb__square"
                data-color={(file.charCodeAt(0) + rank) % 2 === 0 ? 'dark' : 'light'}
                title={squareName(square, piece)}
              >
                <span aria-hidden="true">{pieceGlyph(piece)}</span>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

async function mintToken(houseId: string, nightId: string): Promise<RealtimeTokenResponse> {
  const response = await fetch(`/api/houses/${houseId}/nights/${nightId}/realtime-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error('Presence identity could not be signed.');
  return realtimeTokenResponseSchema.parse(await response.json());
}

async function changePresence(
  houseId: string,
  nightId: string,
  command: NightPresenceCommandBody,
  keepalive = false,
): Promise<NightPresenceResponse> {
  const response = await fetch(`/api/houses/${houseId}/nights/${nightId}/presence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    keepalive,
  });
  if (!response.ok) throw new Error('Night presence could not be updated.');
  return nightPresenceResponseSchema.parse(await response.json());
}

async function refetchRail(houseId: string, nightId: string): Promise<NightRailSnapshotResponse> {
  const response = await fetch(`/api/houses/${houseId}/nights/${nightId}/rail?repair=1`, {
    headers: { 'Cache-Control': 'no-store' },
  });
  if (!response.ok) throw new Error('The Night rail could not be repaired.');
  return (await response.json()) as NightRailSnapshotResponse;
}

function wireEvent(data: string): {
  topic: string;
  aggregateId: string;
  sequence: string;
  payload: Readonly<Record<string, unknown>>;
} | null {
  try {
    const envelope = JSON.parse(data) as {
      name?: unknown;
      sequence?: unknown;
      data?: unknown;
    };
    if (
      typeof envelope.name !== 'string' ||
      typeof envelope.sequence !== 'string' ||
      envelope.data === null ||
      typeof envelope.data !== 'object' ||
      Array.isArray(envelope.data)
    ) {
      return null;
    }
    const payload = envelope.data as Readonly<Record<string, unknown>>;
    if (typeof payload.aggregateId !== 'string') return null;
    return {
      topic: envelope.name,
      aggregateId: payload.aggregateId,
      sequence: envelope.sequence,
      payload,
    };
  } catch {
    return null;
  }
}

export interface NightPresenceSource {
  addEventListener(type: 'presence', listener: (event: MessageEvent<string>) => void): void;
  removeEventListener(type: 'presence', listener: (event: MessageEvent<string>) => void): void;
}

export interface NightPresenceBrowserWindow {
  addEventListener(type: 'pagehide' | 'pageshow', listener: () => void): void;
  removeEventListener(type: 'pagehide' | 'pageshow', listener: () => void): void;
}

export interface NightPresenceLifecycleOptions {
  readonly source: NightPresenceSource;
  readonly browserWindow: NightPresenceBrowserWindow;
  readonly mintToken: () => Promise<RealtimeTokenResponse>;
  readonly changePresence: (
    command: NightPresenceCommandBody,
    keepalive?: boolean,
  ) => Promise<NightPresenceResponse>;
  readonly onPresence: (presence: NightPresenceResponse) => void;
}

/** [BM-039] Keep the local lease authoritative while the SSE stream catches up. */
export function startNightPresence(options: NightPresenceLifecycleOptions): () => void {
  let cancelled = false;
  let active = true;
  let generation = 0;
  let signedIdentity: RealtimeTokenResponse | null = null;
  let renewal: ReturnType<typeof setTimeout> | undefined;

  const onPresence = (event: MessageEvent<string>) => {
    try {
      options.onPresence(nightPresenceResponseSchema.parse(JSON.parse(event.data) as unknown));
    } catch {
      // Ignore malformed live data and keep the last verified snapshot.
    }
  };
  options.source.addEventListener('presence', onPresence);

  const sendLeave = (identity: RealtimeTokenResponse) =>
    options.changePresence(
      {
        kind: 'leave',
        token: identity.token,
        presence: identity.presence,
      },
      true,
    );
  const enter = async (expectedGeneration: number) => {
    if (cancelled || !active || generation !== expectedGeneration) return;
    try {
      const identity = await options.mintToken();
      if (cancelled || !active || generation !== expectedGeneration) return;
      const previousIdentity = signedIdentity;
      const presence = await options.changePresence({
        kind: 'enter',
        token: identity.token,
        presence: identity.presence,
      });
      if (cancelled || !active || generation !== expectedGeneration) {
        await sendLeave(identity);
        return;
      }
      options.onPresence(presence);
      signedIdentity = identity;
      if (previousIdentity !== null) await sendLeave(previousIdentity).catch(() => undefined);
      const delay = Math.max(
        1_000,
        new Date(identity.expiresAt).getTime() - Date.now() - PRESENCE_RENEWAL_SKEW_MS,
      );
      renewal = setTimeout(() => void enter(expectedGeneration), delay);
    } catch {
      if (!cancelled && active && generation === expectedGeneration) {
        renewal = setTimeout(() => void enter(expectedGeneration), PRESENCE_RETRY_MS);
      }
    }
  };

  const leave = () => {
    active = false;
    generation += 1;
    if (renewal !== undefined) clearTimeout(renewal);
    if (signedIdentity !== null) void sendLeave(signedIdentity).catch(() => undefined);
    signedIdentity = null;
  };
  const reenter = () => {
    if (cancelled || active) return;
    active = true;
    generation += 1;
    void enter(generation);
  };
  options.browserWindow.addEventListener('pagehide', leave);
  options.browserWindow.addEventListener('pageshow', reenter);

  // The command response is authoritative for this tab; the stream propagates it to others.
  void enter(generation);

  return () => {
    cancelled = true;
    leave();
    options.browserWindow.removeEventListener('pagehide', leave);
    options.browserWindow.removeEventListener('pageshow', reenter);
    options.source.removeEventListener('presence', onPresence);
  };
}

export function retainNewerPresence(
  incoming: NightRailSnapshotResponse,
  latest: NightRailSnapshotResponse,
  presenceRevisionAtStart: number,
  currentPresenceRevision: number,
): NightRailSnapshotResponse {
  if (presenceRevisionAtStart === currentPresenceRevision) return incoming;
  return {
    ...incoming,
    presence: latest.presence,
    presenceCount: latest.presenceCount,
  };
}

/** [BM-038] Durable Night rail; live events attach after the snapshot is on screen. */
export function NightRailView({
  houseId,
  initial,
  attachRealtime = true,
}: {
  readonly houseId: string;
  readonly initial: NightRailSnapshotResponse;
  readonly attachRealtime?: boolean;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [live, setLive] = useState(false);
  const snapshotRef = useRef(snapshot);
  const presenceRevision = useRef(0);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    if (!attachRealtime) return;
    const nightId = snapshot.nightId;
    let cancelled = false;
    const source = new EventSource(`/api/houses/${houseId}/nights/${nightId}/rail/live`);
    source.onopen = () => setLive(true);
    source.onmessage = (event) => {
      const incoming = wireEvent(event.data);
      if (incoming === null) return;
      const presenceRevisionAtStart = presenceRevision.current;
      void applyOrRepairNightRail(snapshotRef.current, incoming, () =>
        refetchRail(houseId, nightId),
      ).then((result) => {
        const next = retainNewerPresence(
          result.snapshot,
          snapshotRef.current,
          presenceRevisionAtStart,
          presenceRevision.current,
        );
        snapshotRef.current = next;
        setSnapshot(next);
      });
    };
    const applyPresence = (presence: NightPresenceResponse) => {
      if (cancelled) return;
      const nextPresence = {
        presence: presence.presence,
        presenceCount: presence.presenceCount,
      };
      snapshotRef.current = { ...snapshotRef.current, ...nextPresence };
      presenceRevision.current += 1;
      setSnapshot((current) => {
        return { ...current, ...nextPresence };
      });
    };
    const stopPresence = startNightPresence({
      source,
      browserWindow: window,
      mintToken: () => mintToken(houseId, nightId),
      changePresence: (command, keepalive) => changePresence(houseId, nightId, command, keepalive),
      onPresence: applyPresence,
    });
    return () => {
      cancelled = true;
      stopPresence();
      source.onopen = null;
      source.close();
    };
  }, [attachRealtime, houseId, snapshot.nightId]);

  return (
    <div className="night-rail">
      <header className="house-masthead">
        <a href={`/h/${encodeURIComponent(houseId)}/season`}>← Season</a>
        <p className="house-masthead__place">Night rail</p>
      </header>
      <main className="night-rail__main">
        <p className="house-home__eyebrow">Between Moves Night</p>
        <h1>The rail</h1>
        <p className="night-rail__status">
          {stateLabel(snapshot.state)} · {presenceLabel(snapshot.presenceCount)}
        </p>
        <p className="night-rail__live" aria-live="polite">
          {live ? 'Live updates are on.' : 'Showing the last saved table.'}
        </p>
        <section aria-labelledby="rail-presence-title">
          <h2 id="rail-presence-title">Here now</h2>
          {snapshot.presence.length === 0 ? (
            <p>No one is on the rail yet.</p>
          ) : (
            <ul className="night-rail__presence" aria-live="polite">
              {snapshot.presence.map((member) => (
                <li key={member.clientId}>{member.displayName}</li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="rail-boards-title">
          <h2 id="rail-boards-title">Boards in play</h2>
          {snapshot.activeBoards.length === 0 ? (
            <p>No boards are in play yet.</p>
          ) : (
            <ul className="night-rail__boards">
              {snapshot.activeBoards.map((board) => (
                <li key={board.gameId}>
                  <a
                    href={`/h/${encodeURIComponent(houseId)}/games/${encodeURIComponent(board.gameId)}`}
                  >
                    <p>
                      {board.white.name} <span aria-hidden="true">—</span>{' '}
                      <span className="visually-hidden">versus </span>
                      {board.black.name}
                    </p>
                    <RailThumbnail board={board} />
                    <p>
                      {board.sideToMove === 'white' ? 'White' : 'Black'} to move
                      {board.lastSan === null ? '' : ` · ${board.lastSan}`}
                    </p>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="rail-results-title">
          <h2 id="rail-results-title">Recent results</h2>
          {snapshot.recentResults.length === 0 ? (
            <p>No results yet tonight.</p>
          ) : (
            <ol className="night-rail__results">
              {snapshot.recentResults.map((result) => (
                <li key={result.gameId}>
                  <a
                    href={`/h/${encodeURIComponent(houseId)}/games/${encodeURIComponent(result.gameId)}`}
                  >
                    {result.white.name} versus {result.black.name}: {resultLabel(result)}
                  </a>
                </li>
              ))}
            </ol>
          )}
        </section>
      </main>
    </div>
  );
}
