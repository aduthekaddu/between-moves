import type {
  HouseNightView,
  HouseSeasonView,
  MembershipRole,
  NightRecurrence,
} from '@between-moves/domain';
import { CharterAuthoringForm } from './charter-authoring-form';
import { NightSchedule } from './night-schedule';
import { PointsRecipe } from './points-recipe';

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function nightLabel(recurrence: NightRecurrence): string {
  return `${weekdays[recurrence.weekday] ?? 'Weekly'} at ${recurrence.localTime}`;
}

function ActiveSeason({
  houseId,
  membershipRole,
  nights,
  season,
  timeZone,
}: {
  readonly houseId: string;
  readonly membershipRole: MembershipRole;
  readonly nights: readonly HouseNightView[];
  readonly season: HouseSeasonView;
  readonly timeZone: string;
}) {
  const charter = season.charter;
  if (charter === null || season.startsAt === null || season.endsAt === null) return null;
  const status = season.state === 'active' ? 'Season active' : `Season ${season.state}`;
  return (
    <article className="season-active" aria-labelledby="season-active-title">
      <p className="season-eyebrow">{status}</p>
      <h1 id="season-active-title">{season.title}</h1>
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
      <PointsRecipe recipe={charter.pointsRecipe} />
      <NightSchedule
        houseId={houseId}
        membershipRole={membershipRole}
        timeZone={timeZone}
        initialNights={nights}
      />
    </article>
  );
}

/** [BM-019] Season status for Members and Charter authoring for Owner/Steward. */
export function SeasonView({
  houseId,
  membershipRole,
  nights = [],
  season,
  timeZone = 'UTC',
}: {
  readonly houseId: string;
  readonly membershipRole: MembershipRole;
  readonly nights?: readonly HouseNightView[];
  readonly season: HouseSeasonView | null;
  readonly timeZone?: string;
}) {
  if (season !== null && season.state !== 'draft') {
    return (
      <ActiveSeason
        houseId={houseId}
        membershipRole={membershipRole}
        nights={nights}
        season={season}
        timeZone={timeZone}
      />
    );
  }
  if (membershipRole === 'member') {
    return (
      <section className="season-passive" aria-labelledby="season-passive-title">
        <p className="season-eyebrow">Season</p>
        <h1 id="season-passive-title">The table is waiting.</h1>
        <p>Your House is quiet. Publish a Charter to start the season.</p>
      </section>
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
    />
  );
}
