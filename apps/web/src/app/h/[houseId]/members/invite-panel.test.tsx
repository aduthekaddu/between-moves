// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvitePanel } from './invite-panel';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const token = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';
let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ token, expiresAt: '2026-09-09T10:00:00.000Z' }), {
      status: 201,
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => callback());
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

async function submit() {
  const form = container.querySelector('form');
  expect(form).not.toBeNull();
  await act(async () => {
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

describe('Invitation panel', () => {
  it('[BM-014] creates a shared link and shows it once, built from the returned token', async () => {
    await act(async () => root.render(<InvitePanel houseId="house" seatsLeft={5} />));
    await submit();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/houses/house/invitations');
    expect(JSON.parse(String(init.body))).toEqual({ kind: 'shared' });
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    const link = container.querySelector<HTMLInputElement>('.invite-created__link');
    expect(link?.value).toBe(`${window.location.origin}/invitations/${token}`);
    expect(container.textContent).toContain('Copy it now: it is never shown again.');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('[BM-014] sends a single-email invitation with the trimmed address', async () => {
    await act(async () => root.render(<InvitePanel houseId="house" seatsLeft={5} />));
    const single = container.querySelector<HTMLInputElement>('input[value="single"]');
    await act(async () => single!.click());
    const email = container.querySelector<HTMLInputElement>('input[type="email"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(email, '  kenji@example.test ');
      email!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await submit();

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      kind: 'single',
      intendedEmail: 'kenji@example.test',
    });
    expect(container.textContent).toContain('We’re emailing kenji@example.test.');
  });

  it('[BM-014] explains a rate limit and never shows a link on failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 429 }));
    await act(async () => root.render(<InvitePanel houseId="house" seatsLeft={5} />));
    await submit();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Too many invitations',
    );
    expect(container.querySelector('.invite-created')).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('[BM-014] disables invitations when the House is full', async () => {
    await act(async () => root.render(<InvitePanel houseId="house" seatsLeft={0} />));

    expect(container.textContent).toContain('Every seat is taken.');
    expect(container.querySelector<HTMLButtonElement>('.invite-form__submit')?.disabled).toBe(true);
  });
});
