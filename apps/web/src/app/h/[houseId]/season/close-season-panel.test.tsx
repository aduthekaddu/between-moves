// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloseSeasonPanel } from './close-season-panel';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const houseId = '01941f29-7c00-7000-8000-000000000201';
const seasonId = '01941f29-7c00-7000-8000-000000000701';
let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

function button(name: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === name,
  );
  if (match === undefined) throw new Error(`Missing button ${name}`);
  return match;
}

async function click(name: string): Promise<void> {
  await act(async () => {
    button(name).click();
  });
}

async function render(state: 'active' | 'closing'): Promise<void> {
  await act(async () => {
    root.render(<CloseSeasonPanel houseId={houseId} seasonId={seasonId} state={state} />);
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  refresh.mockReset();
  fetchMock = vi.fn(async () => Response.json({ seasonId, state: 'closed' }));
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

describe('CloseSeasonPanel', () => {
  it('[BM-047] asks for inline confirmation before closing and refreshes afterwards', async () => {
    await render('active');
    expect(container.querySelector('h2')?.textContent).toBe('Close the Season');

    await click('Close Season');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
      'Confirm Season close',
    );

    await click('Keep playing');
    expect(container.querySelector('[role="group"]')).toBeNull();

    await click('Close Season');
    await click('Close and finalize standings');
    expect(fetchMock).toHaveBeenCalledWith(`/api/houses/${houseId}/seasons/${seasonId}/close`, {
      method: 'POST',
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('[BM-047] offers a single retry control for a Season left in closing', async () => {
    await render('closing');
    expect(container.querySelector('h2')?.textContent).toBe('Finish closing');

    await click('Finish closing');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('[BM-047] shows the server problem detail and re-enables the controls', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ detail: 'Only an Owner or Steward can close a Season.' }, { status: 403 }),
    );
    await render('active');
    await click('Close Season');
    await click('Close and finalize standings');

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Only an Owner or Steward can close a Season.',
    );
    expect(button('Close and finalize standings').disabled).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('[BM-047] falls back to a generic message when the failure has no problem body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('gateway timeout', { status: 504 }));
    await render('closing');
    await click('Finish closing');

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'The Season could not be closed. Try again.',
    );
  });
});
