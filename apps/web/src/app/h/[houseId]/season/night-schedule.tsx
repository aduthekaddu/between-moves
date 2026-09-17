'use client';

import {
  houseLocalDateTimeToInstant,
  type HouseNightView,
  type MembershipRole,
  type NightHostCandidate,
  type NightRsvpStatus,
  type NightState,
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

function stateLabel(state: NightState): string {
  switch (state) {
    case 'scheduled':
      return 'Scheduled';
    case 'live':
      return 'Live';
    case 'ended':
      return 'Ended';
    case 'cancelled':
      return 'Cancelled';
  }
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(value);
}

function parseNight(payload: HouseNightView): HouseNightView {
  return {
    ...payload,
    scheduledStart: new Date(payload.scheduledStart),
    scheduledEnd: new Date(payload.scheduledEnd),
    startedAt: asDate(payload.startedAt),
    endedAt: asDate(payload.endedAt),
    hostMembershipId: payload.hostMembershipId ?? null,
    viewerIsHost: payload.viewerIsHost === true,
    viewerRsvp: payload.viewerRsvp ?? null,
  };
}

async function postNight(
  houseId: string,
  nightId: string,
  path: string,
  body?: Record<string, string>,
): Promise<HouseNightView> {
  const response = await fetch(`/api/houses/${houseId}/nights/${nightId}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = (await response.json()) as HouseNightView & { detail?: string };
  if (!response.ok) throw new Error(payload.detail ?? 'The Night could not be changed.');
  return parseNight(payload);
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
        await postNight(houseId, night.nightId, '', {
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

function NightLifecycleControls({
  houseId,
  night,
  position,
  canEdit,
  hostCandidates,
  onChanged,
  onError,
}: {
  readonly houseId: string;
  readonly night: HouseNightView;
  readonly position: number;
  readonly canEdit: boolean;
  readonly hostCandidates: readonly NightHostCandidate[];
  readonly onChanged: (night: HouseNightView) => void;
  readonly onError: (message: string) => void;
}) {
  const [hostMembershipId, setHostMembershipId] = useState(night.hostMembershipId ?? '');
  const canHost = canEdit || night.viewerIsHost;
  const open = night.state === 'scheduled' || night.state === 'live';

  async function rsvp(status: NightRsvpStatus) {
    onError('');
    try {
      const response = await fetch(`/api/houses/${houseId}/nights/${night.nightId}/rsvp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const payload = (await response.json()) as { status?: NightRsvpStatus; detail?: string };
      if (!response.ok) throw new Error(payload.detail ?? 'The RSVP could not be saved.');
      onChanged({ ...night, viewerRsvp: payload.status ?? status });
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'The RSVP could not be saved.');
    }
  }

  async function assignHost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError('');
    try {
      onChanged(await postNight(houseId, night.nightId, '/host', { hostMembershipId }));
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'The Night host could not be assigned.');
    }
  }

  async function run(path: '/start' | '/end', failed: string) {
    onError('');
    try {
      onChanged(await postNight(houseId, night.nightId, path));
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : failed);
    }
  }

  return (
    <>
      {open ? (
        <div className="night-rsvp" role="group" aria-label={`RSVP for Night ${position}`}>
          <button
            type="button"
            aria-pressed={night.viewerRsvp === 'going'}
            onClick={() => void rsvp('going')}
          >
            Going
          </button>
          <button
            type="button"
            aria-pressed={night.viewerRsvp === 'not_going'}
            onClick={() => void rsvp('not_going')}
          >
            Not going
          </button>
        </div>
      ) : null}
      {canEdit && open ? (
        <form className="night-host" onSubmit={(event) => void assignHost(event)}>
          <label>
            Night host for Night {position}
            <select
              value={hostMembershipId}
              onChange={(event) => setHostMembershipId(event.currentTarget.value)}
              required
            >
              <option value="">Select a Member</option>
              {hostCandidates.map((candidate) => (
                <option key={candidate.membershipId} value={candidate.membershipId}>
                  {candidate.displayName}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Assign Night host</button>
        </form>
      ) : null}
      {canHost && night.state === 'scheduled' ? (
        <button type="button" onClick={() => void run('/start', 'The Night could not be started.')}>
          Start Night {position}
        </button>
      ) : null}
      {canHost && night.state === 'live' ? (
        <button type="button" onClick={() => void run('/end', 'The Night could not be ended.')}>
          End Night {position}
        </button>
      ) : null}
    </>
  );
}

/** [BM-020] [BM-035] Scheduled Nights with RSVP, host assignment, and start/end. */
export function NightSchedule({
  houseId,
  membershipRole,
  timeZone,
  initialNights,
  hostCandidates = [],
}: {
  readonly houseId: string;
  readonly membershipRole: MembershipRole;
  readonly timeZone: string;
  readonly initialNights: readonly HouseNightView[];
  readonly hostCandidates?: readonly NightHostCandidate[];
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
      replace(await postNight(houseId, night.nightId, '', { state: 'cancelled' }));
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
                {timeZone} · {stateLabel(night.state)}
              </p>
              <NightLifecycleControls
                key={`${night.nightId}-${night.state}-${night.hostMembershipId ?? 'none'}`}
                houseId={houseId}
                night={night}
                position={index + 1}
                canEdit={canEdit}
                hostCandidates={hostCandidates}
                onChanged={replace}
                onError={(message) => setError(message === '' ? null : message)}
              />
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
