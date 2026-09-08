import type { MoveShelf } from '@between-moves/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MoveShelfView } from './move-shelf-view';

const houseId = '01941f29-7c00-7000-8000-000000000601';
const viewedAt = new Date('2026-09-07T12:00:00.000Z');
const shelf: MoveShelf = {
  yourMove: [
    {
      gameId: 'needs-overdue',
      opponentName: 'Ada',
      moveDueAt: new Date('2026-09-07T10:00:00.000Z'),
      ply: 14,
    },
    {
      gameId: 'needs-next',
      opponentName: 'Bea',
      moveDueAt: new Date('2026-09-08T12:00:00.000Z'),
      ply: 8,
    },
  ],
  waiting: [
    {
      gameId: 'waiting',
      opponentName: 'Grace',
      moveDueAt: new Date('2026-09-09T12:00:00.000Z'),
    },
  ],
  recent: [
    {
      gameId: 'recent',
      opponentName: 'Lin',
      result: 'draw',
      completedAt: new Date('2026-09-06T12:00:00.000Z'),
    },
  ],
};

describe('Move Shelf view', () => {
  it('[BM-026] [DR-SHELF-01] renders ordered, labelled shelf sections and Games', () => {
    const html = renderToStaticMarkup(
      <MoveShelfView houseId={houseId} shelf={shelf} viewedAt={viewedAt} />,
    );

    expect(html.indexOf('Your move (2)')).toBeLessThan(html.indexOf('Waiting (1)'));
    expect(html.indexOf('Waiting (1)')).toBeLessThan(html.indexOf('Recently completed (1)'));
    expect(html.indexOf('Against Ada')).toBeLessThan(html.indexOf('Against Bea'));
    expect(html).toContain('Move overdue');
    expect(html).toContain('Your move');
    expect(html).toContain('Waiting on Grace');
    expect(html).toContain('Draw');
    expect(html).toContain(`/h/${houseId}/games/needs-overdue`);
    expect(html).toContain('<time');
  });

  it('[BM-026] [PR-COPY-03] renders the empty shelf prompt without dead controls', () => {
    const html = renderToStaticMarkup(
      <MoveShelfView
        houseId={houseId}
        shelf={{ yourMove: [], waiting: [], recent: [] }}
        viewedAt={viewedAt}
      />,
    );

    expect(html).toContain('No games yet. Challenge a member or take an open seat.');
    expect(html).not.toContain('/games/new');
  });
});
