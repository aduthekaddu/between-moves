import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  type AssignNightHostRequest,
  type AuthenticatedViewer,
  type NightLifecycleRequest,
  type NightLifecycleResult,
  type NightRsvp,
  type NightRsvpRequest,
} from '@between-moves/domain';
import { z } from 'zod';
import { problemResponse as problem, readJsonBody } from '../kernel/request';

const identifier = z.string().uuid();
const rsvpBody = z.object({ status: z.enum(['going', 'not_going']) }).strict();
const hostBody = z.object({ hostMembershipId: identifier }).strict();

export interface NightLifecycleHandlerDependencies {
  readonly expectedOrigin: string;
  readonly requireViewer: (request: Request) => Promise<AuthenticatedViewer>;
  readonly startNight: (request: NightLifecycleRequest) => Promise<NightLifecycleResult>;
  readonly endNight: (request: NightLifecycleRequest) => Promise<NightLifecycleResult>;
  readonly assignNightHost: (request: AssignNightHostRequest) => Promise<NightLifecycleResult>;
  readonly rsvpNight: (request: NightRsvpRequest) => Promise<NightRsvp>;
}

function routeProblem(request: Request, detail = 'Night route is invalid.') {
  return problem(request, 422, 'validation_failed', 'Validation failed', detail);
}

function lifecycleError(
  request: Request,
  error: unknown,
  forbiddenDetail: string,
): Response | null {
  if (
    error instanceof HouseAuthorizationDeniedError ||
    (error instanceof DomainError && error.code === 'authorization_denied')
  ) {
    return problem(request, 403, 'forbidden', 'Forbidden', forbiddenDetail);
  }
  if (!(error instanceof DomainError)) return null;
  if (error.code === 'not_found') {
    return problem(request, 404, 'not_found', 'Not found', 'Night is unavailable.');
  }
  if (error.code === 'conflict') {
    return problem(request, 409, 'night_conflict', 'Night conflict', error.message);
  }
  if (error.code === 'validation_failed') return routeProblem(request, error.message);
  return null;
}

function preflight(
  request: Request,
  houseId: string,
  nightId: string,
  expectedOrigin: string,
): Response | null {
  if (request.headers.get('origin') !== expectedOrigin) {
    return problem(
      request,
      403,
      'origin_rejected',
      'Origin rejected',
      'Request origin is not allowed.',
    );
  }
  if (!identifier.safeParse(houseId).success || !identifier.safeParse(nightId).success) {
    return routeProblem(request);
  }
  return null;
}

async function authenticate(
  request: Request,
  dependencies: NightLifecycleHandlerDependencies,
): Promise<AuthenticatedViewer | Response> {
  try {
    return await dependencies.requireViewer(request);
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
}

const hostForbidden = 'Only an Owner, Steward, or assigned Night host can start or end this Night.';

function jsonNight(result: NightLifecycleResult): Response {
  return Response.json(result.night, { headers: { 'Cache-Control': 'private, no-store' } });
}

/** [BM-035] HTTP boundary for host-scoped Night start. */
export function createStartNightHandler(dependencies: NightLifecycleHandlerDependencies) {
  return async (request: Request, houseId: string, nightId: string): Promise<Response> => {
    const rejected = preflight(request, houseId, nightId, dependencies.expectedOrigin);
    if (rejected !== null) return rejected;
    const authenticated = await authenticate(request, dependencies);
    if (authenticated instanceof Response) return authenticated;
    try {
      return jsonNight(await dependencies.startNight({ houseId, nightId, viewer: authenticated }));
    } catch (error) {
      const response = lifecycleError(request, error, hostForbidden);
      if (response !== null) return response;
      throw error;
    }
  };
}

/** [BM-035] HTTP boundary for host-scoped Night end. */
export function createEndNightHandler(dependencies: NightLifecycleHandlerDependencies) {
  return async (request: Request, houseId: string, nightId: string): Promise<Response> => {
    const rejected = preflight(request, houseId, nightId, dependencies.expectedOrigin);
    if (rejected !== null) return rejected;
    const authenticated = await authenticate(request, dependencies);
    if (authenticated instanceof Response) return authenticated;
    try {
      return jsonNight(await dependencies.endNight({ houseId, nightId, viewer: authenticated }));
    } catch (error) {
      const response = lifecycleError(request, error, hostForbidden);
      if (response !== null) return response;
      throw error;
    }
  };
}

/** [BM-035] HTTP boundary for temporary Night host assignment. */
export function createAssignNightHostHandler(dependencies: NightLifecycleHandlerDependencies) {
  return async (request: Request, houseId: string, nightId: string): Promise<Response> => {
    const rejected = preflight(request, houseId, nightId, dependencies.expectedOrigin);
    if (rejected !== null) return rejected;
    const authenticated = await authenticate(request, dependencies);
    if (authenticated instanceof Response) return authenticated;
    const body = await readJsonBody(request, 4_096);
    if (body.kind !== 'ok') return routeProblem(request);
    const parsed = hostBody.safeParse(body.value);
    if (!parsed.success) return routeProblem(request, parsed.error.issues[0]?.message);
    try {
      return jsonNight(
        await dependencies.assignNightHost({
          houseId,
          nightId,
          hostMembershipId: parsed.data.hostMembershipId,
          viewer: authenticated,
        }),
      );
    } catch (error) {
      const response = lifecycleError(
        request,
        error,
        'Only an Owner or Steward can assign a Night host.',
      );
      if (response !== null) return response;
      throw error;
    }
  };
}

/** [BM-035] HTTP boundary for Member RSVP. */
export function createRsvpNightHandler(dependencies: NightLifecycleHandlerDependencies) {
  return async (request: Request, houseId: string, nightId: string): Promise<Response> => {
    const rejected = preflight(request, houseId, nightId, dependencies.expectedOrigin);
    if (rejected !== null) return rejected;
    const authenticated = await authenticate(request, dependencies);
    if (authenticated instanceof Response) return authenticated;
    const body = await readJsonBody(request, 4_096);
    if (body.kind !== 'ok') return routeProblem(request);
    const parsed = rsvpBody.safeParse(body.value);
    if (!parsed.success) return routeProblem(request, parsed.error.issues[0]?.message);
    try {
      const rsvp = await dependencies.rsvpNight({
        houseId,
        nightId,
        status: parsed.data.status,
        viewer: authenticated,
      });
      return Response.json(
        { status: rsvp.status, respondedAt: rsvp.respondedAt },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    } catch (error) {
      const response = lifecycleError(
        request,
        error,
        'Only active House Members can RSVP to this Night.',
      );
      if (response !== null) return response;
      throw error;
    }
  };
}
