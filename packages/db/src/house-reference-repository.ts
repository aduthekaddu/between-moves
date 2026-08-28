import type {
  AuthorizationContext,
  HouseReference,
  HouseReferenceRepository,
} from '@between-moves/domain';
import { and, asc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { houseReferenceRecords } from './schema';

/** [BM-005] DR-SEC-01 adapter: every read includes House, viewer, and active status. */
export class DrizzleHouseReferenceRepository implements HouseReferenceRepository {
  constructor(private readonly database: NodePgDatabase) {}

  async list(context: AuthorizationContext): Promise<readonly HouseReference[]> {
    return this.database
      .select({
        id: houseReferenceRecords.id,
        houseId: houseReferenceRecords.houseId,
        label: houseReferenceRecords.label,
      })
      .from(houseReferenceRecords)
      .where(
        and(
          eq(houseReferenceRecords.houseId, context.houseId),
          eq(houseReferenceRecords.authorizedViewerId, context.viewerId),
          eq(houseReferenceRecords.membershipStatus, 'active'),
        ),
      )
      .orderBy(asc(houseReferenceRecords.id));
  }
}
