import type { Viewer } from '../identity';
import type { AuthorizeHouseAction } from '../houses/authorization';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { Clock } from '../shared/clock';
import type { ClockPolicy } from './clock-policy';
import type { OfferedGameColor } from './seats';

export interface OpenSeatMember {
  readonly membershipId: string;
  readonly name: string;
}

/**
 * [BM-022] [BM-023] A Game waiting for its second player. `offeredColor` is the side the Member
 * who takes the seat plays; `any` means the colours were drawn by lot when the seat opened.
 */
export interface OpenSeatListing {
  readonly gameId: string;
  readonly openSeatId: string;
  readonly mode: 'correspondence' | 'live';
  readonly clockPolicy: ClockPolicy;
  readonly nightId: string | null;
  readonly offeredColor: OfferedGameColor;
  readonly creator: OpenSeatMember;
  /** The one Member a direct challenge is for; `null` for a seat any Member may take. */
  readonly intended: OpenSeatMember | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly viewerIsCreator: boolean;
  readonly viewerMayAccept: boolean;
}

/**
 * [BM-023] [DR-SEC-01] Open seats the viewer may see: every open seat in the active Season, and
 * the direct challenges they made or received. Live seats are listed only while their Night is
 * live, oldest first.
 */
export interface OpenSeatReadRepository {
  listOpenSeats(context: AuthorizationContext, now: Date): Promise<readonly OpenSeatListing[]>;
}

export interface ReadOpenSeatsQuery {
  readonly houseId: string;
  readonly viewer: Viewer;
}

export interface ReadOpenSeatsDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly seats: OpenSeatReadRepository;
  readonly clock: Clock;
}
