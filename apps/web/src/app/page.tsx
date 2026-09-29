import type { Metadata } from 'next';
/* eslint-disable @next/next/no-img-element -- Native images avoid Next/Image inline styles under strict CSP. */
import Link from 'next/link';
import { FIXED_MVP_POINTS_RECIPE as recipe } from '@between-moves/domain';
import { BrandMark } from './_components/brand-mark';
import { RodText } from './_theatre/rod-text';
import { COMPANY, STANDINGS, WEEK } from './_landing/content';
import { DoorForm } from './_landing/door-form';
import { PuzzleCard } from './_landing/puzzle-card';
import { RailDemo } from './_landing/rail-demo';
import { RevealObserver } from './_landing/reveal';
import { StampDesk } from './_landing/stamp-desk';
import { LandingTheatre } from './_landing/stage/landing-theatre';
import { WordJourney } from './_landing/word-journey';
import { siteMetadata } from '../lib/site-metadata';
import { anekDevanagari, notoNastaliq } from '../lib/script-fonts';
import './_landing/landing.css';

export const metadata: Metadata = {
  title: `${siteMetadata.name} — ${siteMetadata.tagline}`,
  description: `${siteMetadata.description} Correspondence games between the weekly Nights, a Season of four, and the stories your games leave behind.`,
};

function Kicker({ index, children }: { readonly index: string; readonly children: string }) {
  return (
    <p className="lp-kicker">
      <span className="lp-kicker__index">{index}</span>
      <span>{children}</span>
    </p>
  );
}

/** Static stand-ins for the lit screen: shown without WebGL2, with reduced motion, or before it lights. */
function Poster({
  src,
  className,
  width,
  height,
  eager = false,
}: {
  readonly src: string;
  readonly className: string;
  readonly width: number;
  readonly height: number;
  readonly eager?: boolean;
}) {
  return (
    <img
      className={`lp-poster ${className}`}
      src={src}
      alt=""
      width={width}
      height={height}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      {...(eager ? { fetchPriority: 'high' as const } : {})}
    />
  );
}

export default function HomePage() {
  return (
    <div className={`lp ${anekDevanagari.variable} ${notoNastaliq.variable}`}>
      <LandingTheatre />
      <RevealObserver />
      <header className="lp-masthead">
        <Link className="lp-brand" href="/" aria-label={`${siteMetadata.name}, home`}>
          <BrandMark />
          <span>{siteMetadata.name}</span>
        </Link>
        <nav aria-label="On this page">
          <ul className="lp-nav">
            <li className="lp-nav__section">
              <a href="#week">The week</a>
            </li>
            <li className="lp-nav__section">
              <a href="#night">The Night</a>
            </li>
            <li className="lp-nav__section">
              <a href="#season">The Season</a>
            </li>
            <li className="lp-nav__section">
              <a href="#company">The company</a>
            </li>
            <li>
              <a className="lp-nav__door" href="#door">
                <span className="lp-nav__long">Have an invitation?</span>
                <span className="lp-nav__short">Invitation</span>
              </a>
            </li>
            <li>
              <Link className="lp-nav__signin" href="/sign-in">
                Sign in
              </Link>
            </li>
          </ul>
        </nav>
      </header>

      <main>
        {/* ————— Prelude: the lamp is lit ————— */}
        <section className="act act--prelude" data-act="prelude" aria-labelledby="landing-title">
          <div className="beat beat--hero">
            <p className="lp-eyebrow">A private chess house · in one act a week</p>
            <h1 id="landing-title" className="lp-title">
              <RodText text="Between Moves" by="letter" />
            </h1>
            <p className="lp-hero__tagline">{siteMetadata.tagline}</p>
            <p className="lp-hero__promise">{siteMetadata.description}</p>
            <div className="lp-actions">
              <Link className="lp-ticket" href="/sign-up">
                <span>Create an account</span>
                <span className="lp-ticket__stub" aria-hidden="true">
                  Admit one
                </span>
              </Link>
              <a className="lp-button" href="#door">
                Open your invitation <span aria-hidden="true">→</span>
              </a>
            </div>
            <p className="lp-cue" aria-hidden="true">
              <span className="lp-cue__lamp" /> Move the lamp. Scroll for the play.
            </p>
          </div>
          <Poster
            src="/theatre/house/table-s.webp"
            className="lp-poster--hero"
            width={640}
            height={437}
            eager
          />
        </section>

        {/* ————— Act one: the week ————— */}
        <section id="week" className="act act--week" data-act="week" aria-labelledby="week-title">
          {WEEK.map((day, index) => (
            <div key={day.move} className="beat beat--day">
              <div className="lp-copy">
                {index === 0 ? (
                  <>
                    <Kicker index="I">Correspondence</Kicker>
                    <h2 id="week-title" className="lp-surtitle" data-reveal>
                      <RodText text="Between moves, life happens." />
                    </h2>
                    <p className="lp-lede" data-reveal>
                      A House plays at its own pace: a move a day, or whatever your Charter says.
                      Your move waits for you until the train reaches the station.
                    </p>
                  </>
                ) : (
                  <p className="lp-gap" data-reveal>
                    <span aria-hidden="true">{day.gap}</span>
                    <span className="visually-hidden">{day.gap?.replace(' h', ' hours')}</span>
                    <span className="lp-gap__later">later</span>
                  </p>
                )}
                <figure className="lp-day" data-reveal>
                  <p className="lp-postmark">
                    <span>{day.postmark[0]}</span>
                    <span>
                      {day.postmark[1]} · {day.postmark[2]}
                    </span>
                  </p>
                  <p className="lp-move">{day.move}</p>
                  <figcaption className="lp-day__line">{day.line}</figcaption>
                </figure>
              </div>
              <Poster
                src={`/theatre/house/${day.scene}-s.webp`}
                className="lp-poster--scene"
                width={640}
                height={400}
              />
            </div>
          ))}
        </section>

        {/* ————— Act two: the Night ————— */}
        <section
          id="night"
          className="act act--night"
          data-act="night"
          aria-labelledby="night-title"
        >
          <div className="beat">
            <div className="lp-copy">
              <Kicker index="II">Between Moves Night</Kicker>
              <h2 id="night-title" className="lp-surtitle" data-reveal>
                <RodText text="Thursday is Night." />
              </h2>
              <p className="lp-lede" data-reveal>
                Once a week the House gathers for live games. Everyone else pulls up a chair on the
                rail: every board in view, one House chat, and a fair amount of shouting about
                bishops.
              </p>
            </div>
            <Poster
              src="/theatre/house/rooftop-s.webp"
              className="lp-poster--scene"
              width={640}
              height={295}
            />
          </div>
          <div className="beat beat--card">
            <div className="lp-card-slot" data-reveal>
              <RailDemo />
            </div>
          </div>
        </section>

        {/* ————— Act three: the Season ————— */}
        <section
          id="season"
          className="act act--season"
          data-act="season"
          aria-labelledby="season-title"
        >
          <div className="beat">
            <div className="lp-copy">
              <Kicker index="III">The Season</Kicker>
              <h2 id="season-title" className="lp-surtitle" data-reveal>
                <RodText text="Four weeks. One table." />
              </h2>
              <p className="lp-lede" data-reveal>
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
              <p className="lp-fine">
                Your first {recipe.caps.games} finished games score. Everyone plays by the same
                recipe.
              </p>
            </div>
          </div>
          <div className="beat beat--card">
            <figure className="lp-scoreboard" data-reveal>
              <figcaption className="lp-scoreboard__head">
                <span>Autumn Season</span>
                <span>Week 4 of 4</span>
              </figcaption>
              <ol className="lp-scoreboard__rows">
                {STANDINGS.map((row) => (
                  <li key={row.name}>
                    <span className="lp-scoreboard__rank">{row.rank}</span>
                    <span className="lp-scoreboard__name">{row.name}</span>
                    <span className="lp-scoreboard__points">
                      {String(row.points).padStart(2, '0')}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="lp-scoreboard__foot">
                Shared points, shared rank. Close the Season and the table freezes.
              </p>
            </figure>
          </div>
        </section>

        {/* ————— Act four: stories ————— */}
        <section
          id="stories"
          className="act act--stories"
          data-act="stories"
          aria-labelledby="stories-title"
        >
          <div className="beat">
            <div className="lp-copy">
              <Kicker index="IV">House stories</Kicker>
              <h2 id="stories-title" className="lp-surtitle" data-reveal>
                <RodText text="Every game leaves a story." />
              </h2>
              <p className="lp-lede" data-reveal>
                React to a finished game, leave a note for the House, and turn the moment someone
                missed into a puzzle everyone else can try.
              </p>
              <div className="lp-card-slot lp-card-slot--inline" data-reveal>
                <StampDesk />
              </div>
            </div>
            <Poster
              src="/theatre/scenery/book-s.webp"
              className="lp-poster--scene"
              width={640}
              height={397}
            />
          </div>
          <div className="beat beat--card beat--card-left">
            <div className="lp-card-slot" data-reveal>
              <PuzzleCard />
            </div>
            <p className="lp-caption" data-reveal>
              <strong>When the Season closes,</strong> the standings freeze and the House binds its
              Closing Book: who won, who turned up, and who never stopped talking about move 15.
            </p>
          </div>
        </section>

        {/* ————— Act five: the company ————— */}
        <section
          id="company"
          className="act act--company"
          data-act="company"
          aria-labelledby="company-title"
        >
          <div className="beat beat--lineup">
            <div className="lp-copy">
              <Kicker index="V">The company</Kicker>
              <h2 id="company-title" className="lp-surtitle lp-surtitle--small" data-reveal>
                <RodText text="Every House plays with the same troupe." />
              </h2>
              <p className="lp-lede" data-reveal>
                Six parts, sixteen pieces a side, the same cast for fifteen centuries. Meet them.
              </p>
            </div>
          </div>
          {COMPANY.map((member) => (
            <div key={member.kind} className="beat beat--member">
              <div className="lp-copy">
                <article className="lp-member" data-reveal>
                  <p className="lp-member__once">Once {member.once}</p>
                  <h3 className="lp-member__name">
                    <RodText text={member.name} />
                  </h3>
                  <p className="lp-member__note">{member.note}</p>
                </article>
              </div>
            </div>
          ))}
        </section>

        {/* ————— Act six: where it began ————— */}
        <section className="act act--origin" data-act="origin" aria-labelledby="origin-title">
          <div className="beat">
            <div className="lp-copy">
              <Kicker index="VI">On tour</Kicker>
              <h2 id="origin-title" className="lp-surtitle lp-surtitle--small" data-reveal>
                <RodText text="Fifteen hundred years on the road." />
              </h2>
              <p className="lp-lede" data-reveal>
                The game began in India as chaturanga, the four divisions of an army. Every country
                it reached borrowed the name from the last one.
              </p>
            </div>
          </div>
          <div className="beat beat--journey">
            <WordJourney />
          </div>
        </section>

        {/* ————— Act seven: the door ————— */}
        <section id="door" className="act act--door" data-act="door" aria-labelledby="door-title">
          <div className="beat">
            <div className="lp-copy">
              <Kicker index="VII">The door</Kicker>
              <h2 id="door-title" className="lp-surtitle lp-surtitle--small" data-reveal>
                <RodText text="Houses are private. The door opens by invitation." />
              </h2>
              <p className="lp-lede" data-reveal>
                Ask your host for the link. It brings you straight to the table: sign in with your
                email, no password, no feed, no strangers.
              </p>
              <p className="lp-lede" data-reveal>
                Starting a House? <Link href="/sign-up">Create your account</Link> first.
              </p>
              <div className="lp-card-slot lp-card-slot--inline" data-reveal>
                <DoorForm />
              </div>
            </div>
            <Poster
              src="/theatre/scenery/door-s.webp"
              className="lp-poster--door"
              width={381}
              height={640}
            />
          </div>
        </section>
      </main>

      <footer className="lp-footer" data-curtain>
        <div className="lp-footer__inner">
          <p className="lp-footer__mark" aria-hidden="true">
            Between Moves
          </p>
          <div className="lp-footer__programme">
            <p className="lp-footer__line">
              {siteMetadata.tagline} {siteMetadata.description}
            </p>
            <p className="lp-footer__colophon">
              Cut-paper company after the silhouette films of Lotte Reiniger and the shadow theatres
              that came before them. Set in Anek by Ek Type and IBM Plex Mono. The lamp is yours:
              move it.
            </p>
            <p className="lp-footer__links">
              <Link href="/sign-in">Sign in</Link>
              <Link href="/sign-up">Create an account</Link>
              <a href="#door">Open an invitation</a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
