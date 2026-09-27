import type {
  ClosingBookAward,
  ClosingBookContents,
  ClosingBookGame,
  ClosingBookMember,
  ClosingBookParticipant,
  ClosingBookSwing,
  HouseClosingBook,
  PublishedClosingBook,
} from '@between-moves/domain';
import { PositionBoard } from '../../../_components/position-board';

const names = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' });

/** Pair a count with its noun, singular only for exactly one. */
function count(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

/** Join display names the way the House would say them: `Ada, Bea and Cy`. */
function nameList(members: readonly ClosingBookMember[]): string {
  return names.format(members.map((member) => member.displayName));
}

/** Format a day and short month in the House's time zone, optionally with the year. */
function dateLabel(iso: string | Date, timeZone: string, withYear = false): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone,
  });
}

const AWARD_TITLES: Readonly<Record<ClosingBookAward['kind'], string>> = {
  season_leader: 'Top of the table',
  most_games: 'Most games finished',
  most_wins: 'Most wins',
  night_regular: 'Night regular',
  puzzle_setter: 'Puzzle setter',
};

/** Say what earned the award, in the Season's own counts. */
function awardReason(award: ClosingBookAward, totals: ClosingBookContents['totals']): string {
  const shared = award.recipients.length > 1;
  switch (award.kind) {
    case 'season_leader':
      return shared
        ? `Shared first place on ${count(award.value, 'point')}.`
        : `Finished first with ${count(award.value, 'point')}.`;
    case 'most_games':
      return `${shared ? 'Each finished' : 'Finished'} ${count(award.value, 'game')}, the most this Season.`;
    case 'most_wins':
      return `${shared ? 'Each won' : 'Won'} ${count(award.value, 'game')}, the most this Season.`;
    case 'night_regular':
      return `${shared ? 'Each came to' : 'Came to'} ${award.value} of ${count(totals.nightsHeld, 'Between Moves Night')}.`;
    case 'puzzle_setter':
      return `${shared ? 'Each set' : 'Set'} ${count(award.value, 'House Puzzle')}, the most this Season.`;
  }
}

const REASONS: Readonly<Record<ClosingBookGame['resultReason'], string>> = {
  checkmate: 'by checkmate',
  stalemate: 'by stalemate',
  insufficient_material: 'on insufficient material',
  repetition: 'by repetition',
  fifty_move: 'by the fifty-move rule',
  flag: 'on the clock',
  resign: 'by resignation',
  agreement: 'by agreement',
  timeout: 'on time',
};

const SCORES: Readonly<Record<ClosingBookGame['result'], string>> = {
  white_win: '1–0',
  black_win: '0–1',
  draw: '½–½',
};

/** Describe a finished Game's result and how it ended, naming the winner first. */
function gameSummary(game: ClosingBookGame): string {
  if (game.result === 'draw') {
    return `${game.white.displayName} and ${game.black.displayName} drew ${REASONS[game.resultReason]}`;
  }
  const [winner, loser] =
    game.result === 'white_win' ? [game.white, game.black] : [game.black, game.white];
  return `${winner.displayName} beat ${loser.displayName} ${REASONS[game.resultReason]}`;
}

/** Chess move numbering: `12.` for White's move, `12…` for Black's. */
function moveLabel(swing: ClosingBookSwing): string {
  return `${Math.ceil(swing.ply / 2)}${swing.ply % 2 === 1 ? '.' : '…'} ${swing.san}`;
}

/** Express an evaluation swing in pawns to one decimal place. */
function pawns(centipawns: number): string {
  return (centipawns / 100).toFixed(1);
}

/** The booklet cover: House, Season title and dates, the leader, and Season totals. */
function Cover({ shelf, book }: { shelf: HouseClosingBook; book: PublishedClosingBook }) {
  const { season, totals, participation } = book.contents;
  const leaders = participation.filter(
    (participant) => participant.rank === 1 && participant.points > 0,
  );
  return (
    <header className="closing-book-desk">
      <div className="closing-book-cover">
        <p className="season-eyebrow">Closing Book · {shelf.houseName}</p>
        <h1 id="closing-book-title">{season.title}</h1>
        <p className="closing-book-cover__dates">
          {dateLabel(season.startsAt, shelf.timeZone)} –{' '}
          {dateLabel(season.endsAt, shelf.timeZone, true)}
        </p>
        {leaders.length === 0 ? null : (
          <p className="closing-book-cover__leader">
            <span aria-hidden="true">1 · </span>
            <span className="visually-hidden">First place: </span>
            {nameList(leaders)}
          </p>
        )}
        <dl className="closing-book-totals">
          <div>
            <dt>Members</dt>
            <dd>{totals.members}</dd>
          </div>
          <div>
            <dt>Games</dt>
            <dd>{totals.gamesCompleted}</dd>
          </div>
          <div>
            <dt>Nights</dt>
            <dd>{totals.nightsHeld}</dd>
          </div>
          <div>
            <dt>Puzzles</dt>
            <dd>{totals.puzzlesPublished}</dd>
          </div>
        </dl>
      </div>
    </header>
  );
}

/** Season awards, each explained by the count that earned it. */
function Awards({ contents }: { contents: ClosingBookContents }) {
  return (
    <section className="closing-book-section" aria-labelledby="closing-book-awards">
      <div className="closing-book-section__heading">
        <h2 id="closing-book-awards">Season awards</h2>
        <p>
          For {contents.season.title} only. They describe this Season and are not carried into the
          next.
        </p>
      </div>
      {contents.awards.length === 0 ? (
        <p className="closing-book-empty">
          No awards this Season: nobody finished a game, came to a Night or set a puzzle.
        </p>
      ) : (
        <ul className="closing-book-awards">
          {contents.awards.map((award) => (
            <li
              key={award.kind}
              className={
                award.kind === 'season_leader'
                  ? 'closing-book-award closing-book-award--leader'
                  : 'closing-book-award'
              }
            >
              <p className="closing-book-award__title">{AWARD_TITLES[award.kind]}</p>
              <h3>{nameList(award.recipients)}</h3>
              <p>{awardReason(award, contents.totals)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One Member's Season in words, leaving out what they did not do. */
function participationRecord(participant: ClosingBookParticipant): string {
  const results = [
    participant.wins > 0 ? `${participant.wins} won` : null,
    participant.draws > 0 ? `${participant.draws} drawn` : null,
    participant.losses > 0 ? `${participant.losses} lost` : null,
  ].filter((part) => part !== null);
  const parts = [
    participant.gamesCompleted > 0
      ? `${count(participant.gamesCompleted, 'game')}: ${results.join(', ')}`
      : null,
    participant.nightsAttended > 0 ? count(participant.nightsAttended, 'Night') : null,
    participant.puzzlesPublished > 0 ? count(participant.puzzlesPublished, 'House Puzzle') : null,
  ].filter((part) => part !== null);
  return parts.length === 0 ? 'No games, Nights or puzzles this Season' : parts.join(' · ');
}

/** Every Member on the final table, ranked, with what they did this Season. */
function Participation({ contents }: { contents: ClosingBookContents }) {
  return (
    <section className="closing-book-section" aria-labelledby="closing-book-participation">
      <div className="closing-book-section__heading">
        <h2 id="closing-book-participation">Who turned up</h2>
        <p>Everyone on the final table, with the games, Nights and puzzles behind their points.</p>
      </div>
      <ol className="closing-book-roll">
        {contents.participation.map((participant) => (
          <li
            key={participant.membershipId}
            className={participant.rank === 1 ? 'closing-book-roll__leader' : undefined}
          >
            <span className="closing-book-roll__rank">
              <span className="visually-hidden">Rank </span>
              {participant.rank}
            </span>
            <span className="closing-book-roll__who">
              <span className="closing-book-roll__name">{participant.displayName}</span>
              <span className="closing-book-roll__record">{participationRecord(participant)}</span>
            </span>
            <span className="closing-book-roll__points">{count(participant.points, 'point')}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The Season's memorable swings, one per Game, largest first. */
function Swings({ contents }: { contents: ClosingBookContents }) {
  const games = new Map(contents.games.map((game) => [game.gameId, game]));
  return (
    <section className="closing-book-section" aria-labelledby="closing-book-swings">
      <div className="closing-book-section__heading">
        <h2 id="closing-book-swings">Memorable swings</h2>
        <p>The moves after which the evaluation turned furthest, one from each game.</p>
      </div>
      {contents.swings.length === 0 ? (
        <p className="closing-book-empty">No analysed game swung far enough to remember.</p>
      ) : (
        <ol className="closing-book-swings">
          {contents.swings.map((swing) => {
            const game = games.get(swing.gameId);
            return (
              <li key={`${swing.gameId}-${swing.ply}`} className="closing-book-swing">
                <p className="closing-book-swing__size">
                  <span className="closing-book-swing__pawns">{pawns(swing.swingCp)}</span>
                  <span>pawns</span>
                </p>
                <h3>
                  {swing.mover.displayName}’s{' '}
                  <span className="closing-book-move">{moveLabel(swing)}</span>
                </h3>
                <p>
                  {game === undefined
                    ? `${swing.mover.displayName} vs ${swing.opponent.displayName}`
                    : `${game.white.displayName} vs ${game.black.displayName}`}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** Every finished Game in the order it ended, as a scoresheet. */
function Games({ contents, timeZone }: { contents: ClosingBookContents; timeZone: string }) {
  return (
    <section className="closing-book-section" aria-labelledby="closing-book-games">
      <div className="closing-book-section__heading">
        <h2 id="closing-book-games">Every game finished</h2>
        <p>{count(contents.games.length, 'game')}, in the order they ended.</p>
      </div>
      {contents.games.length === 0 ? (
        <p className="closing-book-empty">No games were finished this Season.</p>
      ) : (
        <ol className="closing-book-games">
          {contents.games.map((game) => (
            <li key={game.gameId}>
              <time dateTime={game.completedAt}>{dateLabel(game.completedAt, timeZone)}</time>
              <span className="closing-book-games__summary">
                {gameSummary(game)}
                <span className="closing-book-games__detail">
                  {count(Math.ceil(game.plies / 2), 'move')} ·{' '}
                  {game.mode === 'live' ? 'live' : 'correspondence'}
                </span>
              </span>
              <span className="closing-book-games__score">{SCORES[game.result]}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** House Puzzles confirmed this Season, each with its position. */
function Puzzles({ contents, timeZone }: { contents: ClosingBookContents; timeZone: string }) {
  return (
    <section className="closing-book-section" aria-labelledby="closing-book-puzzles">
      <div className="closing-book-section__heading">
        <h2 id="closing-book-puzzles">House Puzzles</h2>
        <p>Confirmed by Members from positions in this Season’s own games.</p>
      </div>
      {contents.puzzles.length === 0 ? (
        <p className="closing-book-empty">No House Puzzles were set this Season.</p>
      ) : (
        <ul className="closing-book-puzzles">
          {contents.puzzles.map((puzzle) => (
            <li key={puzzle.puzzleId} className="puzzle-card">
              <div>
                <p className="house-home__eyebrow">
                  Set by {puzzle.contributor.displayName} ·{' '}
                  {dateLabel(puzzle.publishedAt, timeZone)}
                </p>
                <h3>{puzzle.prompt}</h3>
              </div>
              <PositionBoard fen={puzzle.positionFen} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A published Closing Book, cover to colophon. */
function PublishedBook({ shelf, book }: { shelf: HouseClosingBook; book: PublishedClosingBook }) {
  const { contents } = book;
  return (
    <article className="closing-book" aria-labelledby="closing-book-title">
      <Cover shelf={shelf} book={book} />
      <Awards contents={contents} />
      <Participation contents={contents} />
      <Swings contents={contents} />
      <Games contents={contents} timeZone={shelf.timeZone} />
      <Puzzles contents={contents} timeZone={shelf.timeZone} />
      <footer className="closing-book-colophon">
        <p>
          Bound {dateLabel(book.publishedAt, shelf.timeZone, true)} from the House ledger and games
          as they stood when {contents.season.title} closed. Edition {book.generationVersion}.
        </p>
      </footer>
    </article>
  );
}

/**
 * [BM-049] What follows the book: the next Season once it is under way or, while the table is
 * open, the way into a new Charter for an Owner or Steward. Nothing in the book carries over.
 */
function NextSeason({
  houseId,
  shelf,
  book,
}: {
  houseId: string;
  shelf: HouseClosingBook;
  book: PublishedClosingBook;
}) {
  const seasonHref = `/h/${encodeURIComponent(houseId)}/season`;
  const renews = shelf.membershipRole !== 'member';
  const { title } = book.contents.season;
  return (
    <section className="closing-book-next" aria-labelledby="closing-book-next-title">
      <p className="season-eyebrow">The next Season</p>
      {shelf.activeSeason === null ? (
        <>
          <h2 id="closing-book-next-title">The table is open.</h2>
          <p>
            {renews
              ? `Publish a Charter to start the next Season. Nothing carries over from ${title}: points, standings and awards begin again from zero.`
              : `When an Owner or Steward publishes the next Charter, a new Season begins from zero. ${title} stays here, on the House’s shelf.`}
          </p>
          {renews ? (
            <a className="closing-book-next__action" href={seasonHref}>
              Start the next Season
            </a>
          ) : null}
        </>
      ) : (
        <>
          <h2 id="closing-book-next-title">{shelf.activeSeason.title} is under way.</h2>
          <p>A fresh table: its points, standings and awards started again from zero.</p>
          <a className="closing-book-next__action" href={seasonHref}>
            Open the Season table
          </a>
        </>
      )}
    </section>
  );
}

/**
 * [BM-048] The House's Closing Book for its latest Season: a stitched paper booklet of who
 * turned up, every finished game, the memorable swings, House Puzzles and Season awards.
 * [BM-049] A published book ends with the House's next Season.
 */
export function ClosingBookView({
  houseId,
  shelf,
}: {
  readonly houseId: string;
  readonly shelf: HouseClosingBook;
}) {
  if (shelf.season !== null && shelf.book !== null) {
    return (
      <>
        <PublishedBook shelf={shelf} book={shelf.book} />
        <NextSeason houseId={houseId} shelf={shelf} book={shelf.book} />
      </>
    );
  }
  return (
    <section className="closing-book-waiting" aria-labelledby="closing-book-title">
      <p className="season-eyebrow">
        Closing Book{shelf.season === null ? null : ` · ${shelf.season.title}`}
      </p>
      <h1 id="closing-book-title">
        {shelf.season === null ? 'Nothing bound yet.' : 'Being bound.'}
      </h1>
      <p>
        {shelf.season === null
          ? 'When a Season closes, its Closing Book of standings, games, swings, puzzles and awards is written here for the House.'
          : `${shelf.season.title} has closed. Its Closing Book is being written from the House ledger and will be here shortly.`}
      </p>
    </section>
  );
}
