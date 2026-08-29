import { generateUuidV7, SystemClock } from '@between-moves/adapters';
import { createHouse as createHouseUseCase } from '@between-moves/application';
import { PgHouseCreationRepository } from '@between-moves/db';
import type {
  AuthenticatedViewer,
  CreateHouseCommand,
  HouseCreationResult,
} from '@between-moves/domain';
import { getDatabase } from './database';

const clock = new SystemClock();

/** [BM-011] Composition root for the House creation application command. */
export function createHouse(
  command: CreateHouseCommand,
  viewer: AuthenticatedViewer,
): Promise<HouseCreationResult> {
  return createHouseUseCase(command, viewer, {
    clock,
    ids: { generate: () => generateUuidV7() },
    houses: new PgHouseCreationRepository(getDatabase().pool),
  });
}
