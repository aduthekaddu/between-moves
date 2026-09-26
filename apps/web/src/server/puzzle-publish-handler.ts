import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
} from '@between-moves/domain';
import type { PublishedHousePuzzle } from '@between-moves/db';
import { z } from 'zod';
import { problemResponse as problem, readJsonBody } from '../kernel/request';

const bodySchema = z
  .object({
    candidateId: z.uuid(),
    prompt: z.string().trim().min(1).max(280),
    positionConfirmed: z.literal(true),
  })
  .strict();

export interface PuzzlePublishHandlerDependencies {
  readonly expectedOrigin: string;
  readonly requireViewer: (request: Request) => Promise<AuthenticatedViewer>;
  readonly publish: (
    request: Request,
    houseId: string,
    input: { candidateId: string; prompt: string },
  ) => Promise<PublishedHousePuzzle>;
  readonly recordPublished: (input: { houseId: string; puzzleId: string; actorId: string }) => void;
}

/** [BM-046] POST /api/houses/{houseId}/puzzles. */
export function createPuzzlePublishHandler(dependencies: PuzzlePublishHandlerDependencies) {
  return async (request: Request, houseId: string): Promise<Response> => {
    if (request.headers.get('origin') !== dependencies.expectedOrigin) {
      return problem(
        request,
        403,
        'origin_rejected',
        'Origin rejected',
        'Request origin is not allowed.',
      );
    }
    if (!z.uuid().safeParse(houseId).success) {
      return problem(
        request,
        422,
        'validation_failed',
        'Validation failed',
        'House route is invalid.',
      );
    }
    let viewer: AuthenticatedViewer;
    try {
      viewer = await dependencies.requireViewer(request);
    } catch (error) {
      if (!(error instanceof AuthenticationRequiredError)) throw error;
      return problem(
        request,
        401,
        'unauthenticated',
        'Authentication required',
        'Sign in to publish a House Puzzle.',
      );
    }
    const body = await readJsonBody(request, 4096);
    if (body.kind === 'too_large')
      return problem(
        request,
        413,
        'payload_too_large',
        'Payload too large',
        'Puzzle details are too large.',
      );
    const parsed = body.kind === 'ok' ? bodySchema.safeParse(body.value) : null;
    if (!parsed?.success) {
      return problem(
        request,
        422,
        'validation_failed',
        'Validation failed',
        'Confirm the position and add a prompt of 1–280 characters.',
      );
    }
    try {
      const puzzle = await dependencies.publish(request, houseId, parsed.data);
      try {
        dependencies.recordPublished({ houseId, puzzleId: puzzle.id, actorId: viewer.userId });
      } catch {
        /* A committed puzzle remains published. */
      }
      return Response.json(
        {
          id: puzzle.id,
          prompt: puzzle.prompt,
          positionFen: puzzle.positionFen,
          contributorName: puzzle.contributorName,
          publishedAt: puzzle.publishedAt.toISOString(),
        },
        { status: 201, headers: { 'Cache-Control': 'private, no-store' } },
      );
    } catch (error) {
      if (error instanceof HouseAuthorizationDeniedError)
        return problem(
          request,
          403,
          'forbidden',
          'Forbidden',
          'Only active House Members can publish puzzles.',
        );
      if (error instanceof DomainError && error.code === 'not_found')
        return problem(request, 404, 'not_found', 'Not found', 'Puzzle candidate is unavailable.');
      throw error;
    }
  };
}
