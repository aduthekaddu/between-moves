import type { ClosedSeasonView } from '@between-moves/domain';

/** Format the score with a singular unit only for exactly one point. */
function pointsLabel(points: number): string {
  return points === 1 ? '1 point' : `${points} points`;
}

/** [BM-047] The last closed Season's frozen standings, shown until a new Season begins. */
export function FinalStandings({ season }: { readonly season: ClosedSeasonView }) {
  return (
    <section className="season-final" aria-labelledby="season-final-title">
      <p className="season-eyebrow">Season closed · Final standings</p>
      <h2 id="season-final-title">{season.title}</h2>
      <p className="season-final__dates">
        {season.startsAt.toLocaleDateString('en-GB')} – {season.endsAt.toLocaleDateString('en-GB')}
        {' · '}closed {season.closedAt.toLocaleDateString('en-GB')}
      </p>
      {season.standings.length === 0 ? (
        <p>No Member scored this Season.</p>
      ) : (
        <ol className="season-final__table">
          {season.standings.map((standing) => (
            <li
              key={standing.membershipId}
              className={standing.rank === 1 ? 'season-final__row--leader' : undefined}
            >
              <span className="season-final__rank" aria-label={`Rank ${standing.rank}`}>
                {standing.rank}
              </span>
              <span className="season-final__name">{standing.displayName}</span>
              <span className="season-final__points">{pointsLabel(standing.points)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
