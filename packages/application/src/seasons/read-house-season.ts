import type {
  ClosedSeasonView,
  HouseSeasonView,
  ReadHouseSeasonDependencies,
  ReadHouseSeasonRequest,
  ReadLastClosedSeasonDependencies,
  ReadLastClosedSeasonRequest,
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

/** [BM-047] Read the latest closed Season's final standings for any active House Member. */
export async function readLastClosedSeason(
  request: ReadLastClosedSeasonRequest,
  dependencies: ReadLastClosedSeasonDependencies,
): Promise<ClosedSeasonView | null> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'view_house_content' },
    request.houseId,
    request.viewer,
  );
  return dependencies.seasons.readLatestClosed(context);
}
