// @vitest-environment happy-dom
import type { HouseSeasonView } from '@between-moves/domain';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CharterAuthoringForm } from './charter-authoring-form';
import { seasonOpeningFor } from './season-opening';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const houseId = '01941f29-7c00-7000-8000-000000000201';
const seasonId = '01941f29-7c00-7000-8000-000000000703';
let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

/** Type into a controlled field the way a browser does, so React sees the change. */
async function fill(label: string, value: string): Promise<void> {
  const field = container.querySelector<HTMLInputElement>(`#${labelTarget(label)}`);
  if (field === null) throw new Error(`Missing field ${label}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** The id of the control a visible label names. */
function labelTarget(label: string): string {
  const match = [...container.querySelectorAll('label')].find(
    (candidate) => candidate.textContent === label,
  );
  if (match === undefined) throw new Error(`Missing label ${label}`);
  return match.htmlFor;
}

function field(id: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`#${id}`);
  if (input === null) throw new Error(`Missing #${id}`);
  return input;
}

/** The printed end date beside the start field. */
function seasonEnds(): string | null | undefined {
  return container.querySelector('.charter-field__value')?.textContent;
}

/** Render the form a House sees on `today`, optionally renewing after a closed Season. */
async function render(today: string, previousSeasonTitle?: string): Promise<void> {
  await act(async () => {
    root.render(
      <CharterAuthoringForm
        houseId={houseId}
        {...seasonOpeningFor(null, today)}
        previousSeasonTitle={previousSeasonTitle}
        recap={<section className="season-final">Summer tables · Final standings</section>}
      />,
    );
  });
}

async function submit(): Promise<void> {
  const form = container.querySelector('form');
  if (form === null) throw new Error('Missing Season form');
  await act(async () => {
    form.requestSubmit();
  });
}

function publishBody(): unknown {
  return JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  refresh.mockReset();
  fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/seasons')) return Response.json({ seasonId, state: 'draft' });
    if (url.endsWith('/charter')) return Response.json({ seasonId, version: 1 });
    return Response.json({ seasonId, state: 'active', publishedCharterVersion: 1 });
  });
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('CharterAuthoringForm', () => {
  it('[BM-019] opens a Season named for this month, starting today, in one press', async () => {
    await render('2026-11-04');

    expect(container.querySelector('h1')?.textContent).toBe('Open a Season');
    expect(field('charter-title').value).toBe('November Season');
    expect(field('charter-start').value).toBe('2026-11-04');
    expect(seasonEnds()).toBe('2 December 2026');
    expect(container.querySelectorAll('input[type="date"]')).toHaveLength(1);

    await submit();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `/api/houses/${houseId}/seasons`,
      `/api/houses/${houseId}/seasons/${seasonId}/charter`,
      `/api/houses/${houseId}/seasons/${seasonId}/publish`,
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      correspondencePaceHours: 24,
      nightRecurrence: { weekday: 5, localTime: '19:30', count: 4 },
    });
    expect(publishBody()).toEqual({
      title: 'November Season',
      startsAt: '2026-11-04T00:00:00.000Z',
      endsAt: '2026-12-02T00:00:00.000Z',
    });
    expect(container.querySelector('[role="status"] h1')?.textContent).toBe('November Season');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['2026-12-20', '17 January 2027', '2027-01-17T00:00:00.000Z'],
    ['2028-02-10', '9 March 2028', '2028-03-09T00:00:00.000Z'],
  ])('[BM-019] ends a Season starting %s four weeks later', async (start, shown, sent) => {
    await render('2026-11-04');

    await fill('Season starts', start);
    expect(seasonEnds()).toBe(shown);
    await submit();

    expect(publishBody()).toMatchObject({ endsAt: sent });
  });

  it('[BM-019] picks up a saved draft and publishes it without drafting again', async () => {
    const draft: HouseSeasonView = {
      seasonId,
      title: 'Draft tables',
      state: 'draft',
      startsAt: null,
      endsAt: null,
      charter: {
        version: 1,
        correspondencePaceHours: 48,
        nightRecurrence: { weekday: 2, localTime: '20:00', count: 4 },
        pointsRecipe: {
          completedGame: 1,
          win: 2,
          draw: 1,
          nightAttendance: 1,
          publishedPuzzle: 1,
          caps: { games: 8, nights: 4, puzzles: 2 },
        },
      },
    };
    await act(async () => {
      root.render(
        <CharterAuthoringForm houseId={houseId} {...seasonOpeningFor(draft, '2026-11-04')} />,
      );
    });

    expect(field('charter-title').value).toBe('Draft tables');
    expect(field('charter-pace').value).toBe('48');
    await submit();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `/api/houses/${houseId}/seasons/${seasonId}/publish`,
    ]);
  });

  it('[BM-019] asks for a start date instead of sending a Season without one', async () => {
    await render('2026-11-04');

    await fill('Season starts', '');
    await submit();

    expect(container.querySelector('#charter-start-error')?.textContent).toBe(
      'Choose the Season start date.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('[BM-049] renews a closed House and links back to the last Closing Book', async () => {
    await render('2026-10-09', 'Summer tables');
    expect(container.querySelector('.charter-form__heading')?.textContent).toContain(
      'Nothing carries over from Summer tables',
    );

    await fill('Season title', 'Winter tables');
    await submit();

    expect(publishBody()).toEqual({
      title: 'Winter tables',
      startsAt: '2026-10-09T00:00:00.000Z',
      endsAt: '2026-11-06T00:00:00.000Z',
    });
    const status = container.querySelector('[role="status"]');
    expect(status?.querySelector('h1')?.textContent).toBe('Winter tables');
    const back = status?.querySelector<HTMLAnchorElement>('.season-previous a');
    expect(back?.textContent).toBe('Read the Summer tables Closing Book');
    expect(back?.getAttribute('href')).toBe(`/h/${houseId}/closing-book`);
    expect(container.textContent).not.toContain('Final standings');
  });

  it('[BM-049] keeps the renewal form and its recap when publication fails', async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ detail: 'House already has an active or closing Season' }, { status: 409 }),
    );
    await render('2026-10-09', 'Summer tables');

    await submit();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'House already has an active or closing Season',
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.textContent).toContain('Summer tables · Final standings');
    expect(refresh).not.toHaveBeenCalled();
  });
});
