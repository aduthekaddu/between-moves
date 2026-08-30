import { SecureInvitationTokenIssuer, SystemClock, generateUuidV7 } from '@between-moves/adapters';
import {
  createAuthorizeHouseAction,
  createInvitation as createInvitationUseCase,
  inspectInvitation as inspectInvitationUseCase,
  revokeInvitation as revokeInvitationUseCase,
} from '@between-moves/application';
import {
  PgHouseAuthorizationMembershipRepository,
  PgInvitationRepository,
} from '@between-moves/db';
import type {
  CreateInvitationRequest,
  InspectInvitationRequest,
  InvitationCreationResult,
  InvitationPreview,
  InvitationRevocationResult,
  RevokeInvitationRequest,
} from '@between-moves/domain';
import { createHouseAuthorizationMetricStubs } from '@between-moves/observability';
import { getConfig } from '../config';
import { createHouseAuthorizationDenialRecorder } from './house-authorization-observability';
import { getDatabase } from './database';
import { getLogger } from './logger';

const clock = new SystemClock();
const authorizationMetrics = createHouseAuthorizationMetricStubs();

function invitationTokens(): SecureInvitationTokenIssuer {
  return new SecureInvitationTokenIssuer(getConfig().betterAuthSecret);
}

function invitationDependencies(requestId: string) {
  const database = getDatabase().pool;
  return {
    authorizeHouseAction: createAuthorizeHouseAction({
      memberships: new PgHouseAuthorizationMembershipRepository(database),
      nightHosts: { isAssignedNightHost: async () => false },
      denials: createHouseAuthorizationDenialRecorder({
        logger: getLogger(),
        metrics: authorizationMetrics,
        requestId,
      }),
    }),
    clock,
    ids: { generate: () => generateUuidV7() },
    tokens: invitationTokens(),
    invitations: new PgInvitationRepository(database),
  };
}

/** [BM-014] Web composition for Invitation creation. */
export function createHouseInvitation(
  request: CreateInvitationRequest,
  requestId: string,
): Promise<InvitationCreationResult> {
  return createInvitationUseCase(request, invitationDependencies(requestId));
}

/** [BM-014] Web composition for Invitation revocation. */
export function revokeHouseInvitation(
  request: RevokeInvitationRequest,
  requestId: string,
): Promise<InvitationRevocationResult> {
  return revokeInvitationUseCase(request, invitationDependencies(requestId));
}

/** [BM-014] Web composition for digest-only Invitation inspection. */
export function inspectHouseInvitation(
  request: InspectInvitationRequest,
): Promise<InvitationPreview | null> {
  const database = getDatabase().pool;
  return inspectInvitationUseCase(request, {
    clock,
    tokens: invitationTokens(),
    invitations: new PgInvitationRepository(database),
  });
}
