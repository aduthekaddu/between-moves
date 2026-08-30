import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SecureInvitationTokenIssuer } from './invitation-token';

describe('SecureInvitationTokenIssuer', () => {
  it('[BM-014] [DR-INVITE-02] issues 32 random bytes and their SHA-256 digest', () => {
    const issuer = new SecureInvitationTokenIssuer('test-secret-at-least-32-characters');

    const first = issuer.issue({ kind: 'random' });
    const second = issuer.issue({ kind: 'random' });

    expect(Buffer.from(first.raw, 'base64url')).toHaveLength(32);
    expect(first.digestHex).toBe(
      createHash('sha256').update(Buffer.from(first.raw, 'base64url')).digest('hex'),
    );
    expect(second.raw).not.toBe(first.raw);
  });

  it('[BM-014] [DR-INVITE-02] digests only canonical 32-byte tokens', () => {
    const issuer = new SecureInvitationTokenIssuer('test-secret-at-least-32-characters');
    const issued = issuer.issue({ kind: 'random' });

    expect(issuer.digest(issued.raw)).toBe(issued.digestHex);
    expect(issuer.digest('malformed')).toBeNull();
    expect(issuer.digest(`${issued.raw}=`)).toBeNull();
  });

  it('[BM-014] returns the same pseudorandom token for one idempotency scope', () => {
    const issuer = new SecureInvitationTokenIssuer('test-secret-at-least-32-characters');

    const first = issuer.issue({ kind: 'idempotent', scope: 'viewer:house:key-1' });
    const replay = issuer.issue({ kind: 'idempotent', scope: 'viewer:house:key-1' });
    const other = issuer.issue({ kind: 'idempotent', scope: 'viewer:house:key-2' });

    expect(replay).toEqual(first);
    expect(other.raw).not.toBe(first.raw);
    expect(Buffer.from(first.raw, 'base64url')).toHaveLength(32);
  });
});
