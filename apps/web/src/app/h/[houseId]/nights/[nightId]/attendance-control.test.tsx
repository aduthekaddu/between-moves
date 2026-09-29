// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttendanceControl, type RailAttendance } from './attendance-control';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ attendanceId: 'a' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  refresh.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount(initial: RailAttendance | null, live = true) {
  await act(async () =>
    root.render(
      <AttendanceControl
        houseId="house"
        nightId="night"
        live={live}
        initial={initial}
        thresholdSeconds={900}
      />,
    ),
  );
}

async function press(name: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === name,
  );
  expect(button, name).toBeDefined();
  await act(async () => button!.click());
}

describe('Night attendance on the rail', () => {
  it('[BM-036] joins the live Night and shows the Member at the table', async () => {
    await mount(null);
    expect(container.textContent).toContain('Pull up a chair.');
    expect(container.textContent).toContain('or finish a live Game');

    await press('Pull up a chair');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/houses/house/nights/night/join',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(container.textContent).toContain('You are at the table.');
    expect(container.textContent).toContain('At 15, tonight counts toward your Season.');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('[BM-036] steps away through the durable leave command', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await mount({
      joinedAt: new Date(Date.now() - 16 * 60_000).toISOString(),
      accumulatedSeconds: 0,
      qualified: false,
    });
    expect(container.textContent).toContain(
      'That is 15 minutes: tonight counts when you step away or the Night ends.',
    );

    await press('Step away');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/houses/house/nights/night/leave');
    expect(container.textContent).toContain('Pull up a chair');
  });

  it('[BM-036] stamps a counted Night and summarises an ended one without controls', async () => {
    await mount({ joinedAt: null, accumulatedSeconds: 1_260, qualified: true }, false);

    expect(container.textContent).toContain('You were at the table for 21 minutes.');
    expect(container.textContent).toContain('Counted');
    expect(container.querySelector('button')).toBeNull();
  });

  it('[BM-036] renders nothing on a Night that is not live and was never joined', async () => {
    await mount(null, false);
    expect(container.innerHTML).toBe('');
  });

  it('[BM-036] explains when the Night has already ended', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await mount(null);
    await press('Pull up a chair');

    expect(container.querySelector('[role="alert"]')?.textContent).toBe('The Night has ended.');
    expect(refresh).not.toHaveBeenCalled();
  });
});
