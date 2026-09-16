import fc from 'fast-check';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GameNotes } from './game-notes';

const createdAt = new Date('2026-09-16T08:00:00.000Z');

function render(body: string): string {
  return renderToStaticMarkup(
    <GameNotes
      houseId="01941f29-7c00-7000-8000-000000000601"
      gameId="01941f29-7c00-7000-8000-000000000701"
      initial={{
        currentMembershipId: '01941f29-7c00-7000-8000-000000000201',
        notes: [
          {
            membershipId: '01941f29-7c00-7000-8000-000000000201',
            authorDisplayName: 'Ada',
            body,
            createdAt,
            editedAt: null,
          },
        ],
      }}
    />,
  );
}

describe('Game notes UI', () => {
  it('[BM-032] [DR-CHAT-02] escapes script/HTML note bodies', () => {
    const html = render('<script>alert("owned")</script><img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;script&gt;alert(&quot;owned&quot;)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
  });

  it('[BM-032] fuzzes HTML-like input without creating executable elements', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (input) => {
        const html = render(`<script>${input}</script>`);
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
      }),
    );
  });

  it('[BM-032] exposes an accessible, bounded editable note control', () => {
    const html = render('A close finish');
    expect(html).toContain('Game notes');
    expect(html).toContain('Your post-game note');
    expect(html).toContain('14/2000');
    expect(html).toContain('A close finish');
  });

  it('[BM-032] counts astral Unicode as one character per code point', () => {
    const html = render('😀'.repeat(1_001));
    expect(html).toContain('1001/2000');
    expect(html).not.toContain('2002/2000');
  });
});
