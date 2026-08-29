import type {
  HouseCreationInput,
  HouseCreationRepository,
  HouseCreationResult,
} from '@between-moves/domain';
import type { Pool } from 'pg';

/** [BM-011] [DR-HOUSE-02] PostgreSQL transaction for the first House Owner and audit. */
export class PgHouseCreationRepository implements HouseCreationRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: HouseCreationInput): Promise<HouseCreationResult> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into houses
          (id, name, slug, description, emblem_seed, time_zone, owner_membership_id,
           member_cap, status, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, null, 30, 'active', $7, $7)`,
        [
          input.houseId,
          input.name,
          input.slug,
          input.description,
          input.emblemSeed,
          input.timeZone,
          input.createdAt,
        ],
      );
      await client.query(
        `insert into memberships
          (id, house_id, user_id, role, status, joined_at, created_at, updated_at)
         values ($1, $2, $3, 'owner', 'active', $4, $4, $4)`,
        [input.ownerMembershipId, input.houseId, input.ownerUserId, input.createdAt],
      );
      await client.query(
        `update houses set owner_membership_id = $2, updated_at = $3 where id = $1`,
        [input.houseId, input.ownerMembershipId, input.createdAt],
      );
      await client.query(
        `insert into membership_audit
          (id, house_id, actor_membership_id, action, target_membership_id, metadata, created_at)
         values ($1, $2, $3, 'member_joined', $3, null, $4)`,
        [input.auditId, input.houseId, input.ownerMembershipId, input.createdAt],
      );
      await client.query('commit');

      return {
        houseId: input.houseId,
        ownerMembershipId: input.ownerMembershipId,
        slug: input.slug,
        emblemSeed: input.emblemSeed,
        timeZone: input.timeZone,
      };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
