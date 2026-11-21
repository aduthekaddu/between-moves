import { StandingsBoard } from './final-standings';
import type { StandingRow } from '../../../../modules/seasons/standing-rows';

/** [BM-034] The running table of an active Season, read fresh on every visit. */
export function LiveStandings({ rows }: { readonly rows: readonly StandingRow[] }) {
  return (
    <section className="season-live" aria-labelledby="season-live-title">
      <h2 id="season-live-title">Standings</h2>
      {rows.length === 0 ? (
        <p className="season-live__empty">No points yet. Finish a game to get on the table.</p>
      ) : (
        <StandingsBoard rows={rows} />
      )}
    </section>
  );
}
