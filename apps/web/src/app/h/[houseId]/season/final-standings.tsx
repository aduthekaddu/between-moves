import type { ClosedSeasonView, FinalSeasonStanding } from '@between-moves/domain';
import { seasonDayLabel } from './season-opening';

/** Format the score with a singular unit only for exactly one point. */
export function pointsLabel(points: number): string {
  return points === 1 ? '1 point' : `${points} points`;
}

/** Ranked rows on the painted scoreboard: the leader is lit and the viewer's own row is tagged. */
export function StandingsBoard({
  rows,
}: {
  readonly rows: readonly (FinalSeasonStanding & { readonly isViewer?: boolean })[];
}) {
  return (
    <ol className="season-final__table">
      {rows.map((standing) => (
        <li
          key={standing.membershipId}
          className={standing.rank === 1 ? 'season-final__row--leader' : undefined}
          data-viewer={standing.isViewer === true ? 'true' : undefined}
        >
          <span className="season-final__rank" aria-label={`Rank ${standing.rank}`}>
            {standing.rank}
          </span>
          <span className="season-final__name">
            {standing.displayName}
            {standing.isViewer === true ? <span className="season-final__you">You</span> : null}
          </span>
          <span className="season-final__points">{pointsLabel(standing.points)}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * [BM-047] Frozen standings for a closing Season or the last closed one, shown until a new
 * Season begins. [BM-048] Links to that Season's Closing Book.
 */
export function FinalStandings({
  houseId,
  season,
}: {
  readonly houseId: string;
  readonly season: ClosedSeasonView;
}) {
  return (
    <section className="season-final" aria-labelledby="season-final-title">
      <p className="season-eyebrow">
        {season.state === 'closing'
          ? 'Season closing · Standings frozen'
          : 'Season closed · Final standings'}
      </p>
      <h2 id="season-final-title">{season.title}</h2>
      <p className="season-final__dates">
        {seasonDayLabel(season.startsAt)} – {seasonDayLabel(season.endsAt)}
        {season.closedAt === null ? null : ` · closed ${seasonDayLabel(season.closedAt)}`}
      </p>
      {season.standings.length === 0 ? (
        <p>No Member scored this Season.</p>
      ) : (
        <StandingsBoard rows={season.standings} />
      )}
      <a className="season-final__book" href={`/h/${encodeURIComponent(houseId)}/closing-book`}>
        Read the Closing Book
      </a>
    </section>
  );
}
