'use client';

import type { FormEvent, ReactNode } from 'react';
import { useState } from 'react';
import { PointsRecipe } from './points-recipe';
import { PreviousSeason } from './previous-season';

interface CharterAuthoringFormProps {
  readonly houseId: string;
  readonly draftSeasonId?: string | undefined;
  readonly initialTitle?: string | undefined;
  readonly initialPaceHours?: number | undefined;
  readonly initialWeekday?: number | undefined;
  readonly initialLocalTime?: string | undefined;
  readonly initialCharterVersioned?: boolean | undefined;
  /** [BM-049] The last closed Season's title when this Charter renews the House. */
  readonly previousSeasonTitle?: string | undefined;
  /** Frozen standings shown above the Charter but placed after its h1 in the document. */
  readonly recap?: ReactNode;
}

interface ProblemDetails {
  readonly detail?: string;
  readonly errors?: Record<string, string[]>;
}

async function postJson(
  url: string,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as Record<string, unknown> & ProblemDetails;
  if (!response.ok) throw payload;
  return payload;
}

function dateAtUtcMidnight(value: string): string {
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}

function validateFields(input: {
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly paceHours: number;
  readonly weekday: number;
  readonly localTime: string;
}): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  if (input.title.trim().length < 1 || input.title.trim().length > 80) {
    errors.title = ['Enter a Season title of 1 to 80 characters.'];
  }
  if (
    !Number.isInteger(input.paceHours) ||
    input.paceHours <= 0 ||
    input.paceHours > 2_147_483_647
  ) {
    errors.correspondencePaceHours = ['Enter a positive whole number of hours.'];
  }
  if (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6) {
    errors['nightRecurrence.weekday'] = ['Choose a weekday.'];
  }
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.localTime)) {
    errors['nightRecurrence.localTime'] = ['Enter a valid local time.'];
  }
  const start = Date.parse(`${input.startsAt}T00:00:00.000Z`);
  const end = Date.parse(`${input.endsAt}T00:00:00.000Z`);
  if (Number.isNaN(start)) errors.startsAt = ['Choose the Season start date.'];
  if (Number.isNaN(end)) errors.endsAt = ['Choose the Season end date.'];
  else if (!Number.isNaN(start) && end - start !== 28 * 24 * 60 * 60 * 1_000) {
    errors.endsAt = ['Season end must be exactly four weeks after its start.'];
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
 * [BM-019] [UX-CMP-09] Narrow-first Charter authoring and three-command publication flow.
 * [BM-049] After a close the same flow renews the House: a fresh Season that carries nothing
 * over, which once published links back to the last Season's Closing Book.
 */
export function CharterAuthoringForm({
  houseId,
  draftSeasonId,
  initialTitle = '',
  initialPaceHours = 24,
  initialWeekday = 5,
  initialLocalTime = '19:30',
  initialCharterVersioned = false,
  previousSeasonTitle,
  recap = null,
}: CharterAuthoringFormProps) {
  const [draftIdempotencyKey] = useState(() => crypto.randomUUID());
  const [seasonId, setSeasonId] = useState(draftSeasonId);
  const [title, setTitle] = useState(initialTitle);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [paceHours, setPaceHours] = useState(initialPaceHours);
  const [weekday, setWeekday] = useState(initialWeekday);
  const [localTime, setLocalTime] = useState(initialLocalTime);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const [charterVersioned, setCharterVersioned] = useState(initialCharterVersioned);

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const fieldErrors = validateFields({ title, startsAt, endsAt, paceHours, weekday, localTime });
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;
    setSubmitting(true);
    try {
      let currentSeasonId = seasonId;
      if (currentSeasonId === undefined) {
        const draft = await postJson(
          `/api/houses/${houseId}/seasons`,
          { title },
          { 'Idempotency-Key': draftIdempotencyKey },
        );
        currentSeasonId = String(draft.seasonId);
        setSeasonId(currentSeasonId);
      }
      if (!charterVersioned) {
        await postJson(`/api/houses/${houseId}/seasons/${currentSeasonId}/charter`, {
          correspondencePaceHours: paceHours,
          nightRecurrence: { weekday, localTime, count: 4 },
        });
        setCharterVersioned(true);
      }
      const active = await postJson(`/api/houses/${houseId}/seasons/${currentSeasonId}/publish`, {
        title,
        startsAt: dateAtUtcMidnight(startsAt),
        endsAt: dateAtUtcMidnight(endsAt),
      });
      setPublishedVersion(Number(active.publishedCharterVersion));
    } catch (error) {
      const problem = error as ProblemDetails;
      setErrors(problem.errors ?? {});
      setFormError(problem.detail ?? 'We could not publish that Charter. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (publishedVersion !== null) {
    return (
      <section className="season-active" role="status" aria-labelledby="season-active-title">
        <p className="season-eyebrow">Season active</p>
        <h1 id="season-active-title">{title}</h1>
        <p>
          Charter version {publishedVersion} is published. The House can begin its four-week Season.
        </p>
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
        <h1>Publish a Charter</h1>
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
            value={startsAt}
            aria-describedby={errors.startsAt ? 'charter-start-error' : undefined}
            onChange={(event) => setStartsAt(event.currentTarget.value)}
          />
          <FieldError id="charter-start-error" messages={errors.startsAt} />
        </div>
        <div className="charter-field">
          <label htmlFor="charter-end">Season ends</label>
          <input
            id="charter-end"
            name="endsAt"
            type="date"
            required
            value={endsAt}
            aria-describedby={
              errors.endsAt ? 'charter-end-error charter-dates-hint' : 'charter-dates-hint'
            }
            onChange={(event) => setEndsAt(event.currentTarget.value)}
          />
          <p id="charter-dates-hint" className="charter-field__hint">
            Exactly four weeks after the start.
          </p>
          <FieldError id="charter-end-error" messages={errors.endsAt} />
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
                setCharterVersioned(false);
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
                  setCharterVersioned(false);
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
                  setCharterVersioned(false);
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
        {submitting ? 'Publishing Charter…' : 'Publish Charter'}
      </button>
    </form>
  );
}
