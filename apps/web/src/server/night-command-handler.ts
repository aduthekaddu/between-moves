import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
  type ChangeNightScheduleRequest,
  type NightChangeResult,
} from '@between-moves/domain';
import { z } from 'zod';
import { problemResponse as problem, readJsonBody } from '../kernel/request';

const identifier = z.string().uuid();
const changeBody = z.union([
  z.object({ state: z.literal('cancelled') }).strict(),
  z
    .object({ scheduledStart: z.iso.datetime(), scheduledEnd: z.iso.datetime() })
    .strict()
    .refine((value) => Date.parse(value.scheduledEnd) > Date.parse(value.scheduledStart), {
      message: 'Night end must be after its start.',
      path: ['scheduledEnd'],
    }),
]);

export interface NightCommandHandlerDependencies {
  readonly expectedOrigin: string;
  readonly requireViewer: (request: Request) => Promise<AuthenticatedViewer>;
  readonly changeNightSchedule: (request: ChangeNightScheduleRequest) => Promise<NightChangeResult>;
}

function validationProblem(request: Request, detail = 'Night schedule details are invalid.') {
  return problem(request, 422, 'validation_failed', 'Validation failed', detail);
}

function commandError(request: Request, error: unknown): Response | null {
  if (
    error instanceof HouseAuthorizationDeniedError ||
    (error instanceof DomainError && error.code === 'authorization_denied')
  ) {
    return problem(
      request,
      403,
      'forbidden',
      'Forbidden',
      'Only an Owner or Steward can change a Between Moves Night.',
    );
  }
  if (!(error instanceof DomainError)) return null;
  if (error.code === 'not_found') {
    return problem(request, 404, 'not_found', 'Not found', 'Night is unavailable.');
  }
  if (error.code === 'conflict') {
    return problem(request, 409, 'night_conflict', 'Night conflict', error.message);
  }
  if (error.code === 'validation_failed') return validationProblem(request, error.message);
  return null;
}

/** [BM-020] HTTP boundary for Owner/Steward Night reschedule and cancellation. */
export function createChangeNightScheduleHandler(dependencies: NightCommandHandlerDependencies) {
  return async (request: Request, houseId: string, nightId: string): Promise<Response> => {
    if (request.headers.get('origin') !== dependencies.expectedOrigin) {
      return problem(
        request,
        403,
        'origin_rejected',
        'Origin rejected',
        'Request origin is not allowed.',
      );
    }
    if (!identifier.safeParse(houseId).success || !identifier.safeParse(nightId).success) {
      return validationProblem(request, 'Night route is invalid.');
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
        'Sign in to manage this Night.',
      );
    }
    const body = await readJsonBody(request, 4_096);
    if (body.kind !== 'ok') return validationProblem(request);
    const parsed = changeBody.safeParse(body.value);
    if (!parsed.success) return validationProblem(request, parsed.error.issues[0]?.message);
    const command =
      'state' in parsed.data
        ? ({ kind: 'cancel' } as const)
        : ({
            kind: 'reschedule',
            scheduledStart: new Date(parsed.data.scheduledStart),
            scheduledEnd: new Date(parsed.data.scheduledEnd),
          } as const);
    try {
      const result = await dependencies.changeNightSchedule({
        houseId,
        nightId,
        command,
        viewer,
      });
      return Response.json(result.night, {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    } catch (error) {
      const response = commandError(request, error);
      if (response !== null) return response;
      throw error;
    }
  };
}
