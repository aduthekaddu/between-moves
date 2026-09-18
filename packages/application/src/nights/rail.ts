import type {
  NightRailSnapshot,
  ReadNightRailDependencies,
  ReadNightRailRequest,
} from '@between-moves/domain';

/** [BM-038] [DR-SEC-01] Authorize and read one House-scoped Night rail snapshot. */
export async function readNightRail(
  request: ReadNightRailRequest,
  dependencies: ReadNightRailDependencies,
): Promise<NightRailSnapshot | null> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'view_house_content' },
    request.houseId,
    request.viewer,
  );
  return dependencies.rails.read(context, request.nightId);
}
