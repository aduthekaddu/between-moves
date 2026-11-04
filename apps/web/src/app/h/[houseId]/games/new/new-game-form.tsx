'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState, type FormEvent } from 'react';
import {
  newIdempotencyKey,
  postHouseCommand,
  problemDetail,
} from '../../../../_components/house-command';

export interface Opponent {
  readonly membershipId: string;
  readonly displayName: string;
}

type Mode = 'correspondence' | 'live';
type SeatKind = 'open' | 'challenge';
type Side = 'white' | 'black' | 'either';

/** Live controls start at the domain minimum of three minutes. */
export const LIVE_TIME_CONTROLS = [
  { id: '10+5', label: '10 + 5', note: 'Rapid', initialMs: 600_000, incrementMs: 5_000 },
  { id: '15+10', label: '15 + 10', note: 'Unhurried', initialMs: 900_000, incrementMs: 10_000 },
  { id: '5+3', label: '5 + 3', note: 'Blitz', initialMs: 300_000, incrementMs: 3_000 },
  { id: '3+2', label: '3 + 2', note: 'Quick', initialMs: 180_000, incrementMs: 2_000 },
] as const;

type TimeControlId = (typeof LIVE_TIME_CONTROLS)[number]['id'];

/** The seat offers the other side to whoever takes it; "either" is drawn by lot. */
export function offeredColorFor(side: Side): 'white' | 'black' | 'any' {
  if (side === 'white') return 'black';
  if (side === 'black') return 'white';
  return 'any';
}

function failure(status: number, body: unknown): string {
  if (status === 0) return 'Could not connect. Check your connection and try again.';
  if (status === 401) return 'Your session expired. Sign in again to start a game.';
  if (status === 403) return 'Only House Members can open a seat.';
  if (status === 404) return 'That Member is no longer in the House. Choose someone else.';
  if (status === 409) return problemDetail(body) ?? 'The House is not ready for this game yet.';
  return problemDetail(body) ?? 'The game could not be set up. Check the details and try again.';
}

/** [BM-022] One form for Open seats and direct challenges, in either mode. */
export function NewGameForm({
  houseId,
  perMoveHours,
  liveNightId,
  opponents,
  requestedOpponentId,
  requestedLive = false,
}: {
  readonly houseId: string;
  readonly perMoveHours: number;
  readonly liveNightId: string | null;
  readonly opponents: readonly Opponent[];
  /** From a "Challenge {name}" link; ignored unless it names one of `opponents`. */
  readonly requestedOpponentId?: string | undefined;
  /** From the Night's "Start a live game" link; ignored unless a Night is live. */
  readonly requestedLive?: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const requested = opponents.some((opponent) => opponent.membershipId === requestedOpponentId)
    ? requestedOpponentId
    : undefined;
  const [mode, setMode] = useState<Mode>(
    requestedLive && liveNightId !== null ? 'live' : 'correspondence',
  );
  const [timeControl, setTimeControl] = useState<TimeControlId>('10+5');
  const [seatKind, setSeatKind] = useState<SeatKind>(
    requested === undefined ? 'open' : 'challenge',
  );
  const [opponentId, setOpponentId] = useState(requested ?? '');
  const [side, setSide] = useState<Side>('either');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const idempotencyKey = useRef(newIdempotencyKey());
  const liveAvailable = liveNightId !== null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (seatKind === 'challenge' && opponentId === '') {
      setError('Choose the Member you want to challenge.');
      return;
    }
    setPending(true);
    setError('');
    const control = LIVE_TIME_CONTROLS.find((candidate) => candidate.id === timeControl);
    const common = {
      offeredColor: offeredColorFor(side),
      ...(seatKind === 'challenge' ? { intendedMembershipId: opponentId } : {}),
    };
    const body =
      mode === 'live' && liveNightId !== null && control !== undefined
        ? {
            mode: 'live',
            nightId: liveNightId,
            clockPolicy: {
              kind: 'live',
              initialMs: control.initialMs,
              incrementMs: control.incrementMs,
            },
            ...common,
          }
        : {
            mode: 'correspondence',
            clockPolicy: { kind: 'correspondence', perMoveHours },
            ...common,
          };
    const outcome = await postHouseCommand(`/api/houses/${encodeURIComponent(houseId)}/games`, {
      body,
      idempotencyKey: idempotencyKey.current,
    });
    if (!outcome.ok) {
      setPending(false);
      setError(failure(outcome.status, outcome.body));
      if (outcome.status !== 0) idempotencyKey.current = newIdempotencyKey();
      return;
    }
    router.push(`/h/${encodeURIComponent(houseId)}#open-seats`);
    router.refresh();
  }

  const challenged = opponents.find((opponent) => opponent.membershipId === opponentId);
  return (
    <form className="new-game-form" onSubmit={(event) => void submit(event)} noValidate>
      <fieldset className="new-game-form__group">
        <legend>How you will play</legend>
        <div className="new-game-options new-game-options--two">
          <label className="new-game-option">
            <input
              type="radio"
              name="mode"
              value="correspondence"
              checked={mode === 'correspondence'}
              onChange={() => setMode('correspondence')}
            />
            <span className="new-game-option__card">
              <strong>Correspondence</strong>
              <span>
                One Move every {perMoveHours} hours, the Charter’s pace. Play between everything
                else.
              </span>
            </span>
          </label>
          <label className="new-game-option" data-disabled={liveAvailable ? undefined : 'true'}>
            <input
              type="radio"
              name="mode"
              value="live"
              checked={mode === 'live'}
              disabled={!liveAvailable}
              aria-describedby={`${id}-live-note`}
              onChange={() => setMode('live')}
            />
            <span className="new-game-option__card">
              <strong>Live, tonight</strong>
              <span id={`${id}-live-note`}>
                {liveAvailable
                  ? 'The Night is live. Both of you at the board, clocks running.'
                  : 'Opens while a Between Moves Night is live.'}
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      {mode === 'live' ? (
        <fieldset className="new-game-form__group">
          <legend>Clock</legend>
          <div className="new-game-options new-game-options--clocks">
            {LIVE_TIME_CONTROLS.map((control) => (
              <label key={control.id} className="new-game-option new-game-option--clock">
                <input
                  type="radio"
                  name="clock"
                  value={control.id}
                  checked={timeControl === control.id}
                  onChange={() => setTimeControl(control.id)}
                />
                <span className="new-game-option__card">
                  <strong className="new-game-option__clock">{control.label}</strong>
                  <span>
                    {control.note} · {control.initialMs / 60_000} min, +{control.incrementMs / 1000}{' '}
                    s a Move
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <fieldset className="new-game-form__group">
        <legend>Who plays</legend>
        <div className="new-game-options new-game-options--two">
          <label className="new-game-option">
            <input
              type="radio"
              name="seat"
              value="open"
              checked={seatKind === 'open'}
              onChange={() => setSeatKind('open')}
            />
            <span className="new-game-option__card">
              <strong>An open seat</strong>
              <span>The first Member to take it plays you. It waits a week on the House home.</span>
            </span>
          </label>
          <label className="new-game-option">
            <input
              type="radio"
              name="seat"
              value="challenge"
              checked={seatKind === 'challenge'}
              onChange={() => setSeatKind('challenge')}
            />
            <span className="new-game-option__card">
              <strong>A challenge</strong>
              <span>Only the Member you name can accept.</span>
            </span>
          </label>
        </div>
        {seatKind === 'challenge' ? (
          <div className="new-game-form__field">
            <label htmlFor={`${id}-opponent`}>Challenge</label>
            <select
              id={`${id}-opponent`}
              value={opponentId}
              required
              onChange={(event) => setOpponentId(event.currentTarget.value)}
            >
              <option value="">Choose a Member</option>
              {opponents.map((opponent) => (
                <option key={opponent.membershipId} value={opponent.membershipId}>
                  {opponent.displayName}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </fieldset>

      <fieldset className="new-game-form__group">
        <legend>Your pieces</legend>
        <div className="new-game-options new-game-options--sides">
          {(
            [
              ['white', 'White', 'You move first.'],
              ['black', 'Black', 'You reply.'],
              ['either', 'Either', 'Drawn by lot.'],
            ] as const
          ).map(([value, label, note]) => (
            <label key={value} className="new-game-option new-game-option--side">
              <input
                type="radio"
                name="side"
                value={value}
                checked={side === value}
                onChange={() => setSide(value)}
              />
              <span className="new-game-option__card">
                <span className="new-game-side" data-side={value} aria-hidden="true">
                  {value !== 'black' ? <span data-piece="white-king" /> : null}
                  {value !== 'white' ? <span data-piece="black-king" /> : null}
                </span>
                <strong>{label}</strong>
                <span>{note}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {error === '' ? null : (
        <p className="new-game-form__error" role="alert">
          {error}
        </p>
      )}

      <div className="new-game-form__submit-row">
        <button className="new-game-form__submit" type="submit" disabled={pending}>
          {pending
            ? 'Setting the board…'
            : seatKind === 'challenge'
              ? `Challenge ${challenged?.displayName ?? 'a Member'}`
              : 'Open the seat'}
        </button>
        <a className="new-game-form__cancel" href={`/h/${encodeURIComponent(houseId)}`}>
          Back to the House
        </a>
      </div>
    </form>
  );
}
