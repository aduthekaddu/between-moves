import { Fragment } from 'react';

/**
 * Big lines cut from black card and raised into place on rods. The title goes letter by
 * letter; surtitles go a word at a time so a long line settles quickly. The words are read
 * from a visually hidden copy; the cut pieces are decoration. Positions come from :nth-child
 * in CSS, so the stagger needs no inline styles and no script.
 */
export function RodText({
  text,
  by = 'word',
}: {
  readonly text: string;
  readonly by?: 'word' | 'letter';
}) {
  const words = text.split(' ');
  return (
    <>
      <span className="visually-hidden">{text}</span>
      <span className={by === 'letter' ? 'rod rod--letters' : 'rod rod--words'} aria-hidden="true">
        {words.map((word, w) => (
          <Fragment key={`${word}-${w}`}>
            {w === 0 ? null : ' '}
            <span className="rod__w">
              {by === 'letter'
                ? Array.from(word).map((letter, i) => (
                    <span key={`${letter}-${i}`} className="rod__l">
                      {letter}
                    </span>
                  ))
                : word}
            </span>
          </Fragment>
        ))}
      </span>
    </>
  );
}
