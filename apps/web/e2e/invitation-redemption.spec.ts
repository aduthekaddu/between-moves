import { createDatabase, type Database } from '@between-moves/db/database';
import {
  resetTwoHousesWithMembers,
  twoHousesWithMembers,
  type TwoHousesWithMembers,
} from '@between-moves/db/testing';
import { expect, test } from '@playwright/test';
import { createDecipheriv, createHash, randomBytes } from 'node:crypto';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const secret = 'e2e-better-auth-secret-at-least-32-characters';
const inviteeEmail = 'bm-016-invitee@example.test';
let database: Database | undefined;
let world: TwoHousesWithMembers | undefined;
let invitationToken = '';

interface MagicLinkMessage {
  readonly email: string;
  readonly signInUrl: string;
}

function requiredDatabaseUrl(): string {
  if (testDatabaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
  return testDatabaseUrl;
}

function fixture(): TwoHousesWithMembers {
  if (world === undefined) throw new Error('Invitation fixture is not ready');
  return world;
}

async function latestSealedMagicLink(): Promise<string | null> {
  if (database === undefined) return null;
  const result = await database.pool.query<{ payload: unknown }>(
    `select payload
       from outbox_events
      where topic = 'identity.magic-link-email.requested'
      order by created_at desc
      limit 1`,
  );
  const payload = result.rows[0]?.payload;
  if (payload === null || typeof payload !== 'object' || !('sealed' in payload)) return null;
  return typeof payload.sealed === 'string' ? payload.sealed : null;
}

function openMagicLink(sealed: string): MagicLinkMessage {
  const envelope = Buffer.from(sealed, 'base64url');
  const key = createHash('sha256').update(secret, 'utf8').digest();
  const decipher = createDecipheriv('aes-256-gcm', key, envelope.subarray(0, 12), {
    authTagLength: 16,
  });
  decipher.setAuthTag(envelope.subarray(12, 28));
  const plaintext = Buffer.concat([
    decipher.update(envelope.subarray(28)),
    decipher.final(),
  ]).toString();
  const message: unknown = JSON.parse(plaintext);
  if (
    message === null ||
    typeof message !== 'object' ||
    !('email' in message) ||
    typeof message.email !== 'string' ||
    !('signInUrl' in message) ||
    typeof message.signInUrl !== 'string'
  ) {
    throw new Error('Invalid magic-link message');
  }
  return { email: message.email, signInUrl: message.signInUrl };
}

test.describe('Invitation redemption through magic-link sign-in', () => {
  test.skip(testDatabaseUrl === undefined, 'TEST_DATABASE_URL is required for Invitation E2E');

  test.beforeAll(async () => {
    database = createDatabase(requiredDatabaseUrl());
    await resetTwoHousesWithMembers(database.pool);
    await database.pool.query('delete from users where email = $1', [inviteeEmail]);
    await database.pool.query(
      "delete from outbox_events where topic = 'identity.magic-link-email.requested'",
    );
    world = await twoHousesWithMembers(database.pool);

    invitationToken = randomBytes(32).toString('base64url');
    const tokenDigestHex = createHash('sha256')
      .update(Buffer.from(invitationToken, 'base64url'))
      .digest('hex');
    const createdAt = new Date();
    await database.pool.query(
      `insert into invitations
        (id, house_id, token_digest, intended_email, role_grant, expires_at,
         use_limit, use_count, revoked_at, creator_membership_id, created_at)
       values ($1, $2, decode($3, 'hex'), null, 'member', $4, 10, 0, null, $5, $6)`,
      [
        '01941f29-7c00-7000-8000-000000000901',
        fixture().first.houseId,
        tokenDigestHex,
        new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1_000),
        fixture().first.member.membershipId,
        createdAt,
      ],
    );
  });

  test.afterAll(async () => {
    if (database === undefined) return;
    await resetTwoHousesWithMembers(database.pool);
    await database.pool.query('delete from users where email = $1', [inviteeEmail]);
    await database.pool.query(
      "delete from outbox_events where topic = 'identity.magic-link-email.requested'",
    );
    await database.close();
  });

  test('[BM-016] [PR-EDGE-02] anonymous invitee signs in, redeems, and lands in the House', async ({
    page,
  }) => {
    const seeded = fixture();
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`/invitations/${invitationToken}`);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Come into the House.');
    await page.getByLabel('Email address').fill(inviteeEmail);
    await page.getByRole('button', { name: 'Send me a sign-in link' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Your way back is in the post.',
    );

    await expect.poll(latestSealedMagicLink).not.toBeNull();
    const sealed = await latestSealedMagicLink();
    if (sealed === null) throw new Error('Magic-link delivery was not queued');
    const message = openMagicLink(sealed);
    expect(message.email).toBe(inviteeEmail);
    expect(new URL(message.signInUrl).searchParams.get('returnTo')).toBe(
      `/invitations/${invitationToken}`,
    );

    await page.goto(message.signInUrl);
    await expect(page).toHaveURL(new RegExp(`/h/${seeded.first.houseId}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(seeded.first.name);

    const membership = await database?.pool.query(
      `select m.role, m.status
         from memberships m
         join users u on u.id = m.user_id
        where m.house_id = $1 and u.email = $2`,
      [seeded.first.houseId, inviteeEmail],
    );
    expect(membership?.rows).toEqual([{ role: 'member', status: 'active' }]);
  });
});
