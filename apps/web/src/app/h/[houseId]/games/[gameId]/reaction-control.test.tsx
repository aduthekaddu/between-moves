import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReactionControl } from './reaction-control';

describe('Reaction control', () => {
  it('[BM-031] [UX-CMP-07] renders one current Reaction with text and ARIA selection', () => {
    const html = renderToStaticMarkup(
      <ReactionControl
        houseId="01941f29-7c00-7000-8000-000000000601"
        gameId="01941f29-7c00-7000-8000-000000000701"
        initialReaction="dramatic"
      />,
    );

    expect(html).toContain('React to this Game');
    expect(html).toContain('Dramatic');
    expect(html).toContain('Dramatic is your current Reaction.');
    expect(html).toContain('aria-pressed="true"');
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(3);
  });
});
