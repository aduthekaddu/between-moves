// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteAccountPanel } from './delete-account-panel';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

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

async function type(value: string): Promise<void> {
  const field = container.querySelector<HTMLInputElement>('#account-delete-phrase');
  if (field === null) throw new Error('Missing confirmation field');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function render(ownedHouses: readonly string[] = []): Promise<void> {
  await act(async () => {
    root.render(<DeleteAccountPanel ownedHouses={ownedHouses} />);
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  replace.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('DeleteAccountPanel', () => {
  it('[BM-050] explains what goes and what stays before any confirmation', async () => {
    await render();
    const text = container.textContent ?? '';

    expect(container.querySelector('h2')?.textContent).toBe('Delete your account');
    expect(text).toContain('It cannot be undone.');
    expect(text).toContain('Games, Moves, scores and Closing Books stay');
    expect(text).toContain('“Former member”');
    expect(container.querySelector('input')).toBeNull();
  });

  it('[BM-050] deletes only after the exact phrase, then leaves for the front door', async () => {
    await render();
    await click('Delete my account');
    expect(container.querySelector('label')?.textContent).toBe(
      'Type “delete my account” to confirm',
    );
    expect(button('Delete forever').disabled).toBe(true);

    await type('Delete My Account');
    expect(button('Delete forever').disabled).toBe(true);
    await type('delete my account');
    expect(button('Delete forever').disabled).toBe(false);
    await click('Delete forever');

    expect(fetchMock).toHaveBeenCalledWith('/api/account/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: 'delete my account' }),
    });
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('[BM-050] backs out without deleting and clears the typed phrase', async () => {
    await render();
    await click('Delete my account');
    await type('delete my account');
    await click('Keep my account');

    expect(container.querySelector('input')).toBeNull();
    await click('Delete my account');
    expect(container.querySelector<HTMLInputElement>('input')?.value).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('[BM-050] shows the server’s reason and allows a retry', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { detail: 'Transfer ownership of Knights at Dusk before deleting your account.' },
        { status: 409 },
      ),
    );
    await render();
    await click('Delete my account');
    await type('delete my account');
    await click('Delete forever');

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Transfer ownership of Knights at Dusk before deleting your account.',
    );
    expect(replace).not.toHaveBeenCalled();
    expect(button('Delete forever').disabled).toBe(false);

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await click('Delete forever');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Failed to fetch');

    fetchMock.mockResolvedValueOnce(new Response('not json', { status: 500 }));
    await click('Delete forever');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Your account could not be deleted. Try again.',
    );
  });

  it('[BM-050] asks an Owner to transfer ownership instead of offering deletion', async () => {
    await render(['Knights at Dusk', 'The Long Table']);

    expect(container.textContent).toContain(
      'You own Knights at Dusk and The Long Table. Transfer ownership before you delete your account.',
    );
    expect(container.querySelector('button')).toBeNull();
  });
});
