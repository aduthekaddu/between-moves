'use client';

import { useEffect, useRef, useState } from 'react';
import { RAIL_CHAT, RAIL_PRESENCE } from './content';
import { fenToPieces, MiniBoard } from './mini-board';

const LIVE_LINE = [
  {
    fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
    last: ['f1', 'c4'],
    san: '3. Bc4',
  },
  {
    fen: 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
    last: ['f8', 'c5'],
    san: '3… Bc5',
  },
  {
    fen: 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/2P2N2/PP1P1PPP/RNBQK2R b KQkq - 0 4',
    last: ['c2', 'c3'],
    san: '4. c3',
  },
  {
    fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2P2N2/PP1P1PPP/RNBQK2R w KQkq - 1 5',
    last: ['g8', 'f6'],
    san: '4… Nf6',
  },
  {
    fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2BPP3/2P2N2/PP3PPP/RNBQK2R b KQkq d3 0 5',
    last: ['d2', 'd4'],
    san: '5. d4',
  },
] as const;

const QUIET_BOARD = fenToPieces('r2q1rk1/pp2bppp/2n1bn2/3p4/3P4/2NBBN2/PP3PPP/R2Q1RK1 w - - 4 11');

/** A working preview of a Night's rail: who is here, what is being played, what is said. */
export function RailDemo() {
  const root = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    // Reduced motion: the rail stays on its first frame instead of playing on.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const observer = new IntersectionObserver(
      ([entry]) => setRunning(Boolean(entry?.isIntersecting)),
      {
        threshold: 0.25,
      },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1900);
    return () => window.clearInterval(timer);
  }, [running]);

  const ply = LIVE_LINE[tick % LIVE_LINE.length] ?? LIVE_LINE[0];
  const shown = Math.min(RAIL_CHAT.length, (tick % (RAIL_CHAT.length + 2)) + 1);

  return (
    <div className="lp-rail" ref={root}>
      <header className="lp-rail__head">
        <span className="lp-rail__title">The rail</span>
        <span className="lp-rail__live">
          <span className="lp-rail__dot" aria-hidden="true" /> Live
        </span>
        <span className="lp-rail__count">{RAIL_PRESENCE.length} at the table</span>
      </header>
      <ul className="lp-rail__presence" aria-label="Here now">
        {RAIL_PRESENCE.map((member) => (
          <li key={member.name} title={member.name}>
            <span
              className="lp-avatar"
              style={{ maskImage: `url(/landing/silhouettes/${member.silhouette}.png)` }}
              aria-hidden="true"
            />
            <span className="lp-rail__name">{member.name}</span>
          </li>
        ))}
      </ul>
      <div className="lp-rail__boards">
        <figure className="lp-rail__board">
          <MiniBoard
            pieces={fenToPieces(ply.fen)}
            highlight={ply.last}
            label={`Anjali versus Rohan, live. Last move ${ply.san}.`}
          />
          <figcaption>
            <span>Anjali v Rohan</span>
            <span className="lp-mono" key={ply.san}>
              {ply.san}
            </span>
          </figcaption>
        </figure>
        <figure className="lp-rail__board lp-rail__board--quiet">
          <MiniBoard pieces={QUIET_BOARD} label="Kabir versus Farhan, White to move." />
          <figcaption>
            <span>Kabir v Farhan</span>
            <span className="lp-mono">11. …</span>
          </figcaption>
        </figure>
      </div>
      <ol className="lp-rail__chat" aria-label="House chat">
        {RAIL_CHAT.slice(0, shown).map((message) => (
          <li key={message.body}>
            <strong>{message.who}</strong> {message.body}
          </li>
        ))}
      </ol>
    </div>
  );
}
