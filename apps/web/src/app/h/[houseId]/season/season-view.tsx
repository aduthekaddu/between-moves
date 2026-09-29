import type {
  ClosedSeasonView,
  HouseNightView,
  HouseSeasonView,
  MembershipRole,
  NightHostCandidate,
  NightRecurrence,
} from '@between-moves/domain';
import type { ReactNode } from 'react';
import { CharterAuthoringForm } from './charter-authoring-form';
import { CloseSeasonPanel } from './close-season-panel';
import { FinalStandings } from './final-standings';
import { NightSchedule } from './night-schedule';
import { PointsRecipe } from './points-recipe';
import { PreviousSeason } from './previous-season';

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function nightLabel(recurrence: NightRecurrence): string {
  return `${weekdays[recurrence.weekday] ?? 'Weekly'} at ${recurrence.localTime}`;
}

/**
 * Render Season details and role-appropriate controls, or only the recap if its Charter or
 * dates are missing. Owners and Stewards can close an active Season or resume a closing one.
 * [BM-049] `previous` links a renewed Season back to the last Season's Closing Book.
 */
function ActiveSeason({
  houseId,
  membershipRole,
  nights,
  hostCandidates,
  season,
  recap,
  previous,
  timeZone,
}: {
  readonly houseId: string;
  readonly membershipRole: MembershipRole;
  readonly nights: readonly HouseNightView[];
  readonly hostCandidates: readonly NightHostCandidate[];
  readonly season: HouseSeasonView;
  readonly recap: ReactNode;
  readonly previous: ReactNode;
  readonly timeZone: string;
}) {
  const charter = season.charter;
  if (charter === null || season.startsAt === null || season.endsAt === null) return recap;
  const status = season.state === 'active' ? 'Season active' : `Season ${season.state}`;
  return (
    <article className="season-active" aria-labelledby="season-active-title">
      <span className="season-parade" aria-hidden="true" />
      <p className="season-eyebrow">{status}</p>
      <h1 id="season-active-title">{season.title}</h1>
      {recap}
      <p className="season-active__version">Charter version {charter.version}</p>
      <dl className="season-active__details">
        <div>
          <dt>Dates</dt>
          <dd>
            {season.startsAt.toLocaleDateString('en-GB')} –{' '}
            {season.endsAt.toLocaleDateString('en-GB')}
          </dd>
        </div>
        <div>
          <dt>Correspondence pace</dt>
          <dd>{charter.correspondencePaceHours} hours per Move</dd>
        </div>
        <div>
          <dt>Between Moves Night</dt>
          <dd>{nightLabel(charter.nightRecurrence)}, four weeks</dd>
        </div>
      </dl>
      {previous}
      <PointsRecipe recipe={charter.pointsRecipe} />
      <NightSchedule
        houseId={houseId}
        membershipRole={membershipRole}
        timeZone={timeZone}
        initialNights={nights}
        hostCandidates={hostCandidates}
      />
      {membershipRole !== 'member' && (season.state === 'active' || season.state === 'closing') ? (
        <CloseSeasonPanel houseId={houseId} seasonId={season.seasonId} state={season.state} />
      ) : null}
    </article>
  );
}

/**
 * [BM-019] Season status for Members and Charter authoring for Owner/Steward.
 * Show the supplied frozen-standings recap when the current Season is absent, a draft, or
 * itself still closing. The recap follows the page's h1 in the document so the outline
 * starts there; CSS lifts it above that heading on screen.
 * [BM-049] After a close, the Charter starts the next Season from zero; once it is active the
 * recap gives way to a link to the last Season's Closing Book.
 */
export function SeasonView({
  houseId,
  membershipRole,
  nights = [],
  hostCandidates = [],
  season,
  lastClosed = null,
  timeZone = 'UTC',
}: {
  readonly houseId: string;
  readonly membershipRole: MembershipRole;
  readonly nights?: readonly HouseNightView[];
  readonly hostCandidates?: readonly NightHostCandidate[];
  readonly season: HouseSeasonView | null;
  readonly lastClosed?: ClosedSeasonView | null;
  readonly timeZone?: string;
}) {
  const recap =
    lastClosed === null ? null : <FinalStandings houseId={houseId} season={lastClosed} />;
  if (season !== null && season.state !== 'draft') {
    const frozen =
      season.state === 'closing' && lastClosed?.seasonId === season.seasonId ? recap : null;
    const previous =
      season.state === 'active' && lastClosed !== null ? (
        <PreviousSeason houseId={houseId} title={lastClosed.title} />
      ) : null;
    return (
      <ActiveSeason
        houseId={houseId}
        membershipRole={membershipRole}
        nights={nights}
        hostCandidates={hostCandidates}
        season={season}
        recap={frozen}
        previous={previous}
        timeZone={timeZone}
      />
    );
  }
  if (membershipRole === 'member') {
    return (
      <>
        <section className="season-passive" aria-labelledby="season-passive-title">
          <p className="season-eyebrow">Season</p>
          <h1 id="season-passive-title">The table is waiting.</h1>
          <p>
            {lastClosed === null
              ? 'Your House is quiet. Publish a Charter to start the season.'
              : `${lastClosed.title} is closed. When an Owner or Steward publishes the next Charter, a new Season starts from zero.`}
          </p>
        </section>
        {recap}
      </>
    );
  }
  return (
    <CharterAuthoringForm
      houseId={houseId}
      draftSeasonId={season?.seasonId}
      initialTitle={season?.title}
      initialPaceHours={season?.charter?.correspondencePaceHours}
      initialWeekday={season?.charter?.nightRecurrence.weekday}
      initialLocalTime={season?.charter?.nightRecurrence.localTime}
      initialCharterVersioned={season?.charter !== null && season?.charter !== undefined}
      previousSeasonTitle={lastClosed?.title}
      recap={recap}
    />
  );
}
