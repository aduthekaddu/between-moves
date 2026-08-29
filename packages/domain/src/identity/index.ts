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
