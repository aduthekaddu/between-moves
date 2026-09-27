import { SystemClock, generateUuidV7 } from '@between-moves/adapters';
import {
  createDeleteAccount,
  createExportAccountData,
  createReadAccountSummary,
} from '@between-moves/application';
import { accountDeletionBodySchema, ACCOUNT_DELETION_CONFIRMATION } from '@between-moves/contracts';
import { PgAccountDataRightsRepository } from '@between-moves/db';
import {
  AccountDeletionBlockedError,
  AuthenticationRequiredError,
  DomainError,
  type AccountDataRightsRequest,
  type AccountDeletionResult,
  type AccountExport,
  type AccountSummary,
  type AuthenticatedViewer,
  type Viewer,
} from '@between-moves/domain';
import type { StructuredLogger } from '@between-moves/observability';
import { getCookies } from 'better-auth/cookies';
import { getConfig } from '../../config';
import { problemResponse as problem, readJsonBody, readRequestId } from '../../kernel/request';
import { getAuth } from '../../server/auth';
import { getDatabase } from '../../server/database';
import { getLogger } from '../../server/logger';
import { getViewer, requireViewer } from '../../server/viewer';

const MAXIMUM_BODY_BYTES = 1_024;

export interface AccountDataRightsHandlerDependencies {
  readonly expectedOrigin: string;
  readonly requireViewer: (request: Request) => Promise<AuthenticatedViewer>;
  readonly exportAccount: (request: AccountDataRightsRequest) => Promise<AccountExport>;
  readonly deleteAccount: (request: AccountDataRightsRequest) => Promise<AccountDeletionResult>;
  /** `Set-Cookie` values that expire every sign-in cookie in this browser. */
  readonly expiredSessionCookies: readonly string[];
  readonly logger: StructuredLogger;
  readonly clock: { now(): Date };
}

type ViewerResolution =
  | { readonly kind: 'authenticated'; readonly viewer: AuthenticatedViewer }
  | { readonly kind: 'response'; readonly response: Response };

/** Resolve the signed-in person, or answer 401 without naming any account. */
async function resolveViewer(
  dependencies: AccountDataRightsHandlerDependencies,
  request: Request,
): Promise<ViewerResolution> {
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
        'Sign in to manage your account.',
      ),
    };
  }
}

/** Record a data-rights event with counts only; never content, names, or addresses. */
function logEvent(
  dependencies: AccountDataRightsHandlerDependencies,
  request: Request,
  input: {
    readonly actorId: string;
    readonly event: string;
    readonly startedAt: Date;
    readonly data: Readonly<Record<string, number | boolean>>;
  },
): void {
  try {
    dependencies.logger.log({
      level: 'info',
      requestId: readRequestId(request),
      actorId: input.actorId,
      houseId: null,
      gameId: null,
      commandId: null,
      event: input.event,
      outcome: 'success',
      durationMs: Math.max(0, dependencies.clock.now().getTime() - input.startedAt.getTime()),
      data: input.data,
    });
  } catch {
    // A completed export or deletion stands when the diagnostic sink is unavailable.
  }
}

/** `2026-09-27` from an ISO instant, for the download's file name. */
function exportFileName(exportedAt: string): string {
  return `between-moves-export-${exportedAt.slice(0, 10)}.json`;
}

/**
 * [BM-050] Build the handler for GET /api/account/export. The export is the signed-in
 * person's own data only; there is no parameter that could select anyone else. It downloads
 * as private, non-cacheable JSON and logs `identity.account.exported` with counts only.
 */
export function createAccountExportHandler(dependencies: AccountDataRightsHandlerDependencies) {
  return async (request: Request): Promise<Response> => {
    const startedAt = dependencies.clock.now();
    const resolved = await resolveViewer(dependencies, request);
    if (resolved.kind === 'response') return resolved.response;
    let exported: AccountExport;
    try {
      exported = await dependencies.exportAccount({ viewer: resolved.viewer });
    } catch (error) {
      if (error instanceof DomainError && error.code === 'not_found') {
        return problem(request, 404, 'not_found', 'Not found', 'Account is unavailable.');
      }
      throw error;
    }
    logEvent(dependencies, request, {
      actorId: resolved.viewer.userId,
      event: 'identity.account.exported',
      startedAt,
      data: {
        memberships_count: exported.memberships.length,
        messages_count: exported.authored.messages.length,
        notes_count: exported.authored.notes.length,
        games_count: exported.games.length,
        moves_count: exported.moves.length,
      },
    });
    return new Response(`${JSON.stringify(exported, null, 2)}\n`, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${exportFileName(exported.exportedAt)}"`,
      },
    });
  };
}

/** Explain which Houses still need a new Owner, naming only the viewer's own Houses. */
function blockedDeletion(request: Request, error: AccountDeletionBlockedError): Response {
  const names = new Intl.ListFormat('en', { type: 'conjunction' }).format(
    error.ownedHouses.map((house) => house.name),
  );
  return problem(
    request,
    409,
    'ownership_transfer_required',
    'Ownership transfer required',
    `Transfer ownership of ${names} before deleting your account.`,
    { meta: { houses: error.ownedHouses } },
  );
}

/**
 * [BM-050] Build the handler for POST /api/account/delete. Require the expected Origin, a
 * signed-in person, and the typed confirmation phrase. On success, answer 204, expire this
 * browser's sign-in cookies, and log `identity.account.deleted` with counts only. An Owner
 * receives 409 naming the Houses to transfer first.
 */
export function createAccountDeletionHandler(dependencies: AccountDataRightsHandlerDependencies) {
  return async (request: Request): Promise<Response> => {
    const startedAt = dependencies.clock.now();
    if (request.headers.get('origin') !== dependencies.expectedOrigin) {
      return problem(
        request,
        403,
        'origin_rejected',
        'Origin rejected',
        'Request origin is not allowed.',
      );
    }
    const resolved = await resolveViewer(dependencies, request);
    if (resolved.kind === 'response') return resolved.response;
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
    if (body.kind === 'invalid' || !accountDeletionBodySchema.safeParse(body.value).success) {
      return problem(
        request,
        422,
        'validation_failed',
        'Validation failed',
        `Type “${ACCOUNT_DELETION_CONFIRMATION}” to confirm.`,
      );
    }
    let result: AccountDeletionResult;
    try {
      result = await dependencies.deleteAccount({ viewer: resolved.viewer });
    } catch (error) {
      if (error instanceof AccountDeletionBlockedError) return blockedDeletion(request, error);
      if (error instanceof DomainError && error.code === 'not_found') {
        return problem(request, 404, 'not_found', 'Not found', 'Account is unavailable.');
      }
      throw error;
    }
    logEvent(dependencies, request, {
      actorId: resolved.viewer.userId,
      event: 'identity.account.deleted',
      startedAt,
      data: {
        deleted_now: result.deletedNow,
        memberships_left: result.membershipsLeft,
        sessions_removed: result.sessionsRemoved,
      },
    });
    // Expire only this app's sign-in cookies: Clear-Site-Data "cookies" would reach every
    // subdomain of the registrable domain.
    const headers = new Headers({
      'Cache-Control': 'private, no-store',
      'Clear-Site-Data': '"storage"',
    });
    for (const cookie of dependencies.expiredSessionCookies) headers.append('Set-Cookie', cookie);
    return new Response(null, { status: 204, headers });
  };
}

interface SignInCookie {
  readonly name: string;
  readonly attributes: {
    readonly path?: string | undefined;
    readonly secure?: boolean | undefined;
    readonly httpOnly?: boolean | undefined;
    readonly sameSite?: string | undefined;
  };
}

/** A `Set-Cookie` value that removes one sign-in cookie with its original scope. */
export function expiredCookie(cookie: SignInCookie): string {
  const sameSite = cookie.attributes.sameSite;
  return [
    `${cookie.name}=`,
    'Max-Age=0',
    `Path=${cookie.attributes.path ?? '/'}`,
    ...(cookie.attributes.httpOnly === false ? [] : ['HttpOnly']),
    ...(cookie.attributes.secure === true || cookie.name.startsWith('__Secure-') ? ['Secure'] : []),
    ...(sameSite === undefined
      ? []
      : [`SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1).toLowerCase()}`]),
  ].join('; ');
}

export interface AccountSummaryReaderDependencies {
  readonly getViewer: (request: Request) => Promise<Viewer>;
  readonly readSummary: (request: AccountDataRightsRequest) => Promise<AccountSummary | null>;
}

/** [BM-050] The account page's summary; null for anyone who is not signed in. */
export function createAccountSummaryReader(dependencies: AccountSummaryReaderDependencies) {
  return async (request: Request): Promise<AccountSummary | null> => {
    const viewer = await dependencies.getViewer(request);
    if (viewer.kind === 'anonymous') return null;
    return dependencies.readSummary({ viewer });
  };
}

const clock = new SystemClock();

/** [BM-050] Web composition for the account page. */
export function readAccountSummary(request: Request): Promise<AccountSummary | null> {
  return createAccountSummaryReader({
    getViewer,
    readSummary: createReadAccountSummary({
      accounts: new PgAccountDataRightsRepository(getDatabase().pool),
    }),
  })(request);
}

/** [BM-050] Web composition for the self-service account export and deletion commands. */
export function accountDataRightsHandlerDependencies(): AccountDataRightsHandlerDependencies {
  const accounts = new PgAccountDataRightsRepository(getDatabase().pool);
  const cookies = getCookies(getAuth().options);
  return {
    expectedOrigin: getConfig().appOrigin.origin,
    requireViewer,
    exportAccount: createExportAccountData({ clock, accounts }),
    deleteAccount: createDeleteAccount({
      clock,
      ids: { generate: () => generateUuidV7() },
      accounts,
    }),
    expiredSessionCookies: [
      cookies.sessionToken,
      cookies.sessionData,
      cookies.dontRememberToken,
    ].map(expiredCookie),
    logger: getLogger(),
    clock,
  };
}
