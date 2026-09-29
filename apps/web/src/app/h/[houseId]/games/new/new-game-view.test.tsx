import type { HouseHome } from '@between-moves/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NewGameView } from './new-game-view';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const houseId = '01941f29-7c00-7000-8000-000000000201';
const home: HouseHome = {
  houseId,
  name: 'The Thursday Table',
  description: null,
  emblemSeed: `house:${houseId}`,
  timeZone: 'Europe/Lisbon',
  membershipRole: 'member',
};
const theo = { membershipId: '01941f29-7c00-7000-8000-000000000302', displayName: 'Theo' };

describe('Start a game page', () => {
  it('[BM-022] explains that play opens with a Season, by role', () => {
    const member = renderToStaticMarkup(
      <NewGameView
        home={home}
        season={null}
        liveNightId={null}
        opponents={[theo]}
        canPublishCharter={false}
      />,
    );
    const steward = renderToStaticMarkup(
      <NewGameView
        home={home}
        season={null}
        liveNightId={null}
        opponents={[theo]}
        canPublishCharter
      />,
    );

    expect(member).toContain('The table opens with a Season');
    expect(member).toContain('Ask the Owner or a Steward to publish the next Charter.');
    expect(member).not.toContain('<form');
    expect(steward).toContain('Write the Charter');
    expect(steward).toContain(`href="/h/${houseId}/season"`);
  });

  it('[BM-022] sends a lone Member to invite someone first', () => {
    const html = renderToStaticMarkup(
      <NewGameView
        home={home}
        season={{ title: 'Autumn Season', perMoveHours: 48 }}
        liveNightId={null}
        opponents={[]}
        canPublishCharter
      />,
    );

    expect(html).toContain('You need someone to play');
    expect(html).toContain(`href="/h/${houseId}/members"`);
  });

  it('[BM-022] shows the Charter pace and keeps live play closed without a live Night', () => {
    const html = renderToStaticMarkup(
      <NewGameView
        home={home}
        season={{ title: 'Autumn Season', perMoveHours: 48 }}
        liveNightId={null}
        opponents={[theo]}
        canPublishCharter={false}
      />,
    );

    expect(html).toContain('Autumn Season');
    expect(html).toContain('One Move every 48 hours');
    expect(html).toContain('Opens while a Between Moves Night is live.');
    const liveRadio = html.match(/<input[^>]*value="live"[^>]*>/)?.[0] ?? '';
    expect(liveRadio).toContain('disabled=""');
  });
});
