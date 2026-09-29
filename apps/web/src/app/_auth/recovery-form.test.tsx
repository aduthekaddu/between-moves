// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecoveryForm } from './recovery-form';

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
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

async function submitWith(email: string) {
  await act(async () => root.render(<RecoveryForm />));
  const input = container.querySelector<HTMLInputElement>('#recovery-email');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, email);
    input!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

describe('Account recovery form', () => {
  it('[BM-010] posts only the trimmed email and answers the same way for any address', async () => {
    await submitWith('  maya@example.test ');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/recovery');
    expect(JSON.parse(String(init.body))).toEqual({ email: 'maya@example.test' });
    expect(container.textContent).toContain('If an account uses maya@example.test');
    expect(container.textContent).toContain('every other device is signed out');
  });

  it('[BM-010] [DR-ID-03] asks the visitor to wait when rate limited', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 429 }));
    await submitWith('maya@example.test');

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Too many requests');
    expect(container.textContent).not.toContain('Check your email');
  });

  it('[BM-010] offers a retry after a network failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await submitWith('maya@example.test');

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Please try again');
  });
});
