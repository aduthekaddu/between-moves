import type { Metadata } from 'next';
import type { StaticImageData } from 'next/image';
/* eslint-disable @next/next/no-img-element -- Native images avoid Next/Image inline styles under strict CSP. */
import Link from 'next/link';
import { BrandMark } from './_components/brand-mark';
import { CAST, STANDINGS, WEEK_POSTCARDS } from './_landing/content';
import { DoorForm } from './_landing/door-form';
import { HeroStage } from './_landing/hero/hero-stage';
import closingBook from './_landing/media/closing-book.webp';
import invitation from './_landing/media/invitation.webp';
import nightTerrace from './_landing/media/night-terrace.webp';
import weekBalcony from './_landing/media/week-sat-balcony.webp';
import weekLunch from './_landing/media/week-thu-lunch.webp';
import weekNight from './_landing/media/week-tue-night.webp';
import weekTrain from './_landing/media/week-mon-train.webp';
import { PuzzleCard } from './_landing/puzzle-card';
import { RailDemo } from './_landing/rail-demo';
import { RevealObserver } from './_landing/reveal';
import { ScriptCycler } from './_landing/script-cycler';
import { StampDesk } from './_landing/stamp-desk';
import { FIXED_MVP_POINTS_RECIPE as recipe } from '@between-moves/domain';
import { siteMetadata } from '../lib/site-metadata';
import { scriptFontVariables } from '../lib/script-fonts';
import './_landing/landing.css';

export const metadata: Metadata = {
  title: `${siteMetadata.name} — ${siteMetadata.tagline}`,
  description: `${siteMetadata.description} Correspondence games between the weekly Nights, a Season of four, and the stories your games leave behind.`,
};

const weekImages: Record<(typeof WEEK_POSTCARDS)[number]['image'], StaticImageData> = {
  train: weekTrain,
  night: weekNight,
  lunch: weekLunch,
  balcony: weekBalcony,
};

const weekAlt: Record<(typeof WEEK_POSTCARDS)[number]['image'], string> = {
  train:
    'Papercraft Mumbai local train at morning rush, a paper hand holding a phone with a chess game.',
  night: 'Papercraft bedroom at night, a phone glowing on the bed and a paper cat asleep.',
  lunch: 'Papercraft office desk with a steel tiffin, cutting chai and a small chess board.',
  balcony:
    'Papercraft Chennai balcony at sunrise with filter coffee, a newspaper and a chess board.',
};

function Kicker({ index, children }: { readonly index: string; readonly children: string }) {
  return (
    <p className="lp-kicker">
      <span className="lp-kicker__index">{index}</span>
      <span>{children}</span>
    </p>
  );
}

export default function HomePage() {
  return (
    <div className={`lp ${scriptFontVariables}`}>
      <RevealObserver />
      <header className="lp-masthead">
        <Link className="lp-brand" href="/" aria-label={`${siteMetadata.name}, home`}>
          <BrandMark />
          <span>{siteMetadata.name}</span>
        </Link>
        <nav aria-label="On this page">
          <ul className="lp-nav">
            <li>
              <a href="#week">The week</a>
            </li>
            <li>
              <a href="#night">The Night</a>
            </li>
            <li>
              <a href="#season">The Season</a>
            </li>
            <li>
              <a href="#stories">Stories</a>
            </li>
            <li>
              <a className="lp-nav__door" href="#door">
                <span className="lp-nav__long">Have an invitation?</span>
                <span className="lp-nav__short">Invitation</span>
              </a>
            </li>
          </ul>
        </nav>
      </header>

      <main>
        {/* ————— 00 · The table ————— */}
        <section className="lp-hero" aria-labelledby="landing-title">
          <HeroStage />
          <div className="lp-hero__copy">
            <p className="lp-eyebrow">A private chess house</p>
            <h1 id="landing-title" className="lp-title">
              <span>Between</span>
              <span>Moves</span>
            </h1>
            <p className="lp-hero__tagline">{siteMetadata.tagline}</p>
            <p className="lp-hero__promise">{siteMetadata.description}</p>
            <div className="lp-actions">
              <a className="lp-button" href="#door">
                Open your invitation <span className="lp-button__arrow">→</span>
              </a>
              <a className="lp-button lp-button--ghost" href="#week">
                How a House works <span className="lp-button__arrow">↓</span>
              </a>
            </div>
          </div>
        </section>

        {/* ————— 01 · The week ————— */}
        <section id="week" className="lp-section lp-paper lp-week" aria-labelledby="week-title">
          <div className="lp-wrap">
            <div className="lp-week__head" data-reveal>
              <Kicker index="01">Correspondence</Kicker>
              <h2 id="week-title" className="lp-display">
                <span className="lp-line">Between moves,</span>
                <span className="lp-line">life happens.</span>
              </h2>
              <p className="lp-lede">
                A House plays correspondence at its own pace — a move a day, or whatever your
                Charter says. Your move waits on the shelf until the train reaches the station, the
                tiffin is finished, the coffee is poured.
              </p>
            </div>
            <ol className="lp-postcards" data-reveal>
              {WEEK_POSTCARDS.map((card) => (
                <li key={card.move} className="lp-postcard">
                  {card.gap === null ? null : (
                    <span className="lp-postcard__gap lp-mono">
                      <span aria-hidden="true">{card.gap}</span>
                      <span className="visually-hidden">
                        {card.gap.replace(' h', ' hours')} later
                      </span>
                    </span>
                  )}
                  <figure>
                    <div className="lp-postcard__photo">
                      <img
                        src={weekImages[card.image].src}
                        alt={weekAlt[card.image]}
                        width={weekImages[card.image].width}
                        height={weekImages[card.image].height}
                        loading="lazy"
                      />
                    </div>
                    <figcaption>
                      <span className="lp-postmark" aria-hidden="true">
                        <span>{card.postmark[0]}</span>
                        <span>
                          {card.postmark[1]} · {card.postmark[2]}
                        </span>
                      </span>
                      <span className="lp-postcard__move lp-mono">{card.move}</span>
                      <span className="lp-postcard__line">{card.line}</span>
                    </figcaption>
                  </figure>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ————— 02 · The Night ————— */}
        <section id="night" className="lp-night" aria-labelledby="night-title">
          <div className="lp-night__photo">
            <img
              src={nightTerrace.src}
              alt="A papercraft rooftop terrace at night: two chess boards on a low table, chai glasses, marigold lanterns and the city beyond."
              width={nightTerrace.width}
              height={nightTerrace.height}
              loading="lazy"
            />
          </div>
          <div className="lp-wrap lp-night__inner">
            <div className="lp-night__head" data-reveal>
              <Kicker index="02">Between Moves Night</Kicker>
              <h2 id="night-title" className="lp-display">
                <span className="lp-line">Thursday</span>
                <span className="lp-line">is Night.</span>
              </h2>
              <p className="lp-lede">
                Once a week the House gathers for live games. Everyone else pulls up a chair on the
                rail — every board in view, one House chat, and a fair amount of shouting about
                bishops.
              </p>
            </div>
            <div className="lp-night__rail" data-reveal>
              <RailDemo />
            </div>
          </div>
        </section>

        {/* ————— 03 · The Season ————— */}
        <section
          id="season"
          className="lp-section lp-paper lp-season"
          aria-labelledby="season-title"
        >
          <div className="lp-wrap lp-season__grid">
            <div className="lp-season__head" data-reveal>
              <Kicker index="03">The Season</Kicker>
              <h2 id="season-title" className="lp-display">
                <span className="lp-line">Four weeks.</span>
                <span className="lp-line">One table.</span>
              </h2>
              <p className="lp-lede">
                A Season is four weeks and four Nights under one Charter. Points for finishing
                games, for winning them, for turning up on Thursday, and for the puzzles you give
                back to the House.
              </p>
              <dl className="lp-ledger" data-reveal>
                <div>
                  <dt>Finish a game</dt>
                  <dd>+{recipe.completedGame}</dd>
                </div>
                <div>
                  <dt>Win it</dt>
                  <dd>+{recipe.win}</dd>
                </div>
                <div>
                  <dt>Draw it</dt>
                  <dd>+{recipe.draw}</dd>
                </div>
                <div>
                  <dt>Come to Night · up to {recipe.caps.nights}</dt>
                  <dd>+{recipe.nightAttendance}</dd>
                </div>
                <div>
                  <dt>Publish a House Puzzle · up to {recipe.caps.puzzles}</dt>
                  <dd>+{recipe.publishedPuzzle}</dd>
                </div>
              </dl>
              <p className="lp-fine lp-mono">
                Your first {recipe.caps.games} finished games score. Everyone plays by the same
                recipe.
              </p>
            </div>
            <figure className="lp-scoreboard" data-reveal>
              <figcaption className="lp-scoreboard__head">
                <span>Monsoon Season</span>
                <span className="lp-mono">Week 4 of 4</span>
              </figcaption>
              <ol className="lp-scoreboard__rows">
                {STANDINGS.map((row) => (
                  <li key={row.name}>
                    <span className="lp-plate lp-plate--rank">{row.rank}</span>
                    <span className="lp-scoreboard__name">{row.name}</span>
                    <span className="lp-plate">{String(row.points).padStart(2, '0')}</span>
                  </li>
                ))}
              </ol>
              <p className="lp-scoreboard__foot lp-mono">
                Shared points, shared rank. Close the Season and the table freezes.
              </p>
            </figure>
          </div>
        </section>

        {/* ————— 04 · Stories ————— */}
        <section id="stories" className="lp-section lp-stories" aria-labelledby="stories-title">
          <div className="lp-wrap">
            <div className="lp-stories__head" data-reveal>
              <Kicker index="04">House stories</Kicker>
              <h2 id="stories-title" className="lp-display">
                <span className="lp-line">Every game</span>
                <span className="lp-line">leaves a story.</span>
              </h2>
              <p className="lp-lede">
                React to a finished game, leave a note for the House, and turn the moment someone
                missed into a puzzle everyone else can try.
              </p>
            </div>
            <div className="lp-stories__grid">
              <div className="lp-stories__cell" data-reveal>
                <StampDesk />
              </div>
              <div className="lp-stories__cell" data-reveal>
                <PuzzleCard />
              </div>
              <figure className="lp-book" data-reveal>
                <div className="lp-book__photo">
                  <img
                    src={closingBook.src}
                    alt="A small paper booklet beside a folded-paper king lying on its side."
                    width={closingBook.width}
                    height={closingBook.height}
                    loading="lazy"
                  />
                  <p className="lp-book__cover" aria-hidden="true">
                    <span>Monsoon Season</span>
                    <span>Final standings</span>
                    <span>1 · Lakshmi</span>
                  </p>
                </div>
                <figcaption>
                  <strong>When the Season closes,</strong> the standings freeze and the House keeps
                  the record — who won, who turned up, who never stopped talking about move 15.
                </figcaption>
              </figure>
            </div>
          </div>
        </section>

        {/* ————— 05 · The House Set ————— */}
        <section className="lp-section lp-set" aria-labelledby="set-title">
          <div className="lp-wrap">
            <div className="lp-set__head" data-reveal>
              <Kicker index="05">The House Set</Kicker>
              <h2 id="set-title" className="lp-display">
                <span className="lp-line">Cut. Fold.</span>
                <span className="lp-line">Play.</span>
              </h2>
              <p className="lp-lede">
                Every House plays with the same folded set: six pieces from a cast fifteen hundred
                years old. Their first names still fit.
              </p>
            </div>
            <ol className="lp-cast" data-reveal>
              {CAST.map((piece) => (
                <li key={piece.kind} className="lp-cast__card" data-piece={piece.kind}>
                  <div
                    className="lp-turntable"
                    role="img"
                    aria-label={`The folded-paper ${piece.english.toLowerCase()}, turning.`}
                  >
                    <span className="lp-turntable__strip" />
                  </div>
                  <p className="lp-cast__sanskrit" lang="sa">
                    {piece.sanskrit}
                  </p>
                  <p className="lp-cast__name">
                    {piece.name} <span>· {piece.english}</span>
                  </p>
                  <p className="lp-cast__note">{piece.note}</p>
                  <p className="lp-cast__spec lp-mono">{piece.facets} facets · 220 gsm</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ————— 06 · Where it began ————— */}
        <section className="lp-section lp-origin" aria-labelledby="origin-title">
          <div className="lp-wrap lp-origin__grid">
            <div className="lp-origin__head" data-reveal>
              <Kicker index="06">Where it began</Kicker>
              <h2 id="origin-title" className="lp-display lp-display--small">
                Every language here has a word for it.
              </h2>
              <p className="lp-lede">
                Chess was born in India as chaturanga, some fifteen centuries ago. It never really
                left.
              </p>
            </div>
            <ScriptCycler />
          </div>
        </section>

        {/* ————— 07 · The door ————— */}
        <section id="door" className="lp-section lp-door" aria-labelledby="door-title">
          <div className="lp-wrap lp-door__grid">
            <div className="lp-door__photo" data-reveal>
              <img
                src={invitation.src}
                alt="An open paper envelope sealed with a marigold chess-knight seal, an invitation card sliding out."
                width={invitation.width}
                height={invitation.height}
                loading="lazy"
              />
            </div>
            <div className="lp-door__copy" data-reveal>
              <Kicker index="07">The door</Kicker>
              <h2 id="door-title" className="lp-display lp-display--small">
                Houses are private. The door opens by invitation.
              </h2>
              <p className="lp-lede">
                Ask your host for the link. It brings you straight to the table: sign in with your
                email, no password, no feed, no strangers.
              </p>
              <DoorForm />
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer__grid">
          <p className="lp-footer__mark" aria-hidden="true">
            Between Moves
          </p>
          <div>
            <p className="lp-footer__line">
              {siteMetadata.tagline} {siteMetadata.description}
            </p>
            <p className="lp-footer__colophon lp-mono">
              Set in Anek by Ek Type — one family, ten scripts — and IBM Plex Mono. The House Set is
              folded from a CC0 chess set by Riley Queen, via Poly Haven. Made for Thursdays.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
