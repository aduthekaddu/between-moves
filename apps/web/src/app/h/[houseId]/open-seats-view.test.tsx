import type { OpenSeatListing } from '@between-moves/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OpenSeatsView } from './open-seats-view';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const houseId = '01941f29-7c00-7000-8000-000000000201';
const viewedAt = new Date('2026-09-02T10:00:00.000Z');
const ada = { membershipId: '01941f29-7c00-7000-8000-000000000301', name: 'Ada' };
const bea = { membershipId: '01941f29-7c00-7000-8000-000000000302', name: 'Bea' };

function seat(overrides: Partial<OpenSeatListing>): OpenSeatListing {
  return {
    gameId: '01941f29-7c00-7000-8000-000000000501',
    openSeatId: '01941f29-7c00-7000-8000-000000000502',
    mode: 'correspondence',
    clockPolicy: { kind: 'correspondence', perMoveHours: 48 },
    nightId: null,
    offeredColor: 'white',
    creator: ada,
    intended: null,
    createdAt: new Date('2026-09-01T10:00:00.000Z'),
    expiresAt: new Date('2026-09-08T10:00:00.000Z'),
    viewerIsCreator: false,
    viewerMayAccept: true,
    ...overrides,
  };
}

describe('Open seats on the House home', () => {
  it('[BM-023] renders nothing when no seat is waiting', () => {
    expect(
      renderToStaticMarkup(<OpenSeatsView houseId={houseId} seats={[]} viewedAt={viewedAt} />),
    ).toBe('');
  });

  it('[BM-023] puts challenges for the viewer first and offers the right action on each', () => {
    const html = renderToStaticMarkup(
      <OpenSeatsView
        houseId={houseId}
        viewedAt={viewedAt}
        seats={[
          seat({ openSeatId: 'own', viewerIsCreator: true, viewerMayAccept: false }),
          seat({ openSeatId: 'open' }),
          seat({
            openSeatId: 'challenge',
            intended: bea,
            offeredColor: 'any',
            mode: 'live',
            clockPolicy: { kind: 'live', initialMs: 600_000, incrementMs: 5_000 },
          }),
        ]}
      />,
    );

    const challenge = html.indexOf('Ada challenges you');
    const open = html.indexOf('Ada wants a game');
    const own = html.indexOf('Waiting for a player');
    expect(challenge).toBeGreaterThan(-1);
    expect(challenge).toBeLessThan(open);
    expect(open).toBeLessThan(own);
    expect(html).toContain('Live · 10 + 5');
    expect(html).toContain('Colours by lot');
    expect(html).toContain('Correspondence · 48 h a Move');
    expect(html).toContain('>Accept<');
    expect(html).toContain('>Decline<');
    expect(html).toContain('>Take the seat<');
    expect(html).toContain('>Cancel seat<');
    // own seat: cancel; open seat: take; challenge: accept and decline
    expect(html.match(/<button/g)).toHaveLength(4);
    expect(html).toContain('Closes in');
  });

  it('[BM-023] names the side the viewer plays from their point of view', () => {
    const taker = renderToStaticMarkup(
      <OpenSeatsView houseId={houseId} viewedAt={viewedAt} seats={[seat({})]} />,
    );
    const creator = renderToStaticMarkup(
      <OpenSeatsView
        houseId={houseId}
        viewedAt={viewedAt}
        seats={[seat({ viewerIsCreator: true, viewerMayAccept: false, intended: bea })]}
      />,
    );

    expect(taker).toContain('You play White');
    expect(creator).toContain('You play Black');
    expect(creator).toContain('Waiting on Bea');
    expect(creator).toContain('>Withdraw challenge<');
    expect(creator).not.toContain('>Accept<');
  });
});
