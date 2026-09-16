import type { GamePosition, GameReactionValue } from '@between-moves/domain';
import { MoveEntry } from './move-entry';
import { ReactionControl } from './reaction-control';

/** [BM-027] [UX-RESP-02] Narrow-first correspondence Game page. */
export function GameView({
  houseId,
  position,
  currentReaction = null,
}: {
  readonly houseId: string;
  readonly position: GamePosition;
  readonly currentReaction?: GameReactionValue | null;
}) {
  return (
    <div className="game-shell">
      <header className="game-masthead">
        <a href={`/h/${encodeURIComponent(houseId)}`}>← Move shelf</a>
        <span>Correspondence Game</span>
      </header>
      <main className="game-main">
        <header className="game-title">
          <p className="house-home__eyebrow">Correspondence board</p>
          <h1>
            {position.white.name} <span aria-hidden="true">—</span>{' '}
            <span className="visually-hidden">versus </span>
            {position.black.name}
          </h1>
          <p>
            {position.white.name} plays White. {position.black.name} plays Black.
          </p>
        </header>
        {position.mode === 'correspondence' ? (
          <MoveEntry houseId={houseId} gameId={position.gameId} initial={position} />
        ) : (
          <section className="game-live-notice" aria-labelledby="live-title">
            <h2 id="live-title">Live Game</h2>
            <p>Live Move entry is available on wider screens during Between Moves Night.</p>
          </section>
        )}
        {position.state === 'completed' ? (
          <ReactionControl
            houseId={houseId}
            gameId={position.gameId}
            initialReaction={currentReaction}
          />
        ) : null}
      </main>
    </div>
  );
}
