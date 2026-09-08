import type {
  GamePosition,
  ReadGamePositionDependencies,
  ReadGamePositionQuery,
} from '@between-moves/domain';

/** [BM-027] [DR-SEC-01] Authorize and read one route-scoped canonical Game position. */
export async function readGamePosition(
  query: ReadGamePositionQuery,
  dependencies: ReadGamePositionDependencies,
): Promise<GamePosition | null> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'view_house_content' },
    query.houseId,
    query.viewer,
  );

  return dependencies.games.readGamePosition(context, query.gameId);
}
