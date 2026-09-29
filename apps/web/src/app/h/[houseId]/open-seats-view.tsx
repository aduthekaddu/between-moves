import type { ClockPolicy, OfferedGameColor, OpenSeatListing } from '@between-moves/domain';
import { AcceptSeatButton } from './accept-seat-button';

function clockLabel(policy: ClockPolicy): string {
  if (policy.kind === 'correspondence') return `Correspondence · ${policy.perMoveHours} h a Move`;
  const minutes = Math.round(policy.initialMs / 60_000);
  const seconds = Math.round(policy.incrementMs / 1_000);
  return `Live · ${minutes} + ${seconds}`;
}

/** The side the viewer would play: the offered side when taking a seat, the other when it is theirs. */
function sideLabel(offered: OfferedGameColor, viewerIsCreator: boolean): string {
  if (offered === 'any') return 'Colours by lot';
  const viewerSide = viewerIsCreator ? (offered === 'white' ? 'Black' : 'White') : offered;
  return `You play ${viewerSide === 'white' ? 'White' : viewerSide === 'black' ? 'Black' : viewerSide}`;
}

function remaining(until: Date, viewedAt: Date): string {
  const hours = Math.max(1, Math.ceil((until.getTime() - viewedAt.getTime()) / 3_600_000));
  if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = Math.ceil(hours / 24);
  return `${days} days`;
}

function wording(seat: OpenSeatListing): { stamp: string; title: string; action: string | null } {
  if (seat.viewerIsCreator) {
    return seat.intended === null
      ? { stamp: 'Your open seat', title: 'Waiting for a player', action: null }
      : { stamp: 'Your challenge', title: `Waiting on ${seat.intended.name}`, action: null };
  }
  return seat.intended === null
    ? { stamp: 'Open seat', title: `${seat.creator.name} wants a game`, action: 'Take the seat' }
    : { stamp: 'Challenge', title: `${seat.creator.name} challenges you`, action: 'Accept' };
}

/** [BM-023] Seats waiting for a second player, with the viewer's own offers kept apart. */
export function OpenSeatsView({
  houseId,
  seats,
  viewedAt,
}: {
  readonly houseId: string;
  readonly seats: readonly OpenSeatListing[];
  readonly viewedAt: Date;
}) {
  if (seats.length === 0) return null;
  const ordered = [
    ...seats.filter((seat) => seat.viewerMayAccept && seat.intended !== null),
    ...seats.filter((seat) => seat.viewerMayAccept && seat.intended === null),
    ...seats.filter((seat) => !seat.viewerMayAccept),
  ];
  return (
    <section id="open-seats" className="open-seats" aria-labelledby="open-seats-title">
      <div className="move-shelf__heading">
        <p className="house-home__eyebrow">Looking for a game</p>
        <h2 id="open-seats-title">Open seats ({seats.length})</h2>
      </div>
      <ul className="open-seats__list">
        {ordered.map((seat) => {
          const words = wording(seat);
          return (
            <li key={seat.openSeatId}>
              <article
                className="seat-card"
                data-kind={seat.intended === null ? 'open' : 'challenge'}
                data-own={seat.viewerIsCreator ? 'true' : undefined}
                aria-label={`${words.stamp}: ${words.title}`}
              >
                <span className="move-card__status seat-card__stamp">{words.stamp}</span>
                <strong>{words.title}</strong>
                <span className="seat-card__terms">
                  <span>{clockLabel(seat.clockPolicy)}</span>
                  <span>{sideLabel(seat.offeredColor, seat.viewerIsCreator)}</span>
                </span>
                <span className="move-card__time">
                  Closes in{' '}
                  <time dateTime={seat.expiresAt.toISOString()}>
                    {remaining(seat.expiresAt, viewedAt)}
                  </time>
                </span>
                {words.action === null || !seat.viewerMayAccept ? null : (
                  <AcceptSeatButton
                    houseId={houseId}
                    gameId={seat.gameId}
                    mode={seat.mode}
                    label={words.action}
                  />
                )}
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
