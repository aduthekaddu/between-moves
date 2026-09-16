import type {
  CreateInvitationRequest,
  InvitationCreationDependencies,
  InvitationCreationResult,
} from '@between-moves/domain';
import { INVITATION_EMAIL_TOPIC } from '@between-moves/domain';

/** [BM-014] [DR-INVITE-02/06] Authorize and create one digest-only Invitation. */
export async function createInvitation(
  request: CreateInvitationRequest,
  dependencies: InvitationCreationDependencies,
): Promise<InvitationCreationResult> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'create_member_invite' },
    request.houseId,
    request.viewer,
  );
  const token = dependencies.tokens.issue(
    request.idempotencyKey === null
      ? { kind: 'random' }
      : {
          kind: 'idempotent',
          scope: `${request.viewer.userId}:${request.houseId}:${request.idempotencyKey}`,
        },
  );
  const invitationId = dependencies.ids.generate();
  const createdAt = dependencies.clock.now();
  const deliveryEvent =
    request.command.kind === 'single'
      ? {
          id: dependencies.ids.generate(),
          topic: INVITATION_EMAIL_TOPIC,
          aggregateId: invitationId,
          sequence: 1n,
          houseId: request.houseId,
          payload: {
            sealed: await dependencies.invitationEmail.codec.seal({
              email: request.command.intendedEmail.trim().toLowerCase(),
              invitationUrl: dependencies.invitationEmail.buildUrl(token.raw),
            }),
          },
          availableAt: createdAt,
          occurredAt: createdAt,
        }
      : null;
  const persisted = await dependencies.invitations.create(context, {
    invitationId,
    auditId: dependencies.ids.generate(),
    command: request.command,
    tokenDigestHex: token.digestHex,
    createdAt,
    deliveryEvent,
  });

  return { ...persisted, token: token.raw };
}
