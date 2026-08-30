import type {
  InvitationRevocationDependencies,
  InvitationRevocationResult,
  RevokeInvitationRequest,
} from '@between-moves/domain';

/** [BM-014] [DR-INVITE-06] Authorize and revoke one route-scoped Invitation. */
export async function revokeInvitation(
  request: RevokeInvitationRequest,
  dependencies: InvitationRevocationDependencies,
): Promise<InvitationRevocationResult> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'revoke_invite' },
    request.houseId,
    request.viewer,
  );
  return dependencies.invitations.revoke(context, {
    invitationId: request.invitationId,
    auditId: dependencies.ids.generate(),
    revokedAt: dependencies.clock.now(),
  });
}
