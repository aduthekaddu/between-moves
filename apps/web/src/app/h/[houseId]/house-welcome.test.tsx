// @vitest-environment happy-dom
// @vitest-environment-options {"url": "http://localhost:3000/h/01941f29-7c00-7000-8000-000000000601"}
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HouseWelcome } from './house-welcome';

const houseId = '01941f29-7c00-7000-8000-000000000601';
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('HouseWelcome', () => {
  it('[BM-013] hides on Got it and remembers it for this House', async () => {
    await act(async () =>
      root.render(
        <HouseWelcome
          houseId={houseId}
          houseName="Knights at Dusk"
          lines={['The Season has not started yet.']}
          action={{ label: 'Start a game', href: `/h/${houseId}/games/new` }}
        />,
      ),
    );
    expect(document.cookie).not.toContain(`bm-welcome-${houseId}`);

    const gotIt = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Got it',
    );
    await act(async () => gotIt?.click());

    expect(container.textContent).toBe('');
    expect(document.cookie).toContain(`bm-welcome-${houseId}=1`);
  });
});
