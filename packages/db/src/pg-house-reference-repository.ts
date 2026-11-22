import type {
  AuthorizationContext,
  HouseReference,
  HouseReferenceRepository,
} from '@between-moves/domain';
import type { Pool, QueryResultRow } from 'pg';

interface HouseReferenceRow extends QueryResultRow {
  readonly id: unknown;
  readonly house_id: unknown;
  readonly label: unknown;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid House reference ${field}`);
  return value;
}

/** [BM-005] DR-SEC-01 adapter: every read includes House, viewer, and active status. */
export class PgHouseReferenceRepository implements HouseReferenceRepository {
  constructor(private readonly database: Pool) {}

  async list(context: AuthorizationContext): Promise<readonly HouseReference[]> {
    const result = await this.database.query<HouseReferenceRow>(
      `select id, house_id, label
         from house_reference_records
        where house_id = $1
          and authorized_viewer_id = $2
          and membership_status = 'active'
        order by id asc`,
      [context.houseId, context.viewerId],
    );
    return result.rows.map((row) => ({
      id: text(row.id, 'id'),
      houseId: text(row.house_id, 'house id'),
      label: text(row.label, 'label'),
    }));
  }
}
