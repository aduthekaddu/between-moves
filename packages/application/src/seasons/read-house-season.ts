import type {
  HouseSeasonView,
  ReadHouseSeasonDependencies,
  ReadHouseSeasonRequest,
} from '@between-moves/domain';

/** [BM-019] [PR-JRN-03] Read the current Season through House membership authority. */
export async function readHouseSeason(
  request: ReadHouseSeasonRequest,
  dependencies: ReadHouseSeasonDependencies,
): Promise<HouseSeasonView | null> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'view_house_content' },
    request.houseId,
    request.viewer,
  );
  return dependencies.seasons.readCurrent(context);
}
