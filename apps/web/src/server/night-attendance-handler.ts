import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
  type NightAttendanceJoinResult,
  type NightAttendanceLeaveResult,
  type NightAttendanceRequest,
} from '@between-moves/domain';
import { z } from 'zod';
import { problemResponse as problem } from '../kernel/request';

const identifier = z.string().uuid();

export interface NightAttendanceHandlerDependencies {
  readonly expectedOrigin: string;
  readonly requireViewer: (request: Request) => Promise<AuthenticatedViewer>;
  readonly joinNight: (request: NightAttendanceRequest) => Promise<NightAttendanceJoinResult>;
  readonly leaveNight: (
    request: NightAttendanceRequest,
  ) => Promise<NightAttendanceLeaveResult | null>;
}

function routeProblem(request: Request): Response {
  return problem(request, 422, 'validation_failed', 'Validation failed', 'Night route is invalid.');
}

function attendanceError(request: Request, error: unknown): Response | null {
  if (error instanceof HouseAuthorizationDeniedError) {
    return problem(
      request,
      403,
      'forbidden',
      'Forbidden',
      'Only active House Members can record Night attendance.',
    );
  }
  if (!(error instanceof DomainError)) return null;
  if (error.code === 'not_found') {
    return problem(request, 404, 'not_found', 'Not found', 'Live Night is unavailable.');
  }
  if (error.code === 'conflict') {
    return problem(request, 409, 'attendance_conflict', 'Attendance conflict', error.message);
  }
  if (error.code === 'validation_failed') return routeProblem(request);
  return null;
}

async function authenticate(
  request: Request,
  dependencies: NightAttendanceHandlerDependencies,
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
      'Sign in to join this Between Moves Night.',
    );
  }
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

/** [BM-036] Durable Night join boundary; realtime token issuance remains BM-039. */
export function createJoinNightHandler(dependencies: NightAttendanceHandlerDependencies) {
  return async (request: Request, houseId: string, nightId: string): Promise<Response> => {
    const rejected = preflight(request, houseId, nightId, dependencies.expectedOrigin);
    if (rejected !== null) return rejected;
    const authenticated = await authenticate(request, dependencies);
    if (authenticated instanceof Response) return authenticated;
    try {
      const attendance = await dependencies.joinNight({
        houseId,
        nightId,
        viewer: authenticated,
      });
      return Response.json(
        { attendanceId: attendance.attendanceId },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    } catch (error) {
      const response = attendanceError(request, error);
      if (response !== null) return response;
      throw error;
    }
  };
}

/** [BM-036] Idempotent durable Night leave boundary. */
export function createLeaveNightHandler(dependencies: NightAttendanceHandlerDependencies) {
  return async (request: Request, houseId: string, nightId: string): Promise<Response> => {
    const rejected = preflight(request, houseId, nightId, dependencies.expectedOrigin);
    if (rejected !== null) return rejected;
    const authenticated = await authenticate(request, dependencies);
    if (authenticated instanceof Response) return authenticated;
    try {
      await dependencies.leaveNight({ houseId, nightId, viewer: authenticated });
      return new Response(null, { status: 204 });
    } catch (error) {
      const response = attendanceError(request, error);
      if (response !== null) return response;
      throw error;
    }
  };
}
