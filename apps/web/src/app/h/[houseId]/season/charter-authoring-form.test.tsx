// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CharterAuthoringForm } from './charter-authoring-form';

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

/** Render the Charter form, optionally renewing after a closed Season. */
async function render(previousSeasonTitle?: string): Promise<void> {
  await act(async () => {
    root.render(
      <CharterAuthoringForm
        houseId={houseId}
        previousSeasonTitle={previousSeasonTitle}
        recap={<section className="season-final">Summer tables · Final standings</section>}
      />,
    );
  });
}

/** Fill a valid four-week Charter and submit it. */
async function publish(): Promise<void> {
  await fill('Season title', 'Winter tables');
  await fill('Season starts', '2026-10-09');
  await fill('Season ends', '2026-11-06');
  const form = container.querySelector('form');
  if (form === null) throw new Error('Missing Charter form');
  await act(async () => {
    form.requestSubmit();
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
  it('[BM-049] renews a closed House through the same three publication commands', async () => {
    await render('Summer tables');
    expect(container.querySelector('.charter-form__heading')?.textContent).toContain(
      'Nothing carries over from Summer tables',
    );

    await publish();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `/api/houses/${houseId}/seasons`,
      `/api/houses/${houseId}/seasons/${seasonId}/charter`,
      `/api/houses/${houseId}/seasons/${seasonId}/publish`,
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      title: 'Winter tables',
      startsAt: '2026-10-09T00:00:00.000Z',
      endsAt: '2026-11-06T00:00:00.000Z',
    });
    const status = container.querySelector('[role="status"]');
    expect(status?.querySelector('h1')?.textContent).toBe('Winter tables');
    expect(status?.textContent).toContain('Charter version 1 is published.');
    const back = status?.querySelector<HTMLAnchorElement>('.season-previous a');
    expect(back?.textContent).toBe('Read the Summer tables Closing Book');
    expect(back?.getAttribute('href')).toBe(`/h/${houseId}/closing-book`);
    expect(container.textContent).not.toContain('Final standings');
  });

  it('[BM-019] confirms a House’s first Season without a Last Season link', async () => {
    await render();

    await publish();

    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Charter version 1 is published.',
    );
    expect(container.querySelector('.season-previous')).toBeNull();
  });

  it('[BM-049] keeps the renewal form and its recap when publication fails', async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ detail: 'House already has an active or closing Season' }, { status: 409 }),
    );
    await render('Summer tables');

    await publish();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'House already has an active or closing Season',
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.textContent).toContain('Summer tables · Final standings');
  });
});
