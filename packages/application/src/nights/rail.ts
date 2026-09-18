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
  const rail = await dependencies.rails.read(context, request.nightId);
  if (rail === null) return null;
  const presence = await dependencies.presence.read(
    context,
    request.nightId,
    dependencies.clock.now(),
  );
  return {
    ...rail,
    presence: presence.members,
    presenceCount: presence.members.length,
  };
}
