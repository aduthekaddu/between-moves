import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
} from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  createChangeMembershipRoleHandler,
  createLeaveHouseHandler,
  createRemoveHouseMemberHandler,
  createTransferHouseOwnershipHandler,
  type MembershipAdminHandlerDependencies,
} from './membership-admin-handler';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const targetMembershipId = '01941f29-7c00-7000-8000-000000000202';
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};

function dependencies(
  overrides: Partial<MembershipAdminHandlerDependencies> = {},
): MembershipAdminHandlerDependencies {
  return {
    expectedOrigin: 'https://between-moves.example.test',
    requireViewer: vi.fn(async () => viewer),
    changeRole: vi.fn(async (request) => ({
      membershipId: request.targetMembershipId,
      role: request.role,
      changed: true,
      invalidatedSessionCount: 2,
    })),
    removeMember: vi.fn(async (request) => ({
      membershipId: request.targetMembershipId,
      removedNow: true,
      invalidatedSessionCount: 1,
    })),
    leaveHouse: vi.fn(async () => ({ membershipId: targetMembershipId, leftNow: true })),
    transferOwnership: vi.fn(async (request) => ({
      previousOwnerMembershipId: '01941f29-7c00-7000-8000-000000000203',
      ownerMembershipId: request.targetMembershipId,
      changed: true,
      invalidatedSessionCount: 3,
    })),
    logger: { log: vi.fn() },
    clock: { now: () => new Date('2026-08-30T17:00:00.000Z') },
    ...overrides,
  };
}

function post(path: string, body?: unknown, headers: Record<string, string> = {}): Request {
  const requestHeaders = {
    origin: 'https://between-moves.example.test',
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    ...headers,
  };
  const init: RequestInit =
    body === undefined
      ? {
          method: 'POST',
          headers: requestHeaders,
        }
      : {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify(body),
        };
  return new Request(`https://between-moves.example.test${path}`, init);
}

describe('BM-015 membership administration request seam', () => {
  it('[BM-015] parses an Owner role change and returns the canonical role', async () => {
    const deps = dependencies();
    const response = await createChangeMembershipRoleHandler(deps)(
      post(`/api/houses/${houseId}/members/${targetMembershipId}/role`, { role: 'steward' }),
      houseId,
      targetMembershipId,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      membershipId: targetMembershipId,
      role: 'steward',
    });
    expect(deps.changeRole).toHaveBeenCalledWith({
      houseId,
      targetMembershipId,
      role: 'steward',
      viewer,
    });
    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: viewer.userId,
        houseId,
        event: 'house.membership-role-changed',
        data: expect.objectContaining({ invalidated_session_count: 2 }),
      }),
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('[BM-015] [DR-PERM-03] maps protected-member removal denial to a non-leaking 403', async () => {
    const deps = dependencies({
      removeMember: vi.fn(async () => {
        throw new HouseAuthorizationDeniedError('protected_member', false);
      }),
    });
    const response = await createRemoveHouseMemberHandler(deps)(
      post(`/api/houses/${houseId}/members/${targetMembershipId}/remove`),
      houseId,
      targetMembershipId,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'forbidden' });
  });

  it('[BM-015] [PR-COPY-18] returns the Owner leave guard copy', async () => {
    const deps = dependencies({
      leaveHouse: vi.fn(async () => {
        throw new DomainError(
          'validation_failed',
          'Transfer ownership before you leave this House.',
        );
      }),
    });
    const response = await createLeaveHouseHandler(deps)(
      post(`/api/houses/${houseId}/leave`),
      houseId,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: 'validation_failed',
      detail: 'Transfer ownership before you leave this House.',
    });
  });

  it('[BM-015] requires a bounded idempotency key for ownership transfer', async () => {
    const deps = dependencies();
    const missing = await createTransferHouseOwnershipHandler(deps)(
      post(`/api/houses/${houseId}/transfer`, { toMembershipId: targetMembershipId }),
      houseId,
    );
    const accepted = await createTransferHouseOwnershipHandler(deps)(
      post(
        `/api/houses/${houseId}/transfer`,
        { toMembershipId: targetMembershipId },
        { 'idempotency-key': 'transfer-1' },
      ),
      houseId,
    );

    expect(missing.status).toBe(422);
    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toEqual({ ownerMembershipId: targetMembershipId });
    expect(deps.transferOwnership).toHaveBeenCalledWith({
      houseId,
      targetMembershipId,
      idempotencyKey: 'transfer-1',
      viewer,
    });
  });

  it('[BM-015] maps ownership-transfer idempotency conflicts to HTTP 409', async () => {
    const deps = dependencies({
      transferOwnership: vi.fn(async () => {
        throw new DomainError(
          'idempotency_conflict',
          'Idempotency key was reused for another ownership transfer',
        );
      }),
    });
    const response = await createTransferHouseOwnershipHandler(deps)(
      post(
        `/api/houses/${houseId}/transfer`,
        { toMembershipId: targetMembershipId },
        { 'idempotency-key': 'transfer-1' },
      ),
      houseId,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('[BM-015] rejects an unexpected origin before resolving a viewer', async () => {
    const deps = dependencies();
    const request = post(`/api/houses/${houseId}/leave`);
    request.headers.set('origin', 'https://attacker.example.test');
    const response = await createLeaveHouseHandler(deps)(request, houseId);

    expect(response.status).toBe(403);
    expect(deps.requireViewer).not.toHaveBeenCalled();
  });

  it('[BM-015] maps missing authentication before invoking a command', async () => {
    const deps = dependencies({
      requireViewer: vi.fn(async () => {
        throw new AuthenticationRequiredError();
      }),
    });
    const response = await createLeaveHouseHandler(deps)(
      post(`/api/houses/${houseId}/leave`),
      houseId,
    );

    expect(response.status).toBe(401);
    expect(deps.leaveHouse).not.toHaveBeenCalled();
  });

  it('[BM-015] replaces an untrusted request ID before structured logging', async () => {
    const deps = dependencies();
    const untrustedRequestId = 'a'.repeat(129);
    const response = await createLeaveHouseHandler(deps)(
      post(`/api/houses/${houseId}/leave`, undefined, {
        'x-request-id': untrustedRequestId,
      }),
      houseId,
    );

    expect(response.status).toBe(204);
    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: expect.not.stringContaining(untrustedRequestId) }),
    );
  });
});
