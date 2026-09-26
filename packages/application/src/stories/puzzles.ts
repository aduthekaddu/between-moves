import type {
  AuthenticatedViewer,
  AuthorizationContext,
  AuthorizeHouseAction,
  Clock,
  IdGenerator,
} from '@between-moves/domain';

export interface PublishHousePuzzleRequest {
  readonly houseId: string;
  readonly candidateId: string;
  readonly prompt: string;
  readonly viewer: AuthenticatedViewer;
}

export interface HousePuzzlePublication {
  readonly id: string;
  readonly prompt: string;
  readonly positionFen: string;
  readonly contributorName: string;
  readonly publishedAt: Date;
}

export interface PublishHousePuzzleDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly puzzles: {
    publish(
      context: AuthorizationContext,
      input: {
        candidateId: string;
        puzzleId: string;
        eventId: string;
        prompt: string;
        now: Date;
      },
    ): Promise<HousePuzzlePublication>;
  };
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

/** [BM-046] A Member's confirmation creates one published House Puzzle. */
export async function publishHousePuzzle(
  request: PublishHousePuzzleRequest,
  dependencies: PublishHousePuzzleDependencies,
): Promise<HousePuzzlePublication> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'write_house_chat_or_game_note' },
    request.houseId,
    request.viewer,
  );
  return dependencies.puzzles.publish(context, {
    candidateId: request.candidateId,
    prompt: request.prompt,
    puzzleId: dependencies.ids.generate(),
    eventId: dependencies.ids.generate(),
    now: dependencies.clock.now(),
  });
}
