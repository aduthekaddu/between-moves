import { weeklyNight, type SetupStep, type SetupStepId } from './house-guide';
import { OpenSeasonButton } from './open-season-button';
import type { SeasonOpening, SeasonOpeningProgress } from './season/season-opening';

const titles: Record<SetupStepId, string> = {
  invite: 'Invite your group',
  season: 'Open a Season',
  game: 'Play the first game',
};

function StepAction({
  id,
  houseId,
  primary,
  opening,
  progress,
}: {
  readonly id: SetupStepId;
  readonly houseId: string;
  readonly primary: boolean;
  readonly opening: SeasonOpening;
  readonly progress: SeasonOpeningProgress;
}) {
  const base = `/h/${encodeURIComponent(houseId)}`;
  const linkClass = primary ? 'house-guide__primary' : 'house-setup__link';
  switch (id) {
    case 'invite':
      return (
        <div className="house-setup__action">
          <a className={linkClass} href={`${base}/members#invite`}>
            Invite people
          </a>
        </div>
      );
    case 'season':
      return (
        <OpenSeasonButton
          houseId={houseId}
          opening={opening}
          progress={progress}
          primary={primary}
        />
      );
    case 'game':
      return (
        <div className="house-setup__action">
          <a className={linkClass} href={`${base}/games/new`}>
            Start a game
          </a>
        </div>
      );
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

/** [BM-013] What an Owner or Steward still has to do before the House can play. */
export function HouseSetup({
  houseId,
  houseName,
  steps,
  opening,
  progress,
}: {
  readonly houseId: string;
  readonly houseName: string;
  readonly steps: readonly SetupStep[];
  readonly opening: SeasonOpening;
  readonly progress: SeasonOpeningProgress;
}) {
  const next = steps.find((step) => !step.done)?.id;
  const done = steps.filter((step) => step.done).length;
  return (
    <section className="house-guide" aria-labelledby="house-setup-title">
      <p className="house-home__eyebrow">
        {done} of {steps.length} done
      </p>
      <h2 id="house-setup-title">Get {houseName} ready</h2>
      <ol className="house-setup__steps">
        {steps.map((step, index) => (
          <li key={step.id} data-step={step.id} data-done={step.done ? 'true' : undefined}>
            <span className="house-setup__mark" aria-hidden="true">
              {step.done ? '✓' : index + 1}
            </span>
            <span className="house-setup__title">{titles[step.id]}</span>
            {step.id === 'season' && !step.done ? (
              <span className="house-setup__detail">
                Four weeks from today, with live Nights on{' '}
                {weeklyNight(opening.weekday, opening.localTime)}.
              </span>
            ) : null}
            {step.done ? (
              <span className="house-setup__done">Done</span>
            ) : (
              <StepAction
                id={step.id}
                houseId={houseId}
                primary={step.id === next}
                opening={opening}
                progress={progress}
              />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
