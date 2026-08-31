import {
  InvitationRedemptionError,
  type InvitationRedemptionDependencies,
  type InvitationRedemptionResult,
  type RedeemInvitationRequest,
} from '@between-moves/domain';

/** [BM-016] [DR-INVITE-07..10] Redeem one digest-bound Invitation for a signed-in person. */
export function redeemInvitation(
  request: RedeemInvitationRequest,
  dependencies: InvitationRedemptionDependencies,
): Promise<InvitationRedemptionResult> {
  const tokenDigestHex = dependencies.tokens.digest(request.token);
  if (tokenDigestHex === null) throw new InvitationRedemptionError('invalid');

  return dependencies.invitations.redeem({
    tokenDigestHex,
    userId: request.viewer.userId,
    membershipId: dependencies.ids.generate(),
    auditId: dependencies.ids.generate(),
    redeemedAt: dependencies.clock.now(),
  });
}
