/* eslint-disable @next/next/no-img-element -- Native images avoid Next/Image inline styles under strict CSP. */
import type { HouseHome } from '@between-moves/domain';
import knightsDuel from '../../../../_art/knights-duel.webp';
import { AppMasthead } from '../../../../_components/app-masthead';
import { NewGameForm, type Opponent } from './new-game-form';

/** [BM-022] The page around the seat form: a Season must be running before anyone can play. */
export function NewGameView({
  home,
  season,
  liveNightId,
  opponents,
  canPublishCharter,
}: {
  readonly home: HouseHome;
  readonly season: { readonly title: string; readonly perMoveHours: number } | null;
  readonly liveNightId: string | null;
  readonly opponents: readonly Opponent[];
  readonly canPublishCharter: boolean;
}) {
  const base = `/h/${encodeURIComponent(home.houseId)}`;
  return (
    <div className="house-shell new-game-shell">
      <AppMasthead houseId={home.houseId} houseName={home.name} current="shelf" />
      <main className="new-game-page">
        <header className="new-game-heading">
          <div>
            <p className="house-home__eyebrow">
              {season === null ? 'Between Seasons' : season.title}
            </p>
            <h1>Start a game</h1>
            <p>Leave a seat open for whoever gets there first, or challenge one Member by name.</p>
          </div>
          <img
            className="new-game-heading__art"
            src={knightsDuel.src}
            alt=""
            width={knightsDuel.width}
            height={knightsDuel.height}
          />
        </header>

        {season === null ? (
          <section className="new-game-closed" aria-labelledby="new-game-closed-title">
            <h2 id="new-game-closed-title">The table opens with a Season</h2>
            <p>
              Games count toward a Season, so one has to be running before anyone can play.{' '}
              {canPublishCharter
                ? 'Open a Season to set the table.'
                : 'Ask the Owner or a Steward to open the next Season.'}
            </p>
            <a className="house-status__action new-game-closed__action" href={`${base}/season`}>
              {canPublishCharter ? 'Open a Season' : 'See the Season'}
            </a>
          </section>
        ) : opponents.length === 0 ? (
          <section className="new-game-closed" aria-labelledby="new-game-alone-title">
            <h2 id="new-game-alone-title">You need someone to play</h2>
            <p>You are the only Member so far. Invite a friend, then come back to set the board.</p>
            <a className="house-status__action new-game-closed__action" href={`${base}/members`}>
              Invite a Member
            </a>
          </section>
        ) : (
          <NewGameForm
            houseId={home.houseId}
            perMoveHours={season.perMoveHours}
            liveNightId={liveNightId}
            opponents={opponents}
          />
        )}
      </main>
    </div>
  );
}
