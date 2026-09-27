import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AccountView } from './account-view';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));

const first = '01941f29-7c00-7000-8000-000000000601';
const second = '01941f29-7c00-7000-8000-000000000602';

describe('AccountView', () => {
  it('[BM-050] lists the person’s Houses and offers their own data as a download', () => {
    const html = renderToStaticMarkup(
      <AccountView
        summary={{
          displayName: 'Mira',
          houses: [
            { houseId: first, name: 'Knights at Dusk', role: 'steward' },
            { houseId: second, name: 'The Long Table', role: 'member' },
          ],
        }}
      />,
    );

    expect(html).toContain('<h1 id="account-title">Mira</h1>');
    expect(html).toContain(`<a href="/h/${first}">Knights at Dusk</a>`);
    expect(html).toContain('Steward');
    expect(html).toContain(`<a href="/h/${second}">The Long Table</a>`);
    expect(html).toContain('<a class="account-download" href="/api/account/export" download="">');
    expect(html).toContain('It holds nothing written by other Members.');
    expect(html).toContain('Delete my account');
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it('[BM-050] names the Houses an Owner must hand over before deleting', () => {
    const html = renderToStaticMarkup(
      <AccountView
        summary={{
          displayName: 'Ada',
          houses: [{ houseId: first, name: 'Knights at Dusk', role: 'owner' }],
        }}
      />,
    );

    expect(html).toContain('Owner');
    expect(html).toContain('You own Knights at Dusk. Transfer ownership before you delete');
    expect(html).not.toContain('Delete my account</button>');
  });

  it('[BM-050] says so when the person belongs to no House', () => {
    const html = renderToStaticMarkup(<AccountView summary={{ displayName: 'Lin', houses: [] }} />);
    expect(html).toContain('You are not a Member of any House right now.');
    expect(html).not.toContain('<ul class="account-houses"');
  });
});
