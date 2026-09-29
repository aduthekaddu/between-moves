// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_TIME_CONTROLS, NewGameForm, offeredColorFor } from './new-game-form';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const opponents = [{ membershipId: '01941f29-7c00-7000-8000-000000000302', displayName: 'Theo' }];
let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ gameId: 'g', openSeatId: 's' }), { status: 201 }),
    );
  vi.stubGlobal('fetch', fetchMock);
  push.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount(liveNightId: string | null = null) {
  await act(async () =>
    root.render(
      <NewGameForm
        houseId="house"
        perMoveHours={48}
        liveNightId={liveNightId}
        opponents={opponents}
      />,
    ),
  );
}

async function choose(selector: string) {
  const input = container.querySelector<HTMLInputElement>(selector);
  expect(input, selector).not.toBeNull();
  await act(async () => input!.click());
}

async function submit() {
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

function sent(): Record<string, unknown> {
  const body = (fetchMock.mock.calls.at(-1)?.[1] as RequestInit | undefined)?.body;
  if (typeof body !== 'string') throw new Error('No game creation request body was sent');
  return JSON.parse(body) as Record<string, unknown>;
}

describe('Start a game form', () => {
  it('[BM-022] offers the taker the side the creator did not pick', () => {
    expect(offeredColorFor('white')).toBe('black');
    expect(offeredColorFor('black')).toBe('white');
    expect(offeredColorFor('either')).toBe('any');
    expect(Math.min(...LIVE_TIME_CONTROLS.map((control) => control.initialMs))).toBe(180_000);
  });

  it('[BM-022] opens a correspondence seat at the Charter pace', async () => {
    await mount();
    expect(container.querySelector<HTMLInputElement>('input[value="live"]')?.disabled).toBe(true);
    await choose('input[value="white"]');
    await submit();

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/houses/house/games');
    expect(sent()).toEqual({
      mode: 'correspondence',
      clockPolicy: { kind: 'correspondence', perMoveHours: 48 },
      offeredColor: 'black',
    });
    expect(push).toHaveBeenCalledWith('/h/house#open-seats');
  });

  it('[BM-022] challenges one Member to a live Game on the live Night', async () => {
    await mount('night-1');
    await choose('input[value="live"]');
    await choose('input[value="5+3"]');
    await choose('input[value="challenge"]');
    const select = container.querySelector<HTMLSelectElement>('select');
    await act(async () => {
      select!.value = opponents[0]!.membershipId;
      select!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await submit();

    expect(sent()).toEqual({
      mode: 'live',
      nightId: 'night-1',
      clockPolicy: { kind: 'live', initialMs: 300_000, incrementMs: 3_000 },
      offeredColor: 'any',
      intendedMembershipId: opponents[0]!.membershipId,
    });
  });

  it('[BM-022] asks for an opponent before sending a challenge', async () => {
    await mount();
    await choose('input[value="challenge"]');
    await submit();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Choose the Member you want to challenge.',
    );
  });

  it('[BM-022] shows the server reason when the House cannot start the game', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'House has no active Season' }), { status: 409 }),
    );
    await mount();
    await submit();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'House has no active Season',
    );
    expect(push).not.toHaveBeenCalled();
  });
});
