import type {
  MoveShelf,
  MoveShelfActiveGame,
  MoveShelfCompletedGame,
  MoveShelfResult,
} from '@between-moves/domain';

function durationLabel(milliseconds: number): string {
  const absolute = Math.abs(milliseconds);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (absolute < hour) {
    const minutes = Math.max(1, Math.ceil(absolute / minute));
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  }
  if (absolute < 2 * day) {
    const hours = Math.ceil(absolute / hour);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  const days = Math.ceil(absolute / day);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

function Deadline({ dueAt, viewedAt }: { readonly dueAt: Date; readonly viewedAt: Date }) {
  const remaining = dueAt.getTime() - viewedAt.getTime();
  return (
    <time dateTime={dueAt.toISOString()}>
      {remaining <= 0
        ? `${durationLabel(remaining)} overdue`
        : `${durationLabel(remaining)} remaining`}
    </time>
  );
}

function ActiveGameCard({
  houseId,
  game,
  viewedAt,
  kind,
}: {
  readonly houseId: string;
  readonly game: MoveShelfActiveGame;
  readonly viewedAt: Date;
  readonly kind: 'your-move' | 'waiting';
}) {
  const overdue = game.moveDueAt.getTime() <= viewedAt.getTime();
  const status =
    kind === 'waiting' ? `Waiting on ${game.opponentName}` : overdue ? 'Move overdue' : 'Your move';

  return (
    <li data-game-id={game.gameId}>
      <a
        className={`move-card${overdue ? ' move-card--overdue' : ''}`}
        href={`/h/${encodeURIComponent(houseId)}/games/${encodeURIComponent(game.gameId)}`}
      >
        <span className={`move-card__status${overdue ? ' move-card__status--overdue' : ''}`}>
          <span aria-hidden="true">{overdue ? '!' : kind === 'your-move' ? '●' : '◷'}</span>
          <span>{status}</span>
        </span>
        <strong>Against {game.opponentName}</strong>
        <span className="move-card__time">
          {kind === 'waiting' && overdue ? 'Move overdue · ' : ''}
          <Deadline dueAt={game.moveDueAt} viewedAt={viewedAt} />
        </span>
      </a>
    </li>
  );
}

function resultLabel(result: MoveShelfResult): string {
  switch (result) {
    case 'white_win':
      return 'White won';
    case 'black_win':
      return 'Black won';
    case 'draw':
      return 'Draw';
    case 'aborted':
      return 'Game ended';
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}

function CompletedGameCard({
  game,
  viewedAt,
}: {
  readonly game: MoveShelfCompletedGame;
  readonly viewedAt: Date;
}) {
  return (
    <li data-game-id={game.gameId}>
      <article className="move-card">
        <span className="move-card__status">
          <span aria-hidden="true">✓</span>
          {resultLabel(game.result)}
        </span>
        <strong>Against {game.opponentName}</strong>
        <time className="move-card__time" dateTime={game.completedAt.toISOString()}>
          Completed {durationLabel(game.completedAt.getTime() - viewedAt.getTime())} ago
        </time>
      </article>
    </li>
  );
}

/** [BM-026] [UX-CMP-02] Narrow-first, text-labelled Move Shelf. */
export function MoveShelfView({
  houseId,
  shelf,
  viewedAt,
}: {
  readonly houseId: string;
  readonly shelf: MoveShelf;
  readonly viewedAt: Date;
}) {
  const empty = shelf.yourMove.length + shelf.waiting.length + shelf.recent.length === 0;

  return (
    <section className="move-shelf" aria-labelledby="move-shelf-title">
      <div className="move-shelf__heading">
        <p className="house-home__eyebrow">Correspondence games</p>
        <h2 id="move-shelf-title">Move shelf</h2>
      </div>

      {empty ? (
        <div className="move-shelf__empty">
          <p>No games yet. Challenge a member or take an open seat.</p>
          <a className="move-shelf__start" href={`/h/${encodeURIComponent(houseId)}/games/new`}>
            Start a game
          </a>
        </div>
      ) : (
        <div className="move-shelf__groups">
          <section aria-labelledby="your-move-title" data-shelf-group="your-move">
            <h3 id="your-move-title">Your move ({shelf.yourMove.length})</h3>
            {shelf.yourMove.length === 0 ? (
              <p className="move-shelf__group-empty">No move needs you right now.</p>
            ) : (
              <ul>
                {shelf.yourMove.map((game) => (
                  <ActiveGameCard
                    key={game.gameId}
                    houseId={houseId}
                    game={game}
                    viewedAt={viewedAt}
                    kind="your-move"
                  />
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="waiting-title" data-shelf-group="waiting">
            <h3 id="waiting-title">Waiting ({shelf.waiting.length})</h3>
            {shelf.waiting.length === 0 ? (
              <p className="move-shelf__group-empty">No one else owes a move.</p>
            ) : (
              <ul>
                {shelf.waiting.map((game) => (
                  <ActiveGameCard
                    key={game.gameId}
                    houseId={houseId}
                    game={game}
                    viewedAt={viewedAt}
                    kind="waiting"
                  />
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="recent-title" data-shelf-group="recent">
            <h3 id="recent-title">Recently completed ({shelf.recent.length})</h3>
            {shelf.recent.length === 0 ? (
              <p className="move-shelf__group-empty">Completed Games will rest here.</p>
            ) : (
              <ul>
                {shelf.recent.map((game) => (
                  <CompletedGameCard key={game.gameId} game={game} viewedAt={viewedAt} />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
