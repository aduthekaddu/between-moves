import { problemResponse as problem } from '../kernel/request';
import {
  commandError,
  idempotencyKeySchema,
  identifierSchema,
  logSuccess,
  parseBody,
  resolveViewer,
  roleBodySchema,
  transferBodySchema,
  type MembershipAdminHandlerDependencies,
} from './membership-admin-handler-support';

export type { MembershipAdminHandlerDependencies } from './membership-admin-handler-support';

/** [BM-015] Owner-only permanent role change HTTP seam. */
export function createChangeMembershipRoleHandler(
  dependencies: MembershipAdminHandlerDependencies,
) {
  return async (request: Request, houseId: string, targetMembershipId: string) => {
    const startedAt = dependencies.clock.now();
    const resolved = await resolveViewer(dependencies, request, houseId);
    if (resolved.kind === 'response') return resolved.response;
    if (!identifierSchema.safeParse(targetMembershipId).success) {
      return problem(
        request,
        422,
        'validation_failed',
        'Validation failed',
        'Membership ID is invalid.',
      );
    }
    const body = await parseBody(request);
    if (body instanceof Response) return body;
    const parsed = roleBodySchema.safeParse(body);
    if (!parsed.success) {
      return problem(request, 422, 'validation_failed', 'Validation failed', 'Role is invalid.');
    }
    try {
      const result = await dependencies.changeRole({
        houseId,
        targetMembershipId,
        role: parsed.data.role,
        viewer: resolved.viewer,
      });
      logSuccess(dependencies, request, {
        houseId,
        actorId: resolved.viewer.userId,
        event: 'house.membership-role-changed',
        targetMembershipId,
        startedAt,
        changed: result.changed,
        invalidatedSessionCount: result.invalidatedSessionCount,
      });
      return Response.json(
        { membershipId: result.membershipId, role: result.role },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    } catch (error) {
      const response = commandError(request, error);
      if (response !== null) return response;
      throw error;
    }
  };
}

/** [BM-015] Target-aware Member removal HTTP seam. */
export function createRemoveHouseMemberHandler(dependencies: MembershipAdminHandlerDependencies) {
  return async (request: Request, houseId: string, targetMembershipId: string) => {
    const startedAt = dependencies.clock.now();
    const resolved = await resolveViewer(dependencies, request, houseId);
    if (resolved.kind === 'response') return resolved.response;
    if (!identifierSchema.safeParse(targetMembershipId).success) {
      return problem(
        request,
        422,
        'validation_failed',
        'Validation failed',
        'Membership ID is invalid.',
      );
    }
    try {
      const result = await dependencies.removeMember({
        houseId,
        targetMembershipId,
        viewer: resolved.viewer,
      });
      logSuccess(dependencies, request, {
        houseId,
        actorId: resolved.viewer.userId,
        event: 'house.member-removed',
        targetMembershipId,
        startedAt,
        changed: result.removedNow,
        invalidatedSessionCount: result.invalidatedSessionCount,
      });
      return new Response(null, {
        status: 204,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    } catch (error) {
      const response = commandError(request, error);
      if (response !== null) return response;
      throw error;
    }
  };
}

/** [BM-015] Self-service House departure HTTP seam with transactional Owner guard. */
export function createLeaveHouseHandler(dependencies: MembershipAdminHandlerDependencies) {
  return async (request: Request, houseId: string) => {
    const startedAt = dependencies.clock.now();
    const resolved = await resolveViewer(dependencies, request, houseId);
    if (resolved.kind === 'response') return resolved.response;
    try {
      const result = await dependencies.leaveHouse({ houseId, viewer: resolved.viewer });
      logSuccess(dependencies, request, {
        houseId,
        actorId: resolved.viewer.userId,
        event: 'house.membership-left',
        targetMembershipId: result.membershipId,
        startedAt,
        changed: result.leftNow,
        invalidatedSessionCount: 0,
      });
      return new Response(null, {
        status: 204,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    } catch (error) {
      const response = commandError(request, error);
      if (response !== null) return response;
      throw error;
    }
  };
}

/** [BM-015] Idempotent sole-Owner transfer HTTP seam. */
export function createTransferHouseOwnershipHandler(
  dependencies: MembershipAdminHandlerDependencies,
) {
  return async (request: Request, houseId: string) => {
    const startedAt = dependencies.clock.now();
    const resolved = await resolveViewer(dependencies, request, houseId);
    if (resolved.kind === 'response') return resolved.response;
    const body = await parseBody(request);
    if (body instanceof Response) return body;
    const parsed = transferBodySchema.safeParse(body);
    const idempotencyKey = idempotencyKeySchema.safeParse(request.headers.get('idempotency-key'));
    if (!parsed.success || !idempotencyKey.success) {
      return problem(
        request,
        422,
        'validation_failed',
        'Validation failed',
        'Transfer details are invalid.',
      );
    }
    try {
      const result = await dependencies.transferOwnership({
        houseId,
        targetMembershipId: parsed.data.toMembershipId,
        idempotencyKey: idempotencyKey.data,
        viewer: resolved.viewer,
      });
      logSuccess(dependencies, request, {
        houseId,
        actorId: resolved.viewer.userId,
        event: 'house.ownership-transferred',
        targetMembershipId: result.ownerMembershipId,
        startedAt,
        changed: result.changed,
        invalidatedSessionCount: result.invalidatedSessionCount,
      });
      return Response.json(
        { ownerMembershipId: result.ownerMembershipId },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    } catch (error) {
      const response = commandError(request, error);
      if (response !== null) return response;
      throw error;
    }
  };
}
