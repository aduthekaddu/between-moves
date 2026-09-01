import {
  OPEN_SEAT_LIFETIME_MS,
  creatorColorForOffer,
  type CreateGameSeatRequest,
  type GameSeatCreationDependencies,
  type GameSeatCreationResult,
} from '@between-moves/domain';

function idempotencyPayload(request: CreateGameSeatRequest): string {
  return JSON.stringify({
    mode: request.mode,
    clockPolicy: request.clockPolicy,
    offeredColor: request.offeredColor,
    intendedMembershipId: request.intendedMembershipId,
  });
}

/** [BM-022] [DR-SEAT-01..02] Authorize and create one correspondence Open seat. */
export async function createGameSeat(
  request: CreateGameSeatRequest,
  dependencies: GameSeatCreationDependencies,
): Promise<GameSeatCreationResult> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'create_or_join_game' },
    request.houseId,
    request.viewer,
  );
  const createdAt = dependencies.clock.now();
  return dependencies.seats.create(context, {
    gameId: dependencies.ids.generate(),
    openSeatId: dependencies.ids.generate(),
    mode: request.mode,
    clockPolicy: request.clockPolicy,
    offeredColor: request.offeredColor,
    creatorColor: creatorColorForOffer(request.offeredColor, () => dependencies.colors.choose()),
    intendedMembershipId: request.intendedMembershipId,
    idempotencyKey: request.idempotencyKey,
    idempotencyPayload: idempotencyPayload(request),
    createdAt,
    expiresAt: new Date(createdAt.getTime() + OPEN_SEAT_LIFETIME_MS),
  });
}
