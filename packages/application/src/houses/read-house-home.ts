import type {
  HouseHome,
  ReadHouseHomeDependencies,
  ReadHouseHomeQuery,
} from '@between-moves/domain';

/** [BM-013] [DR-MEM-04] Authorize and read one route-scoped House home. */
export async function readHouseHome(
  query: ReadHouseHomeQuery,
  dependencies: ReadHouseHomeDependencies,
): Promise<HouseHome | null> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'view_house_content' },
    query.houseId,
    query.viewer,
  );

  return dependencies.houses.read(context);
}
