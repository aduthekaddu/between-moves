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

/** [BM-005] Logical Identity module marker retained for module-boundary checks. */
export interface IdentityPorts {
  readonly module: 'identity';
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
