import type {
  HouseHome,
  HouseRoster,
  HouseSeasonView,
  MembershipRole,
  MoveShelf,
  OpenSeatListing,
} from '@between-moves/domain';
import type { StandingRow } from '../../../modules/seasons/standing-rows';
import { AppMasthead } from '../../_components/app-masthead';
import { HouseEmblem } from '../../_components/house-emblem';
import { houseGuide, welcomeLines } from './house-guide';
import { HouseSetup } from './house-setup';
import { HouseWelcome } from './house-welcome';
import { MoveShelfView } from './move-shelf-view';
import { OpenSeatsView } from './open-seats-view';
import { seasonOpeningFor } from './season/season-opening';
import { SeasonTableCard } from './season-table-card';

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

/**
 * A challenge already waiting comes first, so the newcomer answers it instead of opening a
 * second Game. Otherwise a lone other Member gets challenged by name.
 */
function welcomeAction(
  roster: HouseRoster,
  openSeats: readonly OpenSeatListing[],
  base: string,
): { label: string; href: string } {
  const waiting = openSeats.find((seat) => seat.viewerMayAccept);
  if (waiting !== undefined) {
    return {
      label:
        waiting.intended === null
          ? `Take ${waiting.creator.name}’s open seat`
          : `Answer ${waiting.creator.name}’s challenge`,
      href: '#open-seats',
    };
  }
  const others = roster.members.filter(
    (member) => member.membershipId !== roster.viewerMembershipId,
  );
  const only = others.length === 1 ? others[0] : undefined;
  return only === undefined
    ? { label: 'Start a game', href: `${base}/games/new` }
    : {
        label: `Challenge ${only.displayName}`,
        href: `${base}/games/new?opponent=${encodeURIComponent(only.membershipId)}`,
      };
}

/** [BM-013] [UX-IA-01] Member-visible, narrow-first House home shell. */
export function HouseHomeView({
  home,
  shelf,
  viewedAt,
  openSeats = [],
  liveNightId = null,
  roster,
  season,
  standings,
  welcomeDismissed,
  today,
}: {
  readonly home: HouseHome;
  readonly shelf: MoveShelf;
  readonly viewedAt: Date;
  readonly openSeats?: readonly OpenSeatListing[];
  readonly liveNightId?: string | null;
  readonly roster: HouseRoster;
  readonly season: HouseSeasonView | null;
  /** The active Season's ranked table; ignored when no Season is active. */
  readonly standings: readonly StandingRow[];
  readonly welcomeDismissed: boolean;
  /** The House's calendar date, which a one-press Season starts on. */
  readonly today: string;
}) {
  const base = `/h/${encodeURIComponent(home.houseId)}`;
  const guide = houseGuide({ roster, season, shelf, openSeats, welcomeDismissed });
  const opening = seasonOpeningFor(season?.state === 'draft' ? season : null, today);
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

        {liveNightId === null ? null : (
          <a
            className="house-live-night"
            href={`${base}/nights/${encodeURIComponent(liveNightId)}`}
          >
            <span className="house-live-night__pip" aria-hidden="true" />
            <span className="house-live-night__words">
              <strong>The Night is live</strong>
              <span>Every board in view and one House chat. Pull up a chair on the rail.</span>
            </span>
            <span className="house-live-night__arrow" aria-hidden="true">
              →
            </span>
          </a>
        )}

        <div className="house-home__grid">
          <div className="house-home__main">
            {guide.kind === 'setup' ? (
              <HouseSetup
                houseId={home.houseId}
                houseName={home.name}
                steps={guide.steps}
                opening={opening.initial}
                progress={opening.progress}
              />
            ) : guide.kind === 'welcome' ? (
              <HouseWelcome
                houseId={home.houseId}
                houseName={home.name}
                lines={welcomeLines(season)}
                action={welcomeAction(roster, openSeats, base)}
              />
            ) : null}
            <OpenSeatsView houseId={home.houseId} seats={openSeats} viewedAt={viewedAt} />
            <MoveShelfView houseId={home.houseId} shelf={shelf} viewedAt={viewedAt} />
          </div>

          <div className="house-home__side">
            {season?.state === 'active' ? (
              <SeasonTableCard houseId={home.houseId} rows={standings} />
            ) : null}
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
                className={
                  guide.kind === 'setup'
                    ? 'house-status__action house-status__action--quiet'
                    : 'house-status__action'
                }
                href={`${base}/games/new`}
              >
                Start a game
              </a>
              <a
                className="house-status__action house-status__action--quiet"
                href={`${base}/season`}
              >
                Open the Season table
              </a>
              <a
                className="house-status__action house-status__action--quiet"
                href={`${base}/members`}
              >
                {home.membershipRole === 'member' ? 'Members' : 'Members and invitations'}
              </a>
              <a
                className="house-status__action house-status__action--quiet"
                href={`${base}/puzzles`}
              >
                House Puzzles
              </a>
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}
