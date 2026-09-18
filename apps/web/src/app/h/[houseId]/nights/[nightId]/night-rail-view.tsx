'use client';

import type { NightRailSnapshotResponse } from '@between-moves/contracts';
import { useEffect, useRef, useState } from 'react';
import { parseFenPieces, squareName, type BoardPiece } from '../../games/[gameId]/board-model';
import { applyOrRepairNightRail } from './rail-realtime';

const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const ranks = [8, 7, 6, 5, 4, 3, 2, 1] as const;
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

async function mintToken(houseId: string, nightId: string): Promise<void> {
  await fetch(`/api/houses/${houseId}/nights/${nightId}/realtime-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
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

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    if (!attachRealtime) return;
    const nightId = snapshot.nightId;
    void mintToken(houseId, nightId);
    const source = new EventSource(`/api/houses/${houseId}/nights/${nightId}/rail/live`);
    source.onopen = () => setLive(true);
    source.onmessage = (event) => {
      const incoming = wireEvent(event.data);
      if (incoming === null) return;
      void applyOrRepairNightRail(snapshotRef.current, incoming, () =>
        refetchRail(houseId, nightId),
      ).then((result) => {
        snapshotRef.current = result.snapshot;
        setSnapshot(result.snapshot);
      });
    };
    return () => {
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
