import {
  AuthenticationRequiredError,
  DomainError,
  type IssuedRealtimeToken,
  type MintRealtimeTokenRequest,
  type RealtimeTokenDependencies,
} from '@between-moves/domain';

/** [BM-037] [DR-SEC-01] Mint a short-lived token scoped to a Night and its Game channels. */
export async function mintRealtimeToken(
  request: MintRealtimeTokenRequest,
  dependencies: RealtimeTokenDependencies,
): Promise<IssuedRealtimeToken> {
  if (request.viewer.kind !== 'authenticated') throw new AuthenticationRequiredError();
  const viewer = request.viewer;
  const context = await dependencies.authorizeHouseAction(
    { kind: 'view_house_content' },
    request.houseId,
    viewer,
  );
  const scope = await dependencies.nights.read(context, request.nightId);
  if (scope === null) throw new DomainError('not_found', 'Night is unavailable');
  return dependencies.tokens.issue({
    houseId: scope.houseId,
    nightId: scope.nightId,
    gameIds: scope.gameIds,
    clientId: viewer.userId,
    displayName: viewer.displayName,
    issuedAt: dependencies.clock.now(),
  });
}
