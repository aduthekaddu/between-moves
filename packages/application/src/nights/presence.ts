import {
  AuthenticationRequiredError,
  DomainError,
  type NightPresenceDependencies,
  type NightPresenceRequest,
  type NightPresenceSnapshot,
} from '@between-moves/domain';

/** [BM-039] Re-authorize every ephemeral enter/leave and accept only server-signed identity. */
export async function changeNightPresence(
  request: NightPresenceRequest,
  dependencies: NightPresenceDependencies,
): Promise<NightPresenceSnapshot> {
  if (request.viewer.kind !== 'authenticated') throw new AuthenticationRequiredError();
  const viewer = request.viewer;
  const context = await dependencies.authorizeHouseAction(
    { kind: 'view_house_content' },
    request.houseId,
    viewer,
  );
  const scope = await dependencies.nights.read(context, request.nightId);
  if (scope === null) throw new DomainError('not_found', 'Night is unavailable');

  if (
    request.command.presence.clientId !== viewer.userId ||
    request.command.presence.displayName !== viewer.displayName
  ) {
    throw new DomainError('validation_failed', 'Presence identity is invalid');
  }

  const now = dependencies.clock.now();
  const verified = dependencies.verifyPresence({
    scope,
    token: request.command.token,
    presence: request.command.presence,
    now,
  });
  if (verified.expiresAt.getTime() <= now.getTime()) {
    throw new DomainError('validation_failed', 'Presence identity is invalid');
  }

  if (request.command.kind === 'enter') {
    return dependencies.presence.enter(
      context,
      request.nightId,
      {
        ...request.command.presence,
        leaseId: verified.leaseId,
        expiresAt: verified.expiresAt,
      },
      now,
    );
  }
  return dependencies.presence.leave(
    context,
    request.nightId,
    { clientId: viewer.userId, leaseId: verified.leaseId },
    now,
  );
}
