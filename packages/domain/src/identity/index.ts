/** [BM-007] [DR-ID-01] A request is either anonymous or mapped to one durable user. */
export interface AnonymousViewer {
  readonly kind: 'anonymous';
}

export interface AuthenticatedViewer {
  readonly kind: 'authenticated';
  readonly userId: string;
  readonly displayName: string;
  readonly imageUrl: string | null;
}

export type Viewer = AnonymousViewer | AuthenticatedViewer;

export interface SessionIdentity {
  readonly userId: string;
  readonly displayName: string;
  readonly imageUrl: string | null;
}

/** Framework-generic port; the web composition root supplies Request as its context. */
export interface SessionIdentityReader<RequestContext> {
  read(request: RequestContext): Promise<SessionIdentity | null>;
}

/** [BM-008] [DR-ID-03] Secret-bearing email data exists only at trusted delivery seams. */
export interface MagicLinkEmail {
  readonly email: string;
  readonly signInUrl: string;
}

export interface MagicLinkDeliveryCodec {
  seal(message: MagicLinkEmail): Promise<string>;
  open(sealed: string): Promise<MagicLinkEmail>;
}

export interface MagicLinkOutboxWriter {
  enqueue(event: import('../delivery').NewOutboxEvent): Promise<void>;
}

export type MagicLinkEmailSendResult = 'sent' | 'duplicate';

export interface MagicLinkEmailSender {
  sendMagicLink(
    message: MagicLinkEmail,
    options: { readonly idempotencyKey: string },
  ): Promise<MagicLinkEmailSendResult>;
}

/** [BM-010] [DR-ID-02] Account recovery can target only an active durable identity. */
export interface AccountRecoveryReader {
  hasActiveAccount(email: string): Promise<boolean>;
}

export interface AccountRecoveryResult {
  readonly userId: string;
  readonly revokedSessionCount: number;
}

/** Soft-revokes every pre-recovery session while preserving the newly issued session. */
export interface RecoverySessionRepository {
  revokePriorSessions(
    currentSessionToken: string,
    revokedAt: Date,
  ): Promise<AccountRecoveryResult | null>;
}

/** Best-effort cleanup when a provider session is minted but recovery cannot complete. */
export interface RecoverySessionCleaner {
  revokeSession(sessionToken: string, revokedAt: Date): Promise<void>;
}

/** Revocation metadata is an application-owned check layered over provider validation. */
export interface SessionRevocationReader {
  isSessionActive(sessionId: string): Promise<boolean>;
}

export {
  ACCOUNT_EXPORT_FORMAT,
  ACCOUNT_EXPORT_VERSION,
  AccountDeletionBlockedError,
  FORMER_MEMBER_DISPLAY_NAME,
} from './data-rights';
export type {
  AccountDataRightsDependencies,
  AccountDataRightsRepository,
  AccountDataRightsRequest,
  AccountDeletionInput,
  AccountDeletionResult,
  AccountExport,
  AccountExportGame,
  AccountExportMembership,
  AccountExportMessage,
  AccountExportMove,
  AccountExportNote,
  AccountExportPoints,
  AccountExportProfile,
  AccountExportPuzzle,
  AccountExportReaction,
  AccountExportStanding,
  AccountSummary,
  AccountSummaryHouse,
  OwnedHouse,
} from './data-rights';
