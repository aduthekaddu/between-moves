import type { AuthenticatedViewer } from '../identity';
import type { Clock } from '../shared/clock';
import type { IdGenerator } from './house';
import type { InvitationTokenDigester } from './invitation';

export interface RedeemInvitationRequest {
  readonly token: string;
  readonly viewer: AuthenticatedViewer;
}

export interface InvitationRedemptionInput {
  readonly tokenDigestHex: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly auditId: string;
  readonly redeemedAt: Date;
}

export interface InvitationRedemptionResult {
  readonly houseId: string;
  readonly membershipId: string;
  readonly inviteKind: 'shared' | 'email';
  readonly reactivated: boolean;
}

export interface InvitationRedemptionRepository {
  redeem(input: InvitationRedemptionInput): Promise<InvitationRedemptionResult>;
}

export interface InvitationRedemptionDependencies {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly tokens: InvitationTokenDigester;
  readonly invitations: InvitationRedemptionRepository;
}

export type InvitationRedemptionFailure = 'invalid' | 'house_full';

export class InvitationRedemptionError extends Error {
  override readonly name = 'InvitationRedemptionError';

  constructor(readonly failure: InvitationRedemptionFailure) {
    super(failure === 'house_full' ? 'House is full' : 'Invitation is unavailable');
  }
}
