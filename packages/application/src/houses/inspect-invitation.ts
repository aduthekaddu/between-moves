import type {
  InspectInvitationRequest,
  InvitationInspectionDependencies,
  InvitationPreview,
} from '@between-moves/domain';

/** [BM-014] [DR-INVITE-02/13] Inspect a usable Invitation through its digest. */
export function inspectInvitation(
  request: InspectInvitationRequest,
  dependencies: InvitationInspectionDependencies,
): Promise<InvitationPreview | null> {
  const tokenDigestHex = dependencies.tokens.digest(request.token);
  if (tokenDigestHex === null) return Promise.resolve(null);
  return dependencies.invitations.inspect({
    tokenDigestHex,
    inspectedAt: dependencies.clock.now(),
  });
}
