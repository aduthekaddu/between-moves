import type { CreateHouseCommand, HouseCreationResult } from '@between-moves/domain';
import {
  AuthenticationRequiredError,
  DomainError,
  type AuthenticatedViewer,
} from '@between-moves/domain';
import type { StructuredLogger } from '@between-moves/observability';
import { z } from 'zod';

const bodySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    timeZone: z.string().trim().min(1),
    description: z.string().max(500).optional(),
  })
  .strict();

export interface HouseRequestHandlerDependencies {
  readonly expectedOrigin: string;
  readonly requireViewer: (request: Request) => Promise<AuthenticatedViewer>;
  readonly createHouse: (
    command: CreateHouseCommand,
    viewer: AuthenticatedViewer,
  ) => Promise<HouseCreationResult>;
  readonly logger: StructuredLogger;
  readonly clock: { now(): Date };
}

function problem(request: Request, status: number, code: string, title: string, detail: string) {
  return Response.json(
    {
      type: `https://betweenmoves.app/problems/${code}`,
      title,
      status,
      code,
      detail,
      instance: new URL(request.url).pathname,
    },
    {
      status,
      headers: { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/problem+json' },
    },
  );
}

function validationProblem(request: Request, detail = 'House details are invalid.') {
  return problem(request, 422, 'validation_failed', 'Validation failed', detail);
}

/** [BM-011] [PR-JRN-01] Authenticated, origin-checked House creation request seam. */
export function createHouseRequestHandler(dependencies: HouseRequestHandlerDependencies) {
  return async (request: Request): Promise<Response> => {
    const startedAt = dependencies.clock.now();
    if (request.headers.get('origin') !== dependencies.expectedOrigin) {
      return problem(
        request,
        403,
        'origin_rejected',
        'Origin rejected',
        'Request origin is not allowed.',
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
        'Sign in to create a House.',
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return validationProblem(request);
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return validationProblem(request);

    const command: CreateHouseCommand =
      parsed.data.description === undefined
        ? { name: parsed.data.name, timeZone: parsed.data.timeZone }
        : {
            name: parsed.data.name,
            timeZone: parsed.data.timeZone,
            description: parsed.data.description,
          };
    let result: HouseCreationResult;
    try {
      result = await dependencies.createHouse(command, viewer);
    } catch (error) {
      if (error instanceof DomainError && error.code === 'validation_failed') {
        return validationProblem(request, error.message);
      }
      throw error;
    }

    dependencies.logger.log({
      level: 'info',
      requestId: request.headers.get('x-request-id') ?? crypto.randomUUID(),
      actorId: viewer.userId,
      houseId: result.houseId,
      gameId: null,
      commandId: null,
      event: 'bm.house.created',
      outcome: 'success',
      durationMs: Math.max(0, dependencies.clock.now().getTime() - startedAt.getTime()),
      data: { owner_membership_id: result.ownerMembershipId },
    });

    return Response.json(
      { houseId: result.houseId, slug: result.slug },
      { status: 201, headers: { 'Cache-Control': 'private, no-store' } },
    );
  };
}
