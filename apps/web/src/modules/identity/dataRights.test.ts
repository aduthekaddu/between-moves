import {
  AccountDeletionBlockedError,
  AuthenticationRequiredError,
  DomainError,
  type AccountDeletionResult,
  type AccountExport,
  type AuthenticatedViewer,
} from '@between-moves/domain';
import { createStructuredLogger, type StructuredLogger } from '@between-moves/observability';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  accountDataRightsHandlerDependencies,
  createAccountDeletionHandler,
  createAccountExportHandler,
  createAccountSummaryReader,
  expiredCookie,
  readAccountSummary,
  type AccountDataRightsHandlerDependencies,
} from './dataRights';

const composition = vi.hoisted(() => ({
  viewer: {
    kind: 'authenticated',
    userId: '01941f29-7c00-7000-8000-000000000613',
    displayName: 'Bea',
    imageUrl: null,
  } as const,
  anonymous: false,
  readSummary: vi.fn(),
  exportAccount: vi.fn(),
  deleteAccount: vi.fn(),
  log: vi.fn(),
}));

vi.mock('@between-moves/db', () => ({
  PgAccountDataRightsRepository: class {
    readSummary(userId: string) {
      return composition.readSummary(userId);
    }
    exportAccount(userId: string, exportedAt: Date) {
      return composition.exportAccount(userId, exportedAt);
    }
    deleteAccount(input: unknown) {
      return composition.deleteAccount(input);
    }
  },
}));
vi.mock('../../server/database', () => ({ getDatabase: () => ({ pool: {} }) }));
vi.mock('../../server/viewer', () => ({
  getViewer: async () => (composition.anonymous ? { kind: 'anonymous' } : composition.viewer),
  requireViewer: async () => {
    if (composition.anonymous) throw new AuthenticationRequiredError();
    return composition.viewer;
  },
}));
vi.mock('../../server/logger', () => ({ getLogger: () => ({ log: composition.log }) }));
vi.mock('../../server/auth', () => ({
  getAuth: () => ({
    options: {
      baseURL: 'https://app.example.test',
      advanced: {
        useSecureCookies: true,
        cookiePrefix: 'between-moves',
        defaultCookieAttributes: { secure: true, httpOnly: true, sameSite: 'lax', path: '/' },
      },
    },
  }),
}));
vi.mock('../../config', () => ({
  getConfig: () => ({ appOrigin: new URL('https://app.example.test') }),
}));

const origin = 'https://app.example.test';
const viewer: AuthenticatedViewer = composition.viewer;
const exported: AccountExport = {
  format: 'between-moves.account-export',
  version: 1,
  exportedAt: '2026-10-05T08:00:00.000Z',
  profile: {
    userId: viewer.userId,
    displayName: 'Bea',
    email: 'bea@example.test',
    emailVerified: true,
    imageUrl: null,
    createdAt: '2026-08-30T00:00:00.000Z',
  },
  memberships: [
    {
      membershipId: '01941f29-7c00-7000-8000-000000000623',
      houseId: '01941f29-7c00-7000-8000-000000000601',
      houseName: 'Knights at Dusk',
      role: 'member',
      status: 'active',
      joinedAt: '2026-08-30T00:00:00.000Z',
      leftAt: null,
    },
  ],
  authored: {
    messages: [
      {
        messageId: '01941f29-7c00-7000-8000-000000005041',
        houseId: '01941f29-7c00-7000-8000-000000000601',
        nightId: '01941f29-7c00-7000-8000-000000005031',
        body: 'Good luck, all.',
        sentAt: '2026-09-04T14:01:00.000Z',
        removedAt: null,
      },
    ],
    notes: [],
    reactions: [],
    puzzles: [],
  },
  games: [],
  moves: [],
  contributions: { points: [], finalStandings: [] },
};
const deleted: AccountDeletionResult = {
  userId: viewer.userId,
  deletedNow: true,
  membershipsLeft: 2,
  sessionsRemoved: 3,
};

type TestDependencies = AccountDataRightsHandlerDependencies & {
  readonly logger: StructuredLogger & { log: ReturnType<typeof vi.fn> };
  readonly exportAccount: ReturnType<typeof vi.fn>;
  readonly deleteAccount: ReturnType<typeof vi.fn>;
  readonly requireViewer: ReturnType<typeof vi.fn>;
};

function dependencies(overrides: Partial<AccountDataRightsHandlerDependencies> = {}) {
  let now = Date.parse('2026-10-05T09:00:00.000Z');
  return {
    expectedOrigin: origin,
    requireViewer: vi.fn(async () => viewer),
    exportAccount: vi.fn(async () => exported),
    deleteAccount: vi.fn(async () => deleted),
    expiredSessionCookies: ['a=; Max-Age=0; Path=/', 'b=; Max-Age=0; Path=/'],
    logger: { log: vi.fn() },
    clock: {
      now: () => {
        const value = new Date(now);
        now += 40;
        return value;
      },
    },
    ...overrides,
  } as TestDependencies;
}

function exportRequest(): Request {
  return new Request(`${origin}/api/account/export`, {
    headers: { 'x-request-id': 'request-bm-050-export' },
  });
}

function deleteRequest(
  body: string = JSON.stringify({ confirmation: 'delete my account' }),
  requestOrigin: string = origin,
): Request {
  return new Request(`${origin}/api/account/delete`, {
    method: 'POST',
    headers: {
      origin: requestOrigin,
      'content-type': 'application/json',
      'x-request-id': 'request-bm-050-delete',
    },
    body,
  });
}

describe('BM-050 GET /api/account/export', () => {
  it('downloads the person’s own data as private JSON and logs counts only', async () => {
    const deps = dependencies();
    const response = await createAccountExportHandler(deps)(exportRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="between-moves-export-2026-10-05.json"',
    );
    await expect(response.json()).resolves.toEqual(exported);
    expect(deps.exportAccount).toHaveBeenCalledWith({ viewer });
    expect(deps.logger.log).toHaveBeenCalledWith({
      level: 'info',
      requestId: 'request-bm-050-export',
      actorId: viewer.userId,
      houseId: null,
      gameId: null,
      commandId: null,
      event: 'identity.account.exported',
      outcome: 'success',
      durationMs: 40,
      data: {
        memberships_count: 1,
        messages_count: 1,
        notes_count: 0,
        games_count: 0,
        moves_count: 0,
      },
    });
  });

  it('writes no content, name, or address to the log line', async () => {
    const lines: string[] = [];
    const logger = createStructuredLogger({
      clock: { now: () => new Date(0) },
      sink: (line) => lines.push(line),
    });
    await createAccountExportHandler(dependencies({ logger }))(exportRequest());

    expect(lines).toHaveLength(1);
    for (const content of ['Good luck, all.', 'bea@example.test', 'Bea', 'Knights at Dusk']) {
      expect(lines[0]).not.toContain(content);
    }
  });

  it('answers 401 without reading any account when nobody is signed in', async () => {
    const deps = dependencies({
      requireViewer: vi.fn(async () => {
        throw new AuthenticationRequiredError();
      }),
    });
    const response = await createAccountExportHandler(deps)(exportRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: 'unauthenticated' });
    expect(deps.exportAccount).not.toHaveBeenCalled();
  });

  it('answers 404 when the identity is gone', async () => {
    const deps = dependencies({
      exportAccount: vi.fn(async () => {
        throw new DomainError('not_found', 'Account is unavailable');
      }),
    });
    const response = await createAccountExportHandler(deps)(exportRequest());

    expect(response.status).toBe(404);
    expect(deps.logger.log).not.toHaveBeenCalled();
  });

  it('lets unexpected failures reach the error boundary', async () => {
    const failure = new Error('database unavailable');
    await expect(
      createAccountExportHandler(
        dependencies({
          exportAccount: vi.fn(async () => {
            throw failure;
          }),
        }),
      )(exportRequest()),
    ).rejects.toBe(failure);
    await expect(
      createAccountExportHandler(
        dependencies({
          requireViewer: vi.fn(async () => {
            throw failure;
          }),
        }),
      )(exportRequest()),
    ).rejects.toBe(failure);
  });

  it('still downloads when the log sink fails', async () => {
    const deps = dependencies();
    deps.logger.log.mockImplementation(() => {
      throw new Error('sink unavailable');
    });
    await expect(createAccountExportHandler(deps)(exportRequest())).resolves.toMatchObject({
      status: 200,
    });
  });
});

describe('BM-050 POST /api/account/delete', () => {
  it('deletes the account, expires this browser’s sign-in, and logs counts only', async () => {
    const deps = dependencies();
    const response = await createAccountDeletionHandler(deps)(deleteRequest());

    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('clear-site-data')).toBe('"storage"');
    expect(response.headers.getSetCookie()).toEqual([
      'a=; Max-Age=0; Path=/',
      'b=; Max-Age=0; Path=/',
    ]);
    expect(deps.deleteAccount).toHaveBeenCalledWith({ viewer });
    expect(deps.logger.log).toHaveBeenCalledWith({
      level: 'info',
      requestId: 'request-bm-050-delete',
      actorId: viewer.userId,
      houseId: null,
      gameId: null,
      commandId: null,
      event: 'identity.account.deleted',
      outcome: 'success',
      durationMs: 40,
      data: { deleted_now: true, memberships_left: 2, sessions_removed: 3 },
    });
  });

  it('answers a repeated request after deletion the same way, logging the replay', async () => {
    const deps = dependencies({
      deleteAccount: vi.fn(async () => ({
        ...deleted,
        deletedNow: false,
        membershipsLeft: 0,
        sessionsRemoved: 0,
      })),
    });
    const response = await createAccountDeletionHandler(deps)(deleteRequest());

    expect(response.status).toBe(204);
    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { deleted_now: false, memberships_left: 0, sessions_removed: 0 },
      }),
    );
  });

  it('rejects a cross-site origin before resolving the viewer', async () => {
    const deps = dependencies();
    const response = await createAccountDeletionHandler(deps)(
      deleteRequest(undefined, 'https://evil.example.test'),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'origin_rejected' });
    expect(deps.requireViewer).not.toHaveBeenCalled();
    expect(deps.deleteAccount).not.toHaveBeenCalled();
  });

  it('answers 401 when nobody is signed in', async () => {
    const deps = dependencies({
      requireViewer: vi.fn(async () => {
        throw new AuthenticationRequiredError();
      }),
    });
    const response = await createAccountDeletionHandler(deps)(deleteRequest());

    expect(response.status).toBe(401);
    expect(deps.deleteAccount).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing confirmation', '{}'],
    ['a different phrase', JSON.stringify({ confirmation: 'Delete My Account' })],
    [
      'another account selector',
      JSON.stringify({
        confirmation: 'delete my account',
        userId: '01941f29-7c00-7000-8000-000000000611',
      }),
    ],
    ['malformed JSON', '{"confirmation":'],
  ])('refuses %s with 422 and deletes nothing', async (_case, body) => {
    const deps = dependencies();
    const response = await createAccountDeletionHandler(deps)(deleteRequest(body));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: 'validation_failed',
      detail: 'Type “delete my account” to confirm.',
    });
    expect(deps.deleteAccount).not.toHaveBeenCalled();
  });

  it('refuses an oversized body with 413', async () => {
    const deps = dependencies();
    const response = await createAccountDeletionHandler(deps)(
      deleteRequest(JSON.stringify({ confirmation: 'x'.repeat(2_000) })),
    );

    expect(response.status).toBe(413);
    expect(deps.deleteAccount).not.toHaveBeenCalled();
  });

  it('tells an Owner which Houses to transfer first', async () => {
    const houses = [
      { houseId: '01941f29-7c00-7000-8000-000000000601', name: 'Knights at Dusk' },
      { houseId: '01941f29-7c00-7000-8000-000000000602', name: 'The Long Table' },
    ];
    const deps = dependencies({
      deleteAccount: vi.fn(async () => {
        throw new AccountDeletionBlockedError(houses);
      }),
    });
    const response = await createAccountDeletionHandler(deps)(deleteRequest());

    expect(response.status).toBe(409);
    expect(response.headers.get('set-cookie')).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      code: 'ownership_transfer_required',
      detail:
        'Transfer ownership of Knights at Dusk and The Long Table before deleting your account.',
      meta: { houses },
    });
    expect(deps.logger.log).not.toHaveBeenCalled();
  });

  it('answers 404 when the identity is gone and propagates unexpected failures', async () => {
    const missing = await createAccountDeletionHandler(
      dependencies({
        deleteAccount: vi.fn(async () => {
          throw new DomainError('not_found', 'Account is unavailable');
        }),
      }),
    )(deleteRequest());
    expect(missing.status).toBe(404);

    const failure = new DomainError('conflict', 'Transaction must be retried');
    await expect(
      createAccountDeletionHandler(
        dependencies({
          deleteAccount: vi.fn(async () => {
            throw failure;
          }),
        }),
      )(deleteRequest()),
    ).rejects.toBe(failure);
  });

  it('keeps a committed deletion when the log sink fails', async () => {
    const deps = dependencies();
    deps.logger.log.mockImplementation(() => {
      throw new Error('sink unavailable');
    });
    await expect(createAccountDeletionHandler(deps)(deleteRequest())).resolves.toMatchObject({
      status: 204,
    });
  });
});

describe('BM-050 expired sign-in cookies', () => {
  it('expires a cookie with its original scope', () => {
    expect(
      expiredCookie({
        name: 'between-moves.session_token',
        attributes: { path: '/', httpOnly: true, secure: false, sameSite: 'lax' },
      }),
    ).toBe('between-moves.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax');
    expect(
      expiredCookie({
        name: '__Secure-between-moves.session_token',
        attributes: { sameSite: 'strict' },
      }),
    ).toBe(
      '__Secure-between-moves.session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict',
    );
    expect(expiredCookie({ name: 'plain', attributes: { httpOnly: false } })).toBe(
      'plain=; Max-Age=0; Path=/',
    );
  });
});

describe('BM-050 account summary', () => {
  it('reads nothing for an anonymous visitor', async () => {
    const readSummary = vi.fn();
    await expect(
      createAccountSummaryReader({ getViewer: async () => ({ kind: 'anonymous' }), readSummary })(
        exportRequest(),
      ),
    ).resolves.toBeNull();
    expect(readSummary).not.toHaveBeenCalled();
  });
});

describe('BM-050 account web composition', () => {
  beforeEach(() => {
    composition.anonymous = false;
    composition.readSummary.mockReset();
    composition.exportAccount.mockReset();
    composition.deleteAccount.mockReset();
    composition.log.mockReset();
  });

  it('reads the signed-in person’s summary from PostgreSQL', async () => {
    const summary = { displayName: 'Bea', houses: [] };
    composition.readSummary.mockResolvedValue(summary);

    await expect(readAccountSummary(exportRequest())).resolves.toBe(summary);
    expect(composition.readSummary).toHaveBeenCalledWith(viewer.userId);
    composition.anonymous = true;
    await expect(readAccountSummary(exportRequest())).resolves.toBeNull();
    expect(composition.readSummary).toHaveBeenCalledOnce();
  });

  it('composes export and deletion with the app origin and Better Auth’s cookies', async () => {
    composition.exportAccount.mockResolvedValue(exported);
    composition.deleteAccount.mockResolvedValue(deleted);
    const deps = accountDataRightsHandlerDependencies();

    expect(deps.expectedOrigin).toBe(origin);
    expect(deps.expiredSessionCookies).toEqual([
      '__Secure-between-moves.session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
      '__Secure-between-moves.session_data=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
      '__Secure-between-moves.dont_remember=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
    ]);
    await expect(createAccountExportHandler(deps)(exportRequest())).resolves.toMatchObject({
      status: 200,
    });
    expect(composition.exportAccount).toHaveBeenCalledWith(viewer.userId, expect.any(Date));
    await expect(createAccountDeletionHandler(deps)(deleteRequest())).resolves.toMatchObject({
      status: 204,
    });
    expect(composition.deleteAccount).toHaveBeenCalledWith({
      userId: viewer.userId,
      deletedAt: expect.any(Date),
      auditIds: { generate: expect.any(Function) },
    });
    const [{ auditIds }] = composition.deleteAccount.mock.calls[0] as [
      { auditIds: { generate(): string } },
    ];
    expect(auditIds.generate()).toMatch(/^[0-9a-f-]{14}7/);
    expect(composition.log).toHaveBeenCalledTimes(2);
  });
});
