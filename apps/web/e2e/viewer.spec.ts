import { expect, test } from '@playwright/test';
import { createDatabase } from '@between-moves/db/database';
import { makeSignature } from 'better-auth/crypto';
import { requireTestDatabaseUrl } from '@between-moves/db/test-database';

const testDatabaseUrl = requireTestDatabaseUrl();
const secret = 'e2e-better-auth-secret-at-least-32-characters';

async function signedCookie(token: string): Promise<string> {
  return `between-moves.session_token=${token}.${await makeSignature(token, secret)}`;
}

test('[BM-007] anonymous protected-route access returns 401', async ({ request }) => {
  const response = await request.get('/api/viewer');

  expect(response.status()).toBe(401);
  await expect(response.json()).resolves.toMatchObject({ code: 'unauthenticated', status: 401 });
});

test('[BM-007] a persisted authenticated session can access the protected route', async ({
  request,
}) => {
  const database = createDatabase(testDatabaseUrl);
  const userId = '01941f29-7c00-7000-8000-000000000301';
  const sessionId = '01941f29-7c00-7000-8000-000000000302';
  const token = 'e2e-valid-opaque-session-token-00001';

  try {
    await database.pool.query('delete from users where email = $1', ['ada-e2e@example.test']);
    await database.pool.query(
      `insert into users (id, display_name, email, email_verified)
       values ($1, 'Ada E2E', 'ada-e2e@example.test', true)`,
      [userId],
    );
    await database.pool.query(
      `insert into sessions (id, user_id, token, expires_at)
       values ($1, $2, $3, $4)`,
      [sessionId, userId, token, new Date(Date.now() + 60_000)],
    );

    const response = await request.get('/api/viewer', {
      headers: { cookie: await signedCookie(token), 'x-request-id': 'bm-007-e2e' },
    });

    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toEqual({
      viewer: {
        kind: 'authenticated',
        userId,
        displayName: 'Ada E2E',
        imageUrl: null,
      },
    });
  } finally {
    await database.pool.query('delete from users where id = $1', [userId]);
    await database.close();
  }
});
