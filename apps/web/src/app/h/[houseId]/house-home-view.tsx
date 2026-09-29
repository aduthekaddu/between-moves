import type { HouseHome, MembershipRole, MoveShelf } from '@between-moves/domain';
import { AppMasthead } from '../../_components/app-masthead';
import { HouseEmblem } from '../../_components/house-emblem';
import { MoveShelfView } from './move-shelf-view';

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

/** [BM-013] [UX-IA-01] Member-visible, narrow-first House home shell. */
export function HouseHomeView({
  home,
  shelf,
  viewedAt,
}: {
  readonly home: HouseHome;
  readonly shelf: MoveShelf;
  readonly viewedAt: Date;
}) {
  return (
    <div className="house-shell">
      <AppMasthead houseId={home.houseId} houseName={home.name} current="shelf" />

      <main className="house-home">
        <section className="house-identity" aria-labelledby="house-name">
          <HouseEmblem
            className="house-emblem"
            seed={home.emblemSeed}
            label={`${home.name} emblem`}
          />
          <div className="house-identity__words">
            <p className="house-home__eyebrow">Your chess house</p>
            <h1 id="house-name" className="house-home__title">
              {home.name}
            </h1>
            <p className="house-home__description">
              {home.description ?? 'A quiet table, ready for the first game.'}
            </p>
          </div>
        </section>

        <div className="house-home__grid">
          <MoveShelfView houseId={home.houseId} shelf={shelf} viewedAt={viewedAt} />

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
            <a
              className="house-status__action"
              href={`/h/${encodeURIComponent(home.houseId)}/season`}
            >
              Open the Season table
            </a>
            <a
              className="house-status__action house-status__action--quiet"
              href={`/h/${encodeURIComponent(home.houseId)}/puzzles`}
            >
              House Puzzles
            </a>
          </aside>
        </div>
      </main>
    </div>
  );
}
