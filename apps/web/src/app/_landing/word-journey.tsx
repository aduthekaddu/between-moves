import { JOURNEY } from './content';

/**
 * The game's name on tour: each stop borrowed the word from the one before. Native spellings
 * are set in their own scripts; the route is a row of punched holes, like a ticket's stub.
 */
export function WordJourney() {
  return (
    <div className="lp-journey">
      <ol className="lp-journey__route">
        {JOURNEY.map((stop, index) => (
          <li key={stop.word} className="lp-journey__stop" data-reveal>
            <span className="lp-journey__index">{String(index + 1).padStart(2, '0')}</span>
            {stop.native === null ? null : (
              <span className="lp-journey__native" lang={stop.lang} data-script={stop.font}>
                {stop.native}
              </span>
            )}
            <span className="lp-journey__word" lang={stop.lang}>
              {stop.word}
            </span>
            <span className="lp-journey__where">{stop.where}</span>
          </li>
        ))}
      </ol>
      <p className="lp-journey__mate" data-reveal>
        <span lang="fa">Shāh māt</span>: the king is helpless.
        <span className="lp-journey__check">Checkmate.</span>
      </p>
    </div>
  );
}
