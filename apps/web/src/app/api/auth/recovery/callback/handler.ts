import type { AccountRecoveryResult } from '@between-moves/domain';

export interface VerifiedRecoverySession {
  readonly sessionToken: string;
  readonly cookies: readonly string[];
}

export interface RecoveryCallbackHandlerDependencies {
  readonly isExpectedPurpose: (token: string, proof: string | null) => boolean;
  readonly verifyMagicLink: (
    token: string,
    headers: Headers,
  ) => Promise<VerifiedRecoverySession | null>;
  readonly completeRecovery: (sessionToken: string) => Promise<AccountRecoveryResult>;
  readonly discardRecoverySession: (sessionToken: string) => Promise<void>;
  readonly onCompleted: (result: AccountRecoveryResult) => void;
  readonly onFailed: () => void;
}

function redirect(request: Request, pathname: string, cookies: readonly string[] = []): Response {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    Location: new URL(pathname, request.url).toString(),
  });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
}

/** [BM-010] [DR-ID-02] Revokes prior sessions before exposing the recovered session cookie. */
export function createRecoveryCallbackHandler(
  dependencies: RecoveryCallbackHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    const proof = url.searchParams.get('proof');
    if (!token || !dependencies.isExpectedPurpose(token, proof)) {
      dependencies.onFailed();
      return redirect(request, '/auth/link-invalid');
    }

    let recoveredSessionToken: string | undefined;
    try {
      const verified = await dependencies.verifyMagicLink(token, request.headers);
      if (!verified) {
        dependencies.onFailed();
        return redirect(request, '/auth/link-invalid');
      }
      recoveredSessionToken = verified.sessionToken;
      const result = await dependencies.completeRecovery(verified.sessionToken);
      dependencies.onCompleted(result);
      return redirect(request, '/', verified.cookies);
    } catch {
      if (recoveredSessionToken) {
        await dependencies.discardRecoverySession(recoveredSessionToken).catch(() => undefined);
      }
      dependencies.onFailed();
      return redirect(request, '/auth/link-invalid');
    }
  };
}
