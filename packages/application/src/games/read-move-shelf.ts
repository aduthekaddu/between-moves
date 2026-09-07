import type {
  MoveShelf,
  ReadMoveShelfDependencies,
  ReadMoveShelfQuery,
} from '@between-moves/domain';

/** [BM-026] [DR-SHELF-01] Authorize and read the route-scoped Member Move Shelf. */
export async function readMoveShelf(
  query: ReadMoveShelfQuery,
  dependencies: ReadMoveShelfDependencies,
): Promise<MoveShelf | null> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'view_house_content' },
    query.houseId,
    query.viewer,
  );

  return dependencies.games.readMoveShelf(context);
}
