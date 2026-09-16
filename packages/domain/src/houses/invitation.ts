import type { AuthenticatedViewer } from '../identity';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { Clock } from '../shared/clock';
import { DomainError } from '../shared/errors';
import type { AuthorizeHouseAction } from './authorization';
import type { IdGenerator } from './house';
import type { InvitationEmailDeliveryCodec, NewOutboxEvent } from '../delivery';

const SHARED_INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;

export interface SharedInvitationCommand {
  readonly kind: 'shared';
}

export interface SingleInvitationCommand {
  readonly kind: 'single';
  readonly intendedEmail: string;
}

export type CreateInvitationCommand = SharedInvitationCommand | SingleInvitationCommand;

export interface InvitationToken {
  readonly raw: string;
  readonly digestHex: string;
}

export type InvitationTokenIssueRequest =
  { readonly kind: 'random' } | { readonly kind: 'idempotent'; readonly scope: string };

export interface InvitationTokenIssuer {
  issue(request: InvitationTokenIssueRequest): InvitationToken;
}

export interface InvitationTokenDigester {
  digest(rawToken: string): string | null;
}

export interface InvitationCreationInput {
  readonly invitationId: string;
  readonly auditId: string;
  readonly command: CreateInvitationCommand;
  readonly tokenDigestHex: string;
  readonly createdAt: Date;
  readonly deliveryEvent: NewOutboxEvent | null;
}

export interface PersistedInvitationCreation {
  readonly invitationId: string;
  readonly houseId: string;
  readonly expiresAt: Date;
  readonly useLimit: number;
}

export interface InvitationCreationResult extends PersistedInvitationCreation {
  readonly token: string;
}

export interface InvitationCreationRepository {
  create(
    context: AuthorizationContext,
    input: InvitationCreationInput,
  ): Promise<PersistedInvitationCreation>;
}

export interface CreateInvitationRequest {
  readonly houseId: string;
  readonly command: CreateInvitationCommand;
  readonly idempotencyKey: string | null;
  readonly viewer: AuthenticatedViewer;
}

export interface InvitationCreationDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly tokens: InvitationTokenIssuer;
  readonly invitations: InvitationCreationRepository;
  readonly invitationEmail: {
    readonly codec: InvitationEmailDeliveryCodec;
    readonly buildUrl: (rawToken: string) => string;
  };
}

export interface RevokeInvitationRequest {
  readonly houseId: string;
  readonly invitationId: string;
  readonly viewer: AuthenticatedViewer;
}

export interface InvitationRevocationInput {
  readonly invitationId: string;
  readonly auditId: string;
  readonly revokedAt: Date;
}

export interface InvitationRevocationResult {
  readonly revokedNow: boolean;
}

export interface InvitationRevocationRepository {
  revoke(
    context: AuthorizationContext,
    input: InvitationRevocationInput,
  ): Promise<InvitationRevocationResult>;
}

export interface InvitationRevocationDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly invitations: InvitationRevocationRepository;
}

export interface InvitationPreview {
  readonly houseName: string;
}

export interface InvitationInspectionInput {
  readonly tokenDigestHex: string;
  readonly inspectedAt: Date;
}

export interface InvitationInspectionRepository {
  inspect(input: InvitationInspectionInput): Promise<InvitationPreview | null>;
}

export interface InspectInvitationRequest {
  readonly token: string;
}

export interface InvitationInspectionDependencies {
  readonly clock: Clock;
  readonly tokens: InvitationTokenDigester;
  readonly invitations: InvitationInspectionRepository;
}

export interface InvitationCreationPolicyContext {
  readonly activeMemberCount: number;
  readonly memberCap: number;
  readonly createdAt: Date;
}

interface InvitationCreationPolicyBase {
  readonly expiresAt: Date;
  readonly useLimit: number;
}

export type InvitationCreationPolicy =
  | (InvitationCreationPolicyBase & { readonly kind: 'shared'; readonly intendedEmail: null })
  | (InvitationCreationPolicyBase & { readonly kind: 'single'; readonly intendedEmail: string });

/** [BM-014] [DR-INVITE-04] Derive server-owned shared Invitation limits. */
export function invitationCreationPolicy(
  command: CreateInvitationCommand,
  context: InvitationCreationPolicyContext,
): InvitationCreationPolicy {
  const expiresAt = new Date(context.createdAt.getTime() + SHARED_INVITATION_LIFETIME_MS);
  if (command.kind === 'single') {
    const intendedEmail = command.intendedEmail.trim().toLowerCase();
    if (intendedEmail.length === 0) {
      throw new DomainError('validation_failed', 'Restricted Invitation email is required');
    }
    return { kind: command.kind, intendedEmail, expiresAt, useLimit: 1 };
  }

  const useLimit = context.memberCap - context.activeMemberCount;
  if (useLimit < 1) throw new DomainError('conflict', 'House is at capacity');
  return { kind: command.kind, intendedEmail: null, expiresAt, useLimit };
}
