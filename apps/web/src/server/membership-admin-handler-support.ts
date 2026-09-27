import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
  type ChangeMembershipRoleRequest,
  type LeaveHouseRequest,
  type MembershipLeaveResult,
  type MembershipRemovalResult,
  type MembershipRoleChangeResult,
  type OwnershipTransferResult,
  type RemoveHouseMemberRequest,
  type TransferHouseOwnershipRequest,
} from '@between-moves/domain';
import {
  membershipRoleChangeBodySchema,
  ownershipTransferBodySchema,
} from '@between-moves/contracts';
import type { StructuredLogger } from '@between-moves/observability';
import { z } from 'zod';
import { problemResponse as problem, readJsonBody, readRequestId } from '../kernel/request';

export const identifierSchema = z.string().uuid();
export const roleBodySchema = membershipRoleChangeBodySchema;
export const transferBodySchema = ownershipTransferBodySchema;
export const idempotencyKeySchema = z.string().trim().min(1).max(128);
const MAXIMUM_BODY_BYTES = 4_096;

export interface MembershipAdminHandlerDependencies {
  readonly expectedOrigin: string;
  readonly requireViewer: (request: Request) => Promise<AuthenticatedViewer>;
  readonly changeRole: (
    request: ChangeMembershipRoleRequest,
  ) => Promise<MembershipRoleChangeResult>;
  readonly removeMember: (request: RemoveHouseMemberRequest) => Promise<MembershipRemovalResult>;
  readonly leaveHouse: (request: LeaveHouseRequest) => Promise<MembershipLeaveResult>;
  readonly transferOwnership: (
    request: TransferHouseOwnershipRequest,
  ) => Promise<OwnershipTransferResult>;
  readonly logger: StructuredLogger;
  readonly clock: { now(): Date };
}

export type ViewerResolution =
  | { readonly kind: 'authenticated'; readonly viewer: AuthenticatedViewer }
  | { readonly kind: 'response'; readonly response: Response };

export async function resolveViewer(
  dependencies: MembershipAdminHandlerDependencies,
  request: Request,
  houseId: string,
): Promise<ViewerResolution> {
  if (!identifierSchema.safeParse(houseId).success) {
    return {
      kind: 'response',
      response: problem(
        request,
        422,
        'validation_failed',
        'Validation failed',
        'House ID is invalid.',
      ),
    };
  }
  if (request.headers.get('origin') !== dependencies.expectedOrigin) {
    return {
      kind: 'response',
      response: problem(
        request,
        403,
        'origin_rejected',
        'Origin rejected',
        'Request origin is not allowed.',
      ),
    };
  }
  try {
    return { kind: 'authenticated', viewer: await dependencies.requireViewer(request) };
  } catch (error) {
    if (!(error instanceof AuthenticationRequiredError)) throw error;
    return {
      kind: 'response',
      response: problem(
        request,
        401,
        'unauthenticated',
        'Authentication required',
        'Sign in to administer this House.',
      ),
    };
  }
}

export function commandError(request: Request, error: unknown): Response | null {
  if (error instanceof HouseAuthorizationDeniedError) {
    return problem(request, 403, 'forbidden', 'Forbidden', 'This House command is not allowed.');
  }
  if (!(error instanceof DomainError)) return null;
  switch (error.code) {
    case 'authorization_denied':
      return problem(request, 403, 'forbidden', 'Forbidden', 'This House command is not allowed.');
    case 'not_found':
      return problem(request, 404, 'not_found', 'Not found', 'Membership is unavailable.');
    case 'validation_failed':
      return problem(request, 422, error.code, 'Validation failed', error.message);
    case 'idempotency_conflict':
      return problem(request, 409, error.code, 'Idempotency conflict', error.message);
    case 'unauthenticated':
    case 'conflict':
    case 'move_conflict':
      return null;
    default: {
      const _exhaustive: never = error.code;
      return _exhaustive;
    }
  }
}

export function logSuccess(
  dependencies: MembershipAdminHandlerDependencies,
  request: Request,
  input: {
    readonly houseId: string;
    readonly actorId: string;
    readonly event: string;
    readonly targetMembershipId: string;
    readonly startedAt: Date;
    readonly changed: boolean;
    readonly invalidatedSessionCount: number;
  },
): void {
  dependencies.logger.log({
    level: 'info',
    requestId: readRequestId(request),
    actorId: input.actorId,
    houseId: input.houseId,
    gameId: null,
    commandId: null,
    event: input.event,
    outcome: 'success',
    durationMs: Math.max(0, dependencies.clock.now().getTime() - input.startedAt.getTime()),
    data: {
      target_membership_id: input.targetMembershipId,
      changed: input.changed,
      invalidated_session_count: input.invalidatedSessionCount,
    },
  });
}

export async function parseBody(request: Request): Promise<unknown | Response> {
  const body = await readJsonBody(request, MAXIMUM_BODY_BYTES);
  if (body.kind === 'too_large') {
    return problem(
      request,
      413,
      'payload_too_large',
      'Payload too large',
      'Command details are too large.',
    );
  }
  if (body.kind === 'invalid') {
    return problem(
      request,
      422,
      'validation_failed',
      'Validation failed',
      'Command details are invalid.',
    );
  }
  return body.value;
}
