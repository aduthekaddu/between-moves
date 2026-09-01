'use client';

import {
  houseLocalDateTimeToInstant,
  type HouseNightView,
  type MembershipRole,
} from '@between-moves/domain';
import type { FormEvent } from 'react';
import { useState } from 'react';

function houseLocalInput(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`;
}

function localLabel(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

async function changeNight(
  houseId: string,
  nightId: string,
  body: Record<string, string>,
): Promise<HouseNightView> {
  const response = await fetch(`/api/houses/${houseId}/nights/${nightId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as HouseNightView & { detail?: string };
  if (!response.ok) throw new Error(payload.detail ?? 'The Night could not be changed.');
  return {
    ...payload,
    scheduledStart: new Date(payload.scheduledStart),
    scheduledEnd: new Date(payload.scheduledEnd),
  };
}

function RescheduleForm({
  houseId,
  night,
  position,
  timeZone,
  onChanged,
}: {
  readonly houseId: string;
  readonly night: HouseNightView;
  readonly position: number;
  readonly timeZone: string;
  readonly onChanged: (night: HouseNightView) => void;
}) {
  const [start, setStart] = useState(houseLocalInput(night.scheduledStart, timeZone));
  const [end, setEnd] = useState(houseLocalInput(night.scheduledEnd, timeZone));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const errorId = `night-${night.nightId}-error`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      onChanged(
        await changeNight(houseId, night.nightId, {
          scheduledStart: houseLocalDateTimeToInstant(start, timeZone).toISOString(),
          scheduledEnd: houseLocalDateTimeToInstant(end, timeZone).toISOString(),
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The Night could not be changed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="night-edit" onSubmit={submit}>
      <label>
        New start for Night {position} ({timeZone})
        <input
          type="datetime-local"
          required
          value={start}
          aria-describedby={error === null ? undefined : errorId}
          onChange={(event) => setStart(event.currentTarget.value)}
        />
      </label>
      <label>
        New end for Night {position} ({timeZone})
        <input
          type="datetime-local"
          required
          value={end}
          aria-describedby={error === null ? undefined : errorId}
          onChange={(event) => setEnd(event.currentTarget.value)}
        />
      </label>
      <button type="submit" disabled={submitting}>
        {submitting ? 'Saving…' : 'Reschedule'}
      </button>
      {error === null ? null : (
        <p id={errorId} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/** [BM-020] Scheduled Nights list with Owner/Steward reschedule and confirmed cancellation. */
export function NightSchedule({
  houseId,
  membershipRole,
  timeZone,
  initialNights,
}: {
  readonly houseId: string;
  readonly membershipRole: MembershipRole;
  readonly timeZone: string;
  readonly initialNights: readonly HouseNightView[];
}) {
  const [nights, setNights] = useState(initialNights);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = membershipRole !== 'member';
  const replace = (changed: HouseNightView) =>
    setNights((current) =>
      current.map((night) => (night.nightId === changed.nightId ? changed : night)),
    );

  async function cancel(night: HouseNightView) {
    setError(null);
    try {
      replace(await changeNight(houseId, night.nightId, { state: 'cancelled' }));
      setConfirming(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The Night could not be cancelled.');
    }
  }

  return (
    <section className="night-schedule" aria-labelledby="night-schedule-title">
      <p className="season-eyebrow">The weekly gathering</p>
      <h2 id="night-schedule-title">Scheduled Between Moves Nights</h2>
      {nights.length === 0 ? (
        <p>No Nights are on the table yet.</p>
      ) : (
        <ol className="night-schedule__list">
          {nights.map((night, index) => (
            <li className="night-card" key={night.nightId}>
              <h3>Night {index + 1}</h3>
              <p className={night.state === 'cancelled' ? 'night-card__cancelled' : undefined}>
                {localLabel(night.scheduledStart, timeZone)} –{' '}
                {localLabel(night.scheduledEnd, timeZone)}
              </p>
              <p className="night-card__zone">
                {timeZone} · {night.state === 'cancelled' ? 'Cancelled' : 'Scheduled'}
              </p>
              {canEdit && night.state === 'scheduled' ? (
                <>
                  <RescheduleForm
                    houseId={houseId}
                    night={night}
                    position={index + 1}
                    timeZone={timeZone}
                    onChanged={replace}
                  />
                  {confirming === night.nightId ? (
                    <div
                      className="night-cancel-confirm"
                      role="group"
                      aria-label={`Confirm cancellation for Night ${index + 1}`}
                    >
                      <button type="button" onClick={() => setConfirming(null)}>
                        Keep Night
                      </button>
                      <button
                        type="button"
                        className="night-cancel"
                        onClick={() => void cancel(night)}
                      >
                        Confirm cancellation
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="night-cancel"
                      onClick={() => setConfirming(night.nightId)}
                    >
                      Cancel Night
                    </button>
                  )}
                </>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {error === null ? null : <p role="alert">{error}</p>}
    </section>
  );
}
