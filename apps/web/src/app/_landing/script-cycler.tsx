'use client';

import { useEffect, useRef, useState } from 'react';
import { CHESS_WORDS } from './content';

/** The word for chess, set in each script in turn, in one variable family. */
export function ScriptCycler() {
  const root = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const [heldUntil, setHeldUntil] = useState(0);

  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(Boolean(entry?.isIntersecting)),
      {
        threshold: 0.3,
      },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => {
      if (Date.now() < heldUntil) return;
      setIndex((value) => (value + 1) % CHESS_WORDS.length);
    }, 1700);
    return () => window.clearInterval(timer);
  }, [visible, heldUntil]);

  const current = CHESS_WORDS[index] ?? CHESS_WORDS[0];

  return (
    <div className="lp-scripts" ref={root}>
      <p
        key={index}
        className="lp-scripts__word"
        lang={current.lang}
        dir={current.lang === 'ur' ? 'rtl' : 'ltr'}
        aria-hidden="true"
      >
        {current.word}
      </p>
      <p className="lp-scripts__gloss lp-mono" aria-hidden="true">
        <span>{current.language}</span>
        <span>{current.say}</span>
      </p>
      <ul className="lp-scripts__list" aria-label="The word for chess">
        {CHESS_WORDS.map((entry, i) => (
          <li key={entry.lang}>
            <button
              type="button"
              aria-pressed={i === index}
              onClick={() => {
                setIndex(i);
                setHeldUntil(Date.now() + 5000);
              }}
            >
              <span lang={entry.lang}>{entry.word}</span>
              <span className="lp-mono">{entry.language}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
