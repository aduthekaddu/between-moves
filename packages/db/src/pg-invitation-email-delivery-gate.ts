import type { InvitationEmailDeliveryGate, InvitationEmailSendResult } from '@between-moves/domain';
import type { Pool } from 'pg';

/** Hold the Invitation row lock until provider delivery finishes. */
export class PgInvitationEmailDeliveryGate implements InvitationEmailDeliveryGate {
  constructor(private readonly database: Pool) {}

  async withDeliverableInvitation(
    invitationId: string,
    send: () => Promise<InvitationEmailSendResult>,
  ): Promise<InvitationEmailSendResult | null> {
    const client = await this.database.connect();
    try {
      await client.query('begin');
      const invitation = await client.query(
        `select 1 from invitations
          where id = $1 and revoked_at is null and intended_email is not null
          for update`,
        [invitationId],
      );
      if (invitation.rowCount === 0) {
        await client.query('commit');
        return null;
      }
      const result = await send();
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
