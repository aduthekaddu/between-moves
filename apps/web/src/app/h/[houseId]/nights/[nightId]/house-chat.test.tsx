import fc from 'fast-check';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HouseChat } from './house-chat';

const snapshot = {
  houseId: '01941f29-7c00-7000-8000-000000000201',
  nightId: '01941f29-7c00-7000-8000-000000000901',
  chatSequence: '1',
  currentMembershipId: '01941f29-7c00-7000-8000-000000000621',
  canModerate: true,
  messages: [
    {
      id: '01941f29-7c00-7000-8000-000000000801',
      membershipId: '01941f29-7c00-7000-8000-000000000623',
      authorDisplayName: 'Bea',
      body: 'Hello from the rail',
      sequence: '1',
      createdAt: '2026-09-18T14:00:00.000Z',
    },
  ],
};

function render(body: string, canModerate = false): string {
  return renderToStaticMarkup(
    <HouseChat
      houseId={snapshot.houseId}
      nightId={snapshot.nightId}
      snapshot={{
        ...snapshot,
        canModerate,
        messages: [{ ...snapshot.messages[0]!, body }],
      }}
      acceptsMessages
      onPosted={() => undefined}
      onDeleted={() => undefined}
    />,
  );
}

describe('House chat UI', () => {
  it('[BM-040] [DR-CHAT-02] escapes script/HTML chat bodies', () => {
    const html = render('<script>alert("owned")</script><img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;script&gt;alert(&quot;owned&quot;)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
  });

  it('[BM-040] fuzzes HTML-like input without creating executable elements', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (input) => {
        const html = render(`<script>${input}</script>`);
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
      }),
    );
  });

  it('[BM-040] exposes an accessible composer and moderation control', () => {
    const html = render('A close finish', true);
    expect(html).toContain('House chat');
    expect(html).toContain('Your message');
    expect(html).toContain('0/2000');
    expect(html).toContain('A close finish');
    expect(html).toContain('Remove message from Bea');
    expect(html).toContain('aria-label="House chat messages"');
  });

  it('[BM-040] explains that chat is closed after the Night ends', () => {
    const html = renderToStaticMarkup(
      <HouseChat
        houseId={snapshot.houseId}
        nightId={snapshot.nightId}
        snapshot={{ ...snapshot, messages: [] }}
        nightState="ended"
        acceptsMessages={false}
        onPosted={() => undefined}
        onDeleted={() => undefined}
      />,
    );
    expect(html).toContain('Chat closed when this Night ended.');
    expect(html).not.toContain('Your message');
  });

  it('[BM-040] does not render a removed message', () => {
    const html = renderToStaticMarkup(
      <HouseChat
        houseId={snapshot.houseId}
        nightId={snapshot.nightId}
        snapshot={{ ...snapshot, messages: [] }}
        acceptsMessages
        onPosted={() => undefined}
        onDeleted={() => undefined}
      />,
    );
    expect(html).toContain('No messages yet.');
    expect(html).not.toContain('Hello from the rail');
  });
});
