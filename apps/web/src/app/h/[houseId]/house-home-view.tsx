import type { HouseHome, MembershipRole } from '@between-moves/domain';

function roleLabel(role: MembershipRole): string {
  switch (role) {
    case 'owner':
      return 'Owner';
    case 'steward':
      return 'Steward';
    case 'member':
      return 'Member';
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}

function emblemGlyph(seed: string): string {
  const glyphs = ['◆', '●', '✦', '■'] as const;
  const checksum = Array.from(seed).reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return glyphs[checksum % glyphs.length] ?? '◆';
}

/** [BM-013] [UX-IA-01] Member-visible, narrow-first House home shell. */
export function HouseHomeView({ home }: { readonly home: HouseHome }) {
  return (
    <div className="house-shell">
      <header className="house-masthead">
        <p className="house-masthead__brand">Between Moves</p>
        <p className="house-masthead__place">Private House</p>
      </header>

      <main className="house-home">
        <section className="house-identity" aria-labelledby="house-name">
          <div className="house-emblem" role="img" aria-label={`${home.name} emblem`}>
            <span aria-hidden="true">{emblemGlyph(home.emblemSeed)}</span>
          </div>
          <div>
            <p className="house-home__eyebrow">Your chess house</p>
            <h1 id="house-name" className="house-home__title">
              {home.name}
            </h1>
            <p className="house-home__description">
              {home.description ?? 'A quiet table, ready for the first game.'}
            </p>
          </div>
        </section>

        <aside className="house-status" aria-labelledby="house-status-title">
          <p className="house-home__eyebrow">House status</p>
          <h2 id="house-status-title" className="house-status__title">
            The table is set.
          </h2>
          <p className="house-status__copy">
            This is the shared front door for your House. It stays private to active Members.
          </p>
          <dl className="house-details">
            <div>
              <dt>Your place</dt>
              <dd>{roleLabel(home.membershipRole)}</dd>
            </div>
            <div>
              <dt>House time</dt>
              <dd>{home.timeZone}</dd>
            </div>
          </dl>
        </aside>
      </main>
    </div>
  );
}
