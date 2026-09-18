import { nightRailSnapshotSchema } from '@between-moves/contracts';
import type { NightRailSnapshot } from '@between-moves/domain';
import { z } from 'zod';
import { problemResponse } from '../kernel/request';
import { serializeNightRailSnapshot, type NightRailReader } from '../modules/nights/rail';

const idSchema = z.string().uuid();

export interface NightRailHandlerDependencies {
  readonly readNightRail: NightRailReader;
}

/** [BM-038] HTTP boundary for the durable Night rail snapshot. */
export function createReadNightRailHandler(dependencies: NightRailHandlerDependencies) {
  return async (request: Request, houseId: string, nightId: string): Promise<Response> => {
    if (!idSchema.safeParse(houseId).success || !idSchema.safeParse(nightId).success) {
      return problemResponse(
        request,
        422,
        'validation_failed',
        'Validation failed',
        'House ID or Night ID is invalid.',
      );
    }
    const snapshot: NightRailSnapshot | null = await dependencies.readNightRail(
      request,
      houseId,
      nightId,
    );
    if (snapshot === null) {
      return problemResponse(
        request,
        404,
        'not_found',
        'Rail not available',
        'This Night rail is not available.',
      );
    }
    return Response.json(nightRailSnapshotSchema.parse(serializeNightRailSnapshot(snapshot)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  };
}
