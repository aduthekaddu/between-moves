'use client';

import { useRouter } from 'next/navigation';
import type { FormEvent, ReactNode } from 'react';
import { useState } from 'react';
import { PointsRecipe } from './points-recipe';
import { PreviousSeason } from './previous-season';
import {
  formatSeasonDate,
  openSeason,
  seasonEndDate,
  type ProblemDetails,
  type SeasonOpening,
  type SeasonOpeningProgress,
} from './season-opening';

interface CharterAuthoringFormProps {
  readonly houseId: string;
  readonly initial: SeasonOpening;
  readonly progress: SeasonOpeningProgress;
  /** [BM-049] The last closed Season's title when this Charter renews the House. */
  readonly previousSeasonTitle?: string | undefined;
  /** Frozen standings shown above the Charter but placed after its h1 in the document. */
  readonly recap?: ReactNode;
}

function validateFields(opening: SeasonOpening): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  if (opening.title.trim().length < 1 || opening.title.trim().length > 80) {
    errors.title = ['Enter a Season title of 1 to 80 characters.'];
  }
  if (
    !Number.isInteger(opening.paceHours) ||
    opening.paceHours <= 0 ||
    opening.paceHours > 2_147_483_647
  ) {
    errors.correspondencePaceHours = ['Enter a positive whole number of hours.'];
  }
  if (!Number.isInteger(opening.weekday) || opening.weekday < 0 || opening.weekday > 6) {
    errors['nightRecurrence.weekday'] = ['Choose a weekday.'];
  }
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(opening.localTime)) {
    errors['nightRecurrence.localTime'] = ['Enter a valid local time.'];
  }
  if (seasonEndDate(opening.startDate) === null) {
    errors.startsAt = ['Choose the Season start date.'];
  }
  return errors;
}

function FieldError({
  id,
  messages,
}: {
  readonly id: string;
  readonly messages?: string[] | undefined;
}) {
  if (messages === undefined) return null;
  return (
    <p id={id} className="charter-form__error" role="alert">
      {messages.join(' ')}
    </p>
  );
}

/**
 * [BM-019] [UX-CMP-09] Narrow-first Season opening and its three-command publication flow.
 * [BM-049] After a close the same flow renews the House: a fresh Season that carries nothing
 * over, which once published links back to the last Season's Closing Book.
 */
export function CharterAuthoringForm({
  houseId,
  initial,
  progress: initialProgress,
  previousSeasonTitle,
  recap = null,
}: CharterAuthoringFormProps) {
  const router = useRouter();
  const [draftIdempotencyKey] = useState(() => crypto.randomUUID());
  const [progress, setProgress] = useState(initialProgress);
  const [title, setTitle] = useState(initial.title);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [paceHours, setPaceHours] = useState(initial.paceHours);
  const [weekday, setWeekday] = useState(initial.weekday);
  const [localTime, setLocalTime] = useState(initial.localTime);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [opened, setOpened] = useState(false);
  const endDate = seasonEndDate(startDate);

  function changeCharter() {
    setProgress((current) => ({ ...current, charterVersioned: false }));
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const opening = { title, startDate, paceHours, weekday, localTime };
    const fieldErrors = validateFields(opening);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;
    setSubmitting(true);
    try {
      await openSeason({
        houseId,
        opening,
        progress,
        draftIdempotencyKey,
        onProgress: setProgress,
      });
      setOpened(true);
      router.refresh();
    } catch (error) {
      const problem = error as ProblemDetails;
      setErrors(problem.errors ?? {});
      setFormError(problem.detail ?? 'We could not open that Season. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (opened) {
    return (
      <section className="season-active" role="status" aria-labelledby="season-active-title">
        <p className="season-eyebrow">Season active</p>
        <h1 id="season-active-title">{title}</h1>
        {previousSeasonTitle === undefined ? null : (
          <PreviousSeason houseId={houseId} title={previousSeasonTitle} />
        )}
      </section>
    );
  }

  return (
    <form className="charter-form" onSubmit={publish} noValidate>
      <div className="charter-form__heading">
        <p className="season-eyebrow">
          {previousSeasonTitle === undefined ? 'Four weeks at the table' : 'The next Season'}
        </p>
        <h1>Open a Season</h1>
        <p>
          Set the rhythm for correspondence Games and your weekly Between Moves Night.
          {previousSeasonTitle === undefined
            ? null
            : ` Nothing carries over from ${previousSeasonTitle}: points, standings and awards start again from zero.`}
        </p>
      </div>
      {recap}

      <div className="charter-form__fields">
        <div className="charter-field charter-field--wide">
          <label htmlFor="charter-title">Season title</label>
          <input
            id="charter-title"
            name="title"
            required
            maxLength={80}
            value={title}
            aria-describedby={errors.title ? 'charter-title-error' : undefined}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
          <FieldError id="charter-title-error" messages={errors.title} />
        </div>
        <div className="charter-field">
          <label htmlFor="charter-start">Season starts</label>
          <input
            id="charter-start"
            name="startsAt"
            type="date"
            required
            value={startDate}
            aria-describedby={errors.startsAt ? 'charter-start-error' : undefined}
            onChange={(event) => setStartDate(event.currentTarget.value)}
          />
          <FieldError id="charter-start-error" messages={errors.startsAt} />
        </div>
        <div className="charter-field">
          <span className="charter-field__label">Season ends</span>
          <p className="charter-field__value">
            {endDate === null ? 'Four weeks after the start' : formatSeasonDate(endDate)}
          </p>
        </div>
        <div className="charter-field">
          <label htmlFor="charter-pace">Correspondence pace</label>
          <span className="charter-field__compound">
            <input
              id="charter-pace"
              name="correspondencePaceHours"
              type="number"
              min="1"
              step="1"
              required
              value={paceHours}
              aria-describedby={
                errors.correspondencePaceHours
                  ? 'charter-pace-error charter-pace-unit'
                  : 'charter-pace-unit'
              }
              onChange={(event) => {
                setPaceHours(event.currentTarget.valueAsNumber);
                changeCharter();
              }}
            />
            <span id="charter-pace-unit">hours per Move</span>
          </span>
          <FieldError id="charter-pace-error" messages={errors.correspondencePaceHours} />
        </div>
        <fieldset className="charter-night charter-field--wide">
          <legend>Between Moves Night</legend>
          <p>One Night each week, repeated four times.</p>
          <div className="charter-night__fields">
            <div className="charter-field">
              <label htmlFor="charter-weekday">Weekday</label>
              <select
                id="charter-weekday"
                name="weekday"
                value={weekday}
                aria-describedby={
                  errors['nightRecurrence.weekday'] ? 'charter-weekday-error' : undefined
                }
                onChange={(event) => {
                  setWeekday(Number(event.currentTarget.value));
                  changeCharter();
                }}
              >
                {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
                  (day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ),
                )}
              </select>
              <FieldError id="charter-weekday-error" messages={errors['nightRecurrence.weekday']} />
            </div>
            <div className="charter-field">
              <label htmlFor="charter-night-time">Local time</label>
              <input
                id="charter-night-time"
                name="localTime"
                type="time"
                required
                value={localTime}
                aria-describedby={
                  errors['nightRecurrence.localTime'] ? 'charter-time-error' : undefined
                }
                onChange={(event) => {
                  setLocalTime(event.currentTarget.value);
                  changeCharter();
                }}
              />
              <FieldError id="charter-time-error" messages={errors['nightRecurrence.localTime']} />
            </div>
          </div>
        </fieldset>
      </div>

      <PointsRecipe />
      {formError !== null ? (
        <p className="charter-form__banner" role="alert">
          {formError}
        </p>
      ) : null}
      <button className="charter-form__submit" type="submit" disabled={submitting}>
        {submitting ? 'Opening the Season…' : 'Open the Season'}
      </button>
    </form>
  );
}
