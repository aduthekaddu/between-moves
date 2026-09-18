import type { NightRailSnapshotResponse } from '@between-moves/contracts';
import type { NightPresenceCommandBody, NightPresenceResponse } from '@between-moves/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  NightRailView,
  retainNewerPresence,
  startNightPresence,
  type NightPresenceBrowserWindow,
  type NightPresenceSource,
} from './night-rail-view';

const snapshot: NightRailSnapshotResponse = {
  houseId: '01941f29-7c00-7000-8000-000000000201',
  nightId: '01941f29-7c00-7000-8000-000000000901',
  seasonId: '01941f29-7c00-7000-8000-000000000701',
  state: 'live',
  scheduledStart: '2026-09-04T14:00:00.000Z',
  scheduledEnd: '2026-09-04T16:00:00.000Z',
  startedAt: '2026-09-04T14:00:00.000Z',
  endedAt: null,
  nightSequence: '1',
  presence: [
    {
      clientId: '01941f29-7c00-7000-8000-000000000101',
      displayName: 'Ada',
      signature: 'a'.repeat(43),
    },
    {
      clientId: '01941f29-7c00-7000-8000-000000000102',
      displayName: 'Bea',
      signature: 'b'.repeat(43),
    },
  ],
  presenceCount: 2,
  activeBoards: [
    {
      gameId: '01941f29-7c00-7000-8000-000000000801',
      sequence: '1',
      currentFen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
      currentPly: 1,
      sideToMove: 'black',
      lastSan: 'e4',
      white: { membershipId: '01941f29-7c00-7000-8000-000000000621', name: 'Ada' },
      black: { membershipId: '01941f29-7c00-7000-8000-000000000623', name: 'Bea' },
    },
  ],
  recentResults: [
    {
      gameId: '01941f29-7c00-7000-8000-000000000802',
      sequence: '3',
      result: 'white_win',
      resultReason: 'resign',
      completedAt: '2026-09-04T14:20:00.000Z',
      white: { membershipId: '01941f29-7c00-7000-8000-000000000621', name: 'Ada' },
      black: { membershipId: '01941f29-7c00-7000-8000-000000000623', name: 'Bea' },
    },
  ],
};

const identity = {
  token: 't'.repeat(32),
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
  clientId: snapshot.presence[0]?.clientId ?? '',
  publicKey: 'public-key',
  channels: { night: 'n'.repeat(16), games: [] },
  presence: snapshot.presence[0] ?? {
    clientId: '01941f29-7c00-7000-8000-000000000101',
    displayName: 'Ada',
    signature: 'a'.repeat(43),
  },
};

function lifecycleHarness() {
  const presenceListeners = new Set<(event: MessageEvent<string>) => void>();
  const windowListeners = new Map<'pagehide' | 'pageshow', () => void>();
  const source: NightPresenceSource = {
    addEventListener: (_type, listener) => presenceListeners.add(listener),
    removeEventListener: (_type, listener) => presenceListeners.delete(listener),
  };
  const browserWindow: NightPresenceBrowserWindow = {
    addEventListener: (type, listener) => windowListeners.set(type, listener),
    removeEventListener: (type, listener) => {
      if (windowListeners.get(type) === listener) windowListeners.delete(type);
    },
  };
  return {
    source,
    browserWindow,
    emit(data: unknown) {
      const event = new MessageEvent<string>('presence', { data: JSON.stringify(data) });
      for (const listener of presenceListeners) listener(event);
    },
    trigger(type: 'pagehide' | 'pageshow') {
      windowListeners.get(type)?.();
    },
  };
}

async function settlePresence(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('Night rail view', () => {
  it('[BM-038] renders durable boards and results before realtime attaches', () => {
    const html = renderToStaticMarkup(
      <NightRailView
        houseId="01941f29-7c00-7000-8000-000000000201"
        initial={snapshot}
        attachRealtime={false}
      />,
    );

    expect(html).toContain('The rail');
    expect(html).toContain('Showing the last saved table.');
    expect(html).not.toContain('Live updates are on.');
    expect(html).toContain('2 members at the table');
    expect(html).toContain('Here now');
    expect(html).toContain('Ada');
    expect(html).toContain('Bea');
    expect(html).toContain('e4');
    expect(html).toContain('Ada won');
    expect(html).toContain('role="img"');
    expect(html).toContain('Boards in play');
    expect(html).toContain('Recent results');
  });

  it('[BM-039] renders the quiet rail when no presence lease exists', () => {
    const html = renderToStaticMarkup(
      <NightRailView
        houseId={snapshot.houseId}
        initial={{ ...snapshot, presence: [], presenceCount: 0 }}
        attachRealtime={false}
      />,
    );

    expect(html).toContain('The table is quiet.');
    expect(html).toContain('No one is on the rail yet.');
  });

  it('[BM-039] does not let a stale rail refresh erase newer presence', () => {
    const incoming = { ...snapshot, presence: [], presenceCount: 0 };
    const latest = { ...snapshot, presence: snapshot.presence.slice(0, 1), presenceCount: 1 };

    expect(retainNewerPresence(incoming, latest, 0, 1)).toMatchObject({
      presence: latest.presence,
      presenceCount: 1,
    });
    expect(retainNewerPresence(incoming, latest, 1, 1)).toBe(incoming);
  });

  it('[BM-039] applies the enter response before receiving the presence event', async () => {
    const harness = lifecycleHarness();
    const entered: NightPresenceResponse = {
      presence: [identity.presence],
      presenceCount: 1,
    };
    const left: NightPresenceResponse = { presence: [], presenceCount: 0 };
    const onPresence = vi.fn<(presence: NightPresenceResponse) => void>();
    const mintToken = vi.fn(async () => identity);
    const changePresence = vi.fn(
      async (command: NightPresenceCommandBody): Promise<NightPresenceResponse> =>
        command.kind === 'enter' ? entered : left,
    );

    const stop = startNightPresence({
      ...harness,
      mintToken,
      changePresence,
      onPresence,
    });
    await settlePresence();

    expect(onPresence).toHaveBeenCalledWith(entered);
    harness.emit({ malformed: true });
    expect(onPresence).toHaveBeenCalledTimes(1);

    stop();
    expect(changePresence).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'leave' }),
      true,
    );
  });

  it('[BM-039] leaves and re-enters around page lifecycle events', async () => {
    const harness = lifecycleHarness();
    const entered: NightPresenceResponse = {
      presence: [identity.presence],
      presenceCount: 1,
    };
    const left: NightPresenceResponse = { presence: [], presenceCount: 0 };
    const onPresence = vi.fn<(presence: NightPresenceResponse) => void>();
    const mintToken = vi.fn(async () => identity);
    const changePresence = vi.fn(
      async (command: NightPresenceCommandBody): Promise<NightPresenceResponse> =>
        command.kind === 'enter' ? entered : left,
    );
    const stop = startNightPresence({
      ...harness,
      mintToken,
      changePresence,
      onPresence,
    });
    await settlePresence();

    harness.trigger('pagehide');
    harness.trigger('pageshow');
    await settlePresence();

    expect(mintToken).toHaveBeenCalledTimes(2);
    expect(onPresence).toHaveBeenCalledTimes(2);
    expect(changePresence.mock.calls.filter(([command]) => command.kind === 'leave')).toHaveLength(
      1,
    );
    stop();
  });
});
