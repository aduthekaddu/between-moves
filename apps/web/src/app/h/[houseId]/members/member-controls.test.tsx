// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeaveHouse } from './leave-house';
import { MemberActions } from './member-actions';

const refresh = vi.fn();
const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, replace }) }));

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  refresh.mockReset();
  replace.mockReset();
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

async function click(name: string) {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === name,
  );
  if (button === undefined) throw new Error(`Missing button ${name}`);
  await act(async () => button.click());
}

async function mountMember(viewerIsOwner = true) {
  await act(async () =>
    root.render(
      <MemberActions
        houseId="house"
        member={{ membershipId: 'member', displayName: 'Priya', role: 'member' }}
        viewerIsOwner={viewerIsOwner}
      />,
    ),
  );
}

async function mountLeave(isOwner = false) {
  await act(async () =>
    root.render(<LeaveHouse houseId="house" houseName="Thursday Table" isOwner={isOwner} />),
  );
}

describe('House member controls', () => {
  it('[BM-015] changes a Member’s role and refreshes the roster', async () => {
    await mountMember();
    await click('Make Steward');

    expect(fetchMock).toHaveBeenCalledWith('/api/houses/house/members/member/role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'steward' }),
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('[BM-015] confirms removal and reports an authorization failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await mountMember(false);
    expect(container.textContent).not.toContain('Hand over the House');
    await click('Remove from House');
    expect(fetchMock).not.toHaveBeenCalled();
    await click('Keep Priya');
    expect(container.textContent).toContain('Remove from House');
    await click('Remove from House');
    await click('Remove Priya');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/houses/house/members/member/remove');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Your role in this House does not allow that.',
    );
    expect(refresh).not.toHaveBeenCalled();

    await click('Remove Priya');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('[BM-015] uses an idempotency key when handing over ownership', async () => {
    await mountMember();
    await click('Hand over the House');
    expect(fetchMock).not.toHaveBeenCalled();
    await click('Make Priya the Owner');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/houses/house/transfer');
    expect(JSON.parse(String(init.body))).toEqual({ toMembershipId: 'member' });
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Priya now owns the House.',
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('Leaving a House', () => {
  it('[BM-015] asks Owners to hand over the House first', async () => {
    await mountLeave(true);
    expect(container.textContent).toContain('first hand it to another Member');
    expect(container.querySelector('button')).toBeNull();
  });

  it('[BM-015] confirms leaving, keeps the Member on failure, then opens their account', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ detail: 'You cannot leave yet.' }, { status: 409 }),
    );
    await mountLeave();
    await click('Leave this House');
    expect(fetchMock).not.toHaveBeenCalled();
    await click('Stay');
    await click('Leave this House');
    await click('Leave the House');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('You cannot leave yet.');
    expect(replace).not.toHaveBeenCalled();

    await click('Leave the House');
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/houses/house/leave');
    expect(replace).toHaveBeenCalledWith('/account');
    expect(refresh).toHaveBeenCalledOnce();
  });
});
