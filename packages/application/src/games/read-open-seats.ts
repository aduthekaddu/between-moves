import type {
  OpenSeatListing,
  ReadOpenSeatsDependencies,
  ReadOpenSeatsQuery,
} from '@between-moves/domain';

/** [BM-023] [DR-SEC-01] Authorize a House view, then list the seats waiting for a player. */
export async function readOpenSeats(
  query: ReadOpenSeatsQuery,
  dependencies: ReadOpenSeatsDependencies,
): Promise<readonly OpenSeatListing[]> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'view_house_content' },
    query.houseId,
    query.viewer,
  );
  return dependencies.seats.listOpenSeats(context, dependencies.clock.now());
}
