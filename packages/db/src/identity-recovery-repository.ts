import type {
  AccountRecoveryReader,
  AccountRecoveryResult,
  RecoverySessionCleaner,
  RecoverySessionRepository,
  SessionRevocationReader,
} from '@between-moves/domain';
import type { Pool } from 'pg';

interface RevocationRow {
  readonly user_id: string;
  readonly revoked_session_count: number;
}

/** [BM-010] [DR-ID-02] PostgreSQL authority for account recovery and session revocation. */
export class PgIdentityRecoveryRepository
  implements
    AccountRecoveryReader,
    RecoverySessionRepository,
    RecoverySessionCleaner,
    SessionRevocationReader
{
  constructor(private readonly pool: Pool) {}

  async hasActiveAccount(email: string): Promise<boolean> {
    const result = await this.pool.query(
      `select 1 from users
        where email = $1 and status = 'active'
        limit 1`,
      [email],
    );
    return result.rowCount === 1;
  }

  async revokePriorSessions(
    currentSessionToken: string,
    revokedAt: Date,
  ): Promise<AccountRecoveryResult | null> {
    const result = await this.pool.query<RevocationRow>(
      `with recovered as (
         select user_id from sessions
          where token = $1 and revoked_at is null and expires_at > $2
          for update
       ), revoked as (
         update sessions session
            set revoked_at = $2, updated_at = $2
           from recovered
          where session.user_id = recovered.user_id
            and session.token <> $1
            and session.revoked_at is null
         returning session.id
       )
       select recovered.user_id::text,
              count(revoked.id)::integer as revoked_session_count
         from recovered left join revoked on true
        group by recovered.user_id`,
      [currentSessionToken, revokedAt],
    );
    const row = result.rows[0];
    return row ? { userId: row.user_id, revokedSessionCount: row.revoked_session_count } : null;
  }

  async isSessionActive(sessionId: string): Promise<boolean> {
    const result = await this.pool.query(
      `select 1 from sessions
        where id = $1 and revoked_at is null
        limit 1`,
      [sessionId],
    );
    return result.rowCount === 1;
  }

  async revokeSession(sessionToken: string, revokedAt: Date): Promise<void> {
    await this.pool.query(
      `update sessions
          set revoked_at = $2, updated_at = $2
        where token = $1 and revoked_at is null`,
      [sessionToken, revokedAt],
    );
  }
}
