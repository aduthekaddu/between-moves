import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppMasthead } from './app-masthead';

const houseId = '01941f29-7c00-7000-8000-000000000601';

describe('AppMasthead', () => {
  it('links the three rooms of the House and marks the current one', () => {
    const html = renderToStaticMarkup(
      <AppMasthead houseId={houseId} houseName="Knights at Dusk" current="season" />,
    );
    expect(html).toContain(`href="/h/${houseId}/season" aria-current="page"`);
    expect(html).toContain(`href="/h/${houseId}/puzzles"`);
    expect(html).toContain('Knights at Dusk');
    expect(html.match(/aria-current/g)).toHaveLength(1);
  });

  it('[BM-050] links to the account page outside the House rooms', () => {
    const html = renderToStaticMarkup(<AppMasthead houseId={houseId} current="shelf" />);
    expect(html).toContain('<a class="app-masthead__account" href="/account">Account</a>');
    expect(html).toMatch(/<\/nav><a class="app-masthead__account"/);
  });

  it('never claims a room on pages outside them, and can switch to the Night tone', () => {
    const html = renderToStaticMarkup(
      <AppMasthead houseId={houseId} current="night" tone="night" />,
    );
    expect(html).not.toContain('aria-current');
    expect(html).toContain('data-tone="night"');
    expect(html).not.toContain('<h1');
  });
});
