// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateHouseForm } from './create-house-form';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  push.mockReset();
  refresh.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<CreateHouseForm />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function type(selector: string, value: string) {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (field === null) throw new Error(`Missing field ${selector}`);
  await act(async () => {
    const prototype =
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit() {
  const form = container.querySelector('form');
  if (form === null) throw new Error('Missing House form');
  await act(async () =>
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}

describe('CreateHouseForm', () => {
  it('[BM-013] creates a House and opens it after a valid response', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ houseId: 'house-id' }, { status: 201 }));
    await type('#new-house-name', '  The Thursday Table  ');
    await type('#new-house-time-zone', '  Europe/London  ');
    await type('#new-house-description', '  Chess after work  ');
    await submit();

    expect(fetchMock).toHaveBeenCalledWith('/api/houses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'The Thursday Table',
        timeZone: 'Europe/London',
        description: 'Chess after work',
      }),
    });
    expect(push).toHaveBeenCalledWith('/h/house-id');
    expect(refresh).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('[BM-013] reports a created House when the successful response cannot be parsed', async () => {
    fetchMock.mockResolvedValueOnce(new Response('truncated JSON', { status: 201 }));
    await submit();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'The House was created, but we could not open it. Refresh your account page.',
    );
    expect(push).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
      false,
    );
  });

  it('[BM-013] reports a created House when its response lacks an ID', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 201 }));
    await submit();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'The House was created',
    );
    expect(push).not.toHaveBeenCalled();
  });

  it('[BM-013] distinguishes a rejected request from a connection failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Your session expired. Sign in and try again.',
    );

    fetchMock.mockRejectedValueOnce(new TypeError('Network unavailable'));
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Could not connect right now. Please try again.',
    );
    expect(push).not.toHaveBeenCalled();
  });
});
