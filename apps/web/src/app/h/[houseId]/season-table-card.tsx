import { standingsPreview, type StandingRow } from '../../../modules/seasons/standing-rows';
import { pointsLabel } from './season/final-standings';

/** [BM-034] The top of the running Season table, and the viewer's own place when it is lower. */
export function SeasonTableCard({
  houseId,
  rows,
}: {
  readonly houseId: string;
  readonly rows: readonly StandingRow[];
}) {
  const { top, viewer } = standingsPreview(rows);
  const shown = viewer === null ? top : [...top, viewer];
  return (
    <section className="house-table" aria-labelledby="house-table-title">
      <h2 id="house-table-title">Season table</h2>
      {rows.length === 0 ? (
        <p className="house-table__empty">No points yet.</p>
      ) : (
        <ol className="house-table__rows">
          {shown.map((row) => (
            <li
              key={row.membershipId}
              data-viewer={row.isViewer ? 'true' : undefined}
              data-leader={row.rank === 1 ? 'true' : undefined}
              data-below={row === viewer ? 'true' : undefined}
            >
              <span className="house-table__rank" aria-label={`Rank ${row.rank}`}>
                {row.rank}
              </span>
              <span className="house-table__name">
                {row.displayName}
                {row.isViewer ? <span className="roster__you">You</span> : null}
              </span>
              <span className="house-table__points">{pointsLabel(row.points)}</span>
            </li>
          ))}
        </ol>
      )}
      <a className="move-shelf__start" href={`/h/${encodeURIComponent(houseId)}/season`}>
        Full table
      </a>
    </section>
  );
}
