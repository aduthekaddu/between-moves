import {
  createHouseEmblemSeed,
  createHouseSlug,
  validateCreateHouseCommand,
  type AuthenticatedViewer,
  type CreateHouseCommand,
  type HouseCreationDependencies,
  type HouseCreationResult,
} from '@between-moves/domain';

/** [BM-011] [DR-HOUSE-01..02] Create a House through one transactional repository command. */
export async function createHouse(
  command: CreateHouseCommand,
  viewer: AuthenticatedViewer,
  dependencies: HouseCreationDependencies,
): Promise<HouseCreationResult> {
  const validated = validateCreateHouseCommand(command);
  const houseId = dependencies.ids.generate();

  return dependencies.houses.create({
    ...validated,
    houseId,
    ownerMembershipId: dependencies.ids.generate(),
    auditId: dependencies.ids.generate(),
    ownerUserId: viewer.userId,
    slug: createHouseSlug(houseId),
    emblemSeed: createHouseEmblemSeed(houseId),
    createdAt: dependencies.clock.now(),
  });
}
