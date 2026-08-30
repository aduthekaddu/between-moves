import type {
  CreateInvitationRequest,
  InvitationCreationDependencies,
  InvitationCreationResult,
} from '@between-moves/domain';

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
  const persisted = await dependencies.invitations.create(context, {
    invitationId: dependencies.ids.generate(),
    auditId: dependencies.ids.generate(),
    command: request.command,
    tokenDigestHex: token.digestHex,
    createdAt: dependencies.clock.now(),
  });

  return { ...persisted, token: token.raw };
}
