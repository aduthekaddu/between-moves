import { BrandMark } from './brand-mark';

export type HouseSection = 'shelf' | 'season' | 'puzzles' | 'game' | 'night';

/**
 * One masthead for every House page: the mark, where you are, and the three rooms of a
 * House. Night pages use the dark tone.
 */
export function AppMasthead({
  houseId,
  houseName,
  current,
  tone = 'day',
}: {
  readonly houseId: string;
  readonly houseName?: string;
  readonly current: HouseSection;
  readonly tone?: 'day' | 'night';
}) {
  const base = `/h/${encodeURIComponent(houseId)}`;
  const rooms = [
    { id: 'shelf', label: 'Move shelf', href: base },
    { id: 'season', label: 'Season', href: `${base}/season` },
    { id: 'puzzles', label: 'Puzzles', href: `${base}/puzzles` },
  ] as const;
  return (
    <header className="app-masthead" data-tone={tone}>
      <a className="app-masthead__brand" href={base}>
        <BrandMark className="app-masthead__mark" />
        <span className="app-masthead__names">
          <span className="app-masthead__product">Between Moves</span>
          {houseName === undefined ? null : (
            <span className="app-masthead__house">{houseName}</span>
          )}
        </span>
      </a>
      <nav className="app-masthead__nav" aria-label="House">
        {rooms.map((room) => (
          <a key={room.id} href={room.href} aria-current={current === room.id ? 'page' : undefined}>
            {room.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
