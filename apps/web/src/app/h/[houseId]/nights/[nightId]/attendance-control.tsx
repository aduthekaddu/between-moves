'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { postHouseCommand, problemDetail } from '../../../../_components/house-command';

/** The viewer's durable attendance as the server last saw it. */
export interface RailAttendance {
  /** Start of the open interval, or `null` while stepped away. */
  readonly joinedAt: string | null;
  readonly accumulatedSeconds: number;
  readonly qualified: boolean;
}

function secondsAtTable(attendance: RailAttendance | null, now: number): number {
  if (attendance === null) return 0;
  const open =
    attendance.joinedAt === null
      ? 0
      : Math.max(0, Math.floor((now - Date.parse(attendance.joinedAt)) / 1000));
  return attendance.accumulatedSeconds + open;
}

function minutes(seconds: number): string {
  const whole = Math.floor(seconds / 60);
  return whole === 1 ? '1 minute' : `${whole} minutes`;
}

/**
 * [BM-036] Pull up a chair: durable, server-timed attendance for the Night's scoring. Presence
 * on the rail is separate and ephemeral. Qualification is decided when the Member steps away
 * after the threshold; nothing settles an open interval when the Night ends.
 */
export function AttendanceControl({
  houseId,
  nightId,
  live,
  initial,
  thresholdSeconds,
}: {
  readonly houseId: string;
  readonly nightId: string;
  readonly live: boolean;
  readonly initial: RailAttendance | null;
  readonly thresholdSeconds: number;
}) {
  const router = useRouter();
  const [attendance, setAttendance] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const seated = attendance?.joinedAt !== null && attendance !== null;

  useEffect(() => {
    if (!seated) return;
    const timer = window.setInterval(() => setNow(Date.now()), 20_000);
    return () => window.clearInterval(timer);
  }, [seated]);

  if (!live && attendance === null) return null;
  const total = secondsAtTable(attendance, now);
  const counted = attendance?.qualified === true;

  async function change(kind: 'join' | 'leave') {
    if (pending) return;
    setPending(true);
    setError('');
    const outcome = await postHouseCommand(
      `/api/houses/${encodeURIComponent(houseId)}/nights/${encodeURIComponent(nightId)}/${kind}`,
    );
    setPending(false);
    if (!outcome.ok) {
      setError(
        outcome.status === 0
          ? 'Could not connect. Try again.'
          : outcome.status === 404
            ? 'The Night has ended.'
            : (problemDetail(outcome.body) ?? 'That did not go through. Try again.'),
      );
      return;
    }
    const at = Date.now();
    setNow(at);
    setAttendance((current) =>
      kind === 'join'
        ? {
            joinedAt: new Date(at).toISOString(),
            accumulatedSeconds: current?.accumulatedSeconds ?? 0,
            qualified: current?.qualified ?? false,
          }
        : {
            joinedAt: null,
            accumulatedSeconds: secondsAtTable(current, at),
            qualified: current?.qualified ?? false,
          },
    );
    router.refresh();
  }

  const progress = Math.min(1, total / thresholdSeconds);
  const threshold = Math.round(thresholdSeconds / 60);
  return (
    <section className="rail-attendance" aria-labelledby="rail-attendance-title">
      <h2 id="rail-attendance-title" className="visually-hidden">
        Your attendance tonight
      </h2>
      <div className="rail-attendance__words" aria-live="polite">
        {!live ? (
          <p>
            <strong>You were at the table for {minutes(total)}.</strong>{' '}
            {counted ? 'Tonight counted toward your Season.' : ''}
          </p>
        ) : counted ? (
          <p>
            <strong>{seated ? 'You are at the table.' : 'Welcome back any time.'}</strong> Tonight
            already counts toward your Season.
          </p>
        ) : seated ? (
          <p>
            <strong>You are at the table.</strong>{' '}
            {total >= thresholdSeconds
              ? `That is ${threshold} minutes. Step away when you leave and tonight counts.`
              : `${minutes(total)} so far. After ${threshold}, step away and tonight counts toward your Season.`}
          </p>
        ) : (
          <p>
            <strong>Pull up a chair.</strong> Check in while you are here. After {threshold} minutes
            at the table, step away and tonight counts toward your Season.
          </p>
        )}
        {live && !counted ? (
          <span className="rail-attendance__meter" aria-hidden="true">
            <span className="rail-attendance__fill" data-step={Math.round(progress * 10)} />
          </span>
        ) : null}
        {counted ? (
          <span className="rail-attendance__stamp" aria-hidden="true">
            Counted
          </span>
        ) : null}
      </div>
      {live ? (
        <button
          type="button"
          className={seated ? 'rail-attendance__leave' : 'rail-attendance__join'}
          disabled={pending}
          onClick={() => void change(seated ? 'leave' : 'join')}
        >
          {pending
            ? seated
              ? 'Stepping away…'
              : 'Pulling up a chair…'
            : seated
              ? 'Step away'
              : 'Pull up a chair'}
        </button>
      ) : null}
      {error === '' ? null : <p role="alert">{error}</p>}
    </section>
  );
}
