import type {
  InvitationToken,
  InvitationTokenDigester,
  InvitationTokenIssueRequest,
  InvitationTokenIssuer,
} from '@between-moves/domain';
import { createHash, createHmac, randomBytes } from 'node:crypto';

/** [BM-014] [DR-INVITE-02] Issue a 256-bit token while exposing only its digest to storage. */
export class SecureInvitationTokenIssuer implements InvitationTokenIssuer, InvitationTokenDigester {
  constructor(private readonly idempotencySecret: string) {}

  issue(request: InvitationTokenIssueRequest): InvitationToken {
    const bytes =
      request.kind === 'random'
        ? randomBytes(32)
        : createHmac('sha256', this.idempotencySecret)
            .update('between-moves:invitation-idempotency\0')
            .update(request.scope)
            .digest();
    return {
      raw: bytes.toString('base64url'),
      digestHex: createHash('sha256').update(bytes).digest('hex'),
    };
  }

  digest(rawToken: string): string | null {
    if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return null;
    const bytes = Buffer.from(rawToken, 'base64url');
    if (bytes.length !== 32 || bytes.toString('base64url') !== rawToken) return null;
    return createHash('sha256').update(bytes).digest('hex');
  }
}
